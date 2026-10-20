// Tune the brain's parameters with sep-CMA-ES (Ros & Hansen 2008) on self-play results.
//   node agent/scripts/tune.mjs <run name> <generations> <field json: array of param objects> [start params json] [deck size]
// Each candidate plays duplicate deals (every deal once in every seat) against the field at 3, 4 and 5 players;
// fitness = win share x players (1.0 = as good as the field). All candidates of a generation play the same deals.
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { pool, duplicate } from './pool.mjs';
import { DEFAULTS } from '../../lib/bots/brain.js';

// name: [low, high, log scale?]
export const SPACE = {
  rho: [0.02, 4, 1], gamma: [0.25, 4, 1], delta: [0.02, 3, 1], mu: [1, 3000, 1], tau: [0.03, 3, 1], tau1: [1, 1000, 1],
  eps: [0.005, 3, 1], mBid: [-0.7, 0.6, 0], shade: [0.5, 2.5, 0], mDec: [-0.5, 0.6, 0], aucM: [0, 5, 0], khBias: [-0.8, 0.4, 0],
  pc: [0, 1, 0], gap: [0, 200, 0], pad: [0, 1, 0], phi: [0.2, 3, 1], mResp: [-1, 0.6, 0],
};
const KEYS = Object.keys(SPACE), N = KEYS.length;
const toUnit = th => KEYS.map(k => { const [lo, hi, lg] = SPACE[k], v = th[k]; return lg ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo); });
const fromUnit = u => Object.fromEntries(KEYS.map((k, i) => {
  const [lo, hi, lg] = SPACE[k], x = Math.min(1, Math.max(0, u[i]));
  return [k, +(lg ? lo * Math.pow(hi / lo, x) : lo + (hi - lo) * x).toPrecision(4)];
}));
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const [name = 'run', gens = 30, fieldJson = '[{}]', startJson = '{}', size = 40] = process.argv.slice(2);
const field = JSON.parse(fieldJson).map(x => (x.kind ? x : { kind: 'smart', th: { ...DEFAULTS, ...x } })); // params, or a full spec
const start = { ...DEFAULTS, ...JSON.parse(startJson) }, sizes = String(size).split(',').map(Number); // e.g. 40 or 22,26,30,34
const DEALS = +(process.env.DEALS || 70); // per player count, so 3 x 70 deals x (3+4+5 seats) = 840 games per candidate
mkdirSync('agent/runs', { recursive: true });
const logFile = `agent/runs/${name}.jsonl`; writeFileSync(logFile, '');

// sep-CMA-ES state
const lambda = 16, mu = lambda / 2;
let w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1)); const ws = w.reduce((a, b) => a + b); w = w.map(x => x / ws);
const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
const cs = (mueff + 2) / (N + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (N + 1)) - 1) + cs;
const cc = (4 + mueff / N) / (N + 4 + 2 * mueff / N);
const c1 = 2 / ((N + 1.3) ** 2 + mueff) * (N + 2) / 3, cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((N + 2) ** 2 + mueff) * (N + 2) / 3);
const chiN = Math.sqrt(N) * (1 - 1 / (4 * N) + 1 / (21 * N * N));
let m = toUnit(start), sigma = +(process.env.SIGMA || 0.15), C = new Array(N).fill(1), ps = new Array(N).fill(0), pc = new Array(N).fill(0);

const P = pool();
const evaluate = async (cands, seed0) => {
  const games = [], owner = [];
  cands.forEach((th, ci) => {
    for (const players of [3, 4, 5]) for (const g of duplicate({ kind: 'smart', th }, field, { deals: DEALS, players, seed0: seed0 + players * 100000 })) {
      games.push({ ...g, size: sizes[(g.seed + players) % sizes.length] }); owner.push(ci); // deck sizes cycle over the deals
    }
  });
  const res = await P.play(games, 12), fit = cands.map(() => [0, 0]);
  res.forEach((r, i) => { const f = fit[owner[i]]; f[0] += r.wins[games[i].seat] * games[i].specs.length; f[1]++; });
  return fit.map(([a, b]) => a / b);
};

for (let g = 0; g < +gens; g++) {
  const t0 = Date.now(), zs = [], ys = [], xs = [];
  for (let k = 0; k < lambda; k++) {
    const z = Array.from({ length: N }, gauss), y = z.map((v, i) => v * Math.sqrt(C[i]));
    zs.push(z); ys.push(y); xs.push(m.map((v, i) => v + sigma * y[i]));
  }
  const cands = xs.map(fromUnit), fit = await evaluate(cands, 1 + g * 7919);
  const order = fit.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const ymean = new Array(N).fill(0);
  for (let r = 0; r < mu; r++) { const y = ys[order[r]]; for (let i = 0; i < N; i++) ymean[i] += w[r] * y[i]; }
  for (let i = 0; i < N; i++) m[i] = Math.min(1.05, Math.max(-0.05, m[i] + sigma * ymean[i]));
  for (let i = 0; i < N; i++) ps[i] = (1 - cs) * ps[i] + Math.sqrt(cs * (2 - cs) * mueff) * ymean[i] / Math.sqrt(C[i]);
  const psn = Math.sqrt(ps.reduce((a, b) => a + b * b, 0)), hs = psn / Math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) < (1.4 + 2 / (N + 1)) * chiN ? 1 : 0;
  for (let i = 0; i < N; i++) {
    pc[i] = (1 - cc) * pc[i] + hs * Math.sqrt(cc * (2 - cc) * mueff) * ymean[i];
    let rank = 0; for (let r = 0; r < mu; r++) rank += w[r] * ys[order[r]][i] ** 2;
    C[i] = (1 - c1 - cmu) * C[i] + c1 * (pc[i] ** 2 + (1 - hs) * cc * (2 - cc) * C[i]) + cmu * rank;
  }
  sigma *= Math.exp((cs / ds) * (psn / chiN - 1));
  sigma = Math.min(0.4, sigma);
  const mean = fromUnit(m), avg = fit.reduce((a, b) => a + b) / fit.length;
  const line = { gen: g, best: fit[order[0]], avg, sigma, mean, secs: (Date.now() - t0) / 1000 };
  appendFileSync(logFile, JSON.stringify(line) + '\n');
  console.log(`gen ${g} best ${fit[order[0]].toFixed(3)} avg ${avg.toFixed(3)} sigma ${sigma.toFixed(3)} ${line.secs}s`);
}
writeFileSync(`agent/runs/${name}.params.json`, JSON.stringify(fromUnit(m), null, 2));
P.close();
