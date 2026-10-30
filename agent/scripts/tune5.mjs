// Tune some of a bot's parameters jointly with sep-CMA-ES, against a mixed field (fifth round):
//   node agent/scripts/tune5.mjs <run name> <generations> <base> <field a;b;c> <sizes 20,40> <players 3> <params>
// A field entry vs:x plays the other side: x alone against the candidate in all other seats.
// params: name:low:high[:log], comma separated, e.g. delta:0.3:1.1,shade:0.9:1.5,mu:150:1500:log
// The base is a registry name (agent/scripts/registry.mjs) such as insane; candidates are "<base>:k=v,...".
// Every candidate plays the same duplicate deals (DEALS per deck size and player count, every seat once), the other
// seats taken by the field in turn; fitness = win share x players (1.00 = level with the field).
import { appendFileSync, writeFileSync } from 'node:fs';
import { pool, duplicate } from './pool.mjs';

const [name = 'tune5', gens = 20, base = 'insane', fieldArg = 'insane;hard', sizesArg = '20', playersArg = '3', paramsArg = ''] = process.argv.slice(2);
const SPACE = paramsArg.split(',').map(p => { const [k, lo, hi, lg] = p.split(':'); return [k, +lo, +hi, lg === 'log']; });
const N = SPACE.length, DEALS = +(process.env.DEALS || 40), lambda = +(process.env.LAMBDA || 10), field = fieldArg.split(';');
const sizes = sizesArg.split(',').map(Number), players = playersArg.split(',').map(Number);
const fromUnit = u => SPACE.map(([k, lo, hi, lg], i) => { const x = Math.min(1, Math.max(0, u[i])); return [k, +(lg ? lo * Math.pow(hi / lo, x) : lo + (hi - lo) * x).toPrecision(3)]; });
const specOf = u => `${base}${base.includes(':') ? ',' : ':'}${fromUnit(u).map(([k, v]) => `${k}=${v}`).join(',')}`; // a base with settings of its own: one list
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
// start: START=k=v,... (default the middle of each range)
const start = Object.fromEntries((process.env.START || '').split(',').filter(Boolean).map(kv => kv.split('=')).map(([k, v]) => [k, +v]));
let m = SPACE.map(([k, lo, hi, lg]) => (k in start ? (lg ? Math.log(start[k] / lo) / Math.log(hi / lo) : (start[k] - lo) / (hi - lo)) : 0.5));

const mu = Math.floor(lambda / 2);
let w = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1)); const ws = w.reduce((a, b) => a + b); w = w.map(x => x / ws);
const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
const cs = (mueff + 2) / (N + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (N + 1)) - 1) + cs;
const cc = (4 + mueff / N) / (N + 4 + 2 * mueff / N);
const c1 = 2 / ((N + 1.3) ** 2 + mueff) * (N + 2) / 3, cmu = Math.min(1 - c1, 2 * (mueff - 2 + 1 / mueff) / ((N + 2) ** 2 + mueff) * (N + 2) / 3);
const chiN = Math.sqrt(N) * (1 - 1 / (4 * N) + 1 / (21 * N * N));
let sigma = +(process.env.SIGMA || 0.2), C = new Array(N).fill(1), ps = new Array(N).fill(0), pc = new Array(N).fill(0);

const P = pool(), logFile = `agent/runs/${name}.jsonl`;
const evaluate = async (specs, seed0) => {
  const games = [], owner = [];
  const plain = field.filter(f => !f.startsWith('vs:')), vs = field.filter(f => f.startsWith('vs:')).map(f => f.slice(3));
  specs.forEach((sp, ci) => {
    for (const n of players) for (const size of sizes) {
      const seed = seed0 + n * 1000 + size * 10;
      if (plain.length) for (const g of duplicate(sp, plain, { deals: DEALS, players: n, size, seed0: seed })) { games.push(g); owner.push(ci); }
      // vs:x — the other side: one x against the candidate in every other seat (as a person plays a table of bots)
      for (const x of vs) for (const g of duplicate(x, [sp], { deals: DEALS, players: n, size, seed0: seed })) { games.push({ ...g, vs: true }); owner.push(ci); }
    }
  });
  const res = await P.play(games, 3), fit = specs.map(() => [0, 0]);
  // fitness: the candidate's win share x players, or for vs: tables what x leaves to the candidate seats, per seat
  res.forEach((r, i) => { const f = fit[owner[i]], n = games[i].specs.length; f[0] += games[i].vs ? (1 - r.wins[games[i].seat]) * n / (n - 1) : r.wins[games[i].seat] * n; f[1]++; });
  return fit.map(([a, b]) => a / b);
};
for (let g = 0; g < +gens; g++) {
  const t0 = Date.now(), ys = [], xs = [];
  for (let k = 0; k < lambda; k++) {
    const y = Array.from({ length: N }, gauss).map((v, i) => v * Math.sqrt(C[i]));
    ys.push(y); xs.push(m.map((v, i) => v + sigma * y[i]));
  }
  // the current mean plays too (as a reference: how good the centre is on these deals)
  const fit = await evaluate([...xs.map(specOf), specOf(m)], 70000 + g * 7919), ref = fit.pop();
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
  sigma = Math.min(0.4, sigma * Math.exp((cs / ds) * (psn / chiN - 1)));
  const line = { gen: g, ref, best: fit[order[0]], avg: fit.reduce((a, b) => a + b) / fit.length, sigma, mean: Object.fromEntries(fromUnit(m)), secs: (Date.now() - t0) / 1000 };
  appendFileSync(logFile, JSON.stringify(line) + '\n');
  console.log(`gen ${g} centre ${ref.toFixed(3)} best ${line.best.toFixed(3)} avg ${line.avg.toFixed(3)} sigma ${sigma.toFixed(3)} ${specOf(m)} ${line.secs}s`);
}
writeFileSync(`agent/runs/${name}.final.txt`, specOf(m) + '\n');
P.close();
