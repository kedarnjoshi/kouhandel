// Fit the position model to what actually happens: from snapshots of games (who holds what, money, cards still
// to come) predict who ends up owning each set, by maximum likelihood. node agent/scripts/fitmodel.mjs <lineup> [games]
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick, countsOf } from '../../lib/engine.js';
import { sum, TYPES } from '../../lib/rules.js';
import { observe } from '../../lib/bots/brain.js';
import { futureIncome } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
const [lineup = 'v2,v2,v2,v2', games = 60] = process.argv.slice(2);
const names = lineup.split(','), agents = names.map(agentFor), snaps = [];
for (let g = 0; g < +games; g++) {
  const r = rng(4000 + g), s = newSimGame(names.length, 40, r), mine = [];
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') {
      const a = s.auction, caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
      const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
      if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
      s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
    }
    const w = waiting(s); if (!w) break;
    if (w.what === 'turn') { const o = observe(s, w.p); mine.push({ herd: o.herd, remain: o.remain, money: s.players.map(p => sum(p.money)), future: futureIncome(o), n: o.active.length }); }
    try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  if (s.phase !== 'over') continue;
  const owner = TYPES.map(t => s.players.findIndex(p => p.animals[t] === countsOf(s)[t]));
  for (const x of mine) snaps.push({ ...x, owner });
}
const NT = 10;
function nll(p) {
  const [rho, gamma, delta, mu, kappa] = p;
  if (rho < 0 || gamma < 0.2 || delta < 0 || mu < 1 || kappa < 0) return 1e9;
  let L = 0, cnt = 0;
  for (const x of snaps) {
    const m = x.money.map(v => Math.pow(v + mu + kappa * x.future, delta));
    for (let k = 0; k < NT; k++) {
      if (x.owner[k] < 0) continue;
      let tot = 0, mine = 0;
      for (let j = 0; j < x.herd.length; j++) { const b = x.herd[j][k] + rho * x.remain[k] / x.n, st = b > 0 ? Math.pow(b, gamma) * m[j] : 0; tot += st; if (j === x.owner[k]) mine = st; }
      if (tot <= 0) continue;
      if (x.herd.some(h => h[k] === 4)) continue; // decided already
      L -= Math.log(Math.max(1e-9, mine / tot)); cnt++;
    }
  }
  return L / cnt;
}
// Nelder-Mead
function nm(f, x0, step, iters = 300) {
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[j] : v)))].map(x => [x, f(x)]);
  for (let it = 0; it < iters; it++) {
    S.sort((a, b) => a[1] - b[1]);
    const n = x0.length, c = x0.map((_, j) => S.slice(0, n).reduce((a, s) => a + s[0][j], 0) / n), w = S[n];
    const at = t => c.map((v, j) => v + t * (w[0][j] - v));
    const r = at(-1), fr = f(r);
    if (fr < S[0][1]) { const e = at(-2), fe = f(e); S[n] = fe < fr ? [e, fe] : [r, fr]; }
    else if (fr < S[n - 1][1]) S[n] = [r, fr];
    else { const k = at(0.5), fk = f(k); if (fk < w[1]) S[n] = [k, fk]; else S = S.map((s, i) => (i === 0 ? s : (() => { const x = s[0].map((v, j) => S[0][0][j] + 0.5 * (v - S[0][0][j])); return [x, f(x)]; })())); }
  }
  S.sort((a, b) => a[1] - b[1]); return S[0];
}
const cur = [1.289, 1.106, 0.8568, 508.3, 0];
console.log('snapshots', snaps.length, 'current params nll', nll(cur).toFixed(4), 'uniform-ish baseline', nll([1, 0.2, 0, 100, 0]).toFixed(4));
const best = nm(nll, cur, [0.3, 0.3, 0.3, 150, 0.2]);
console.log('fitted rho gamma delta mu kappa', best[0].map(v => +v.toFixed(3)), 'nll', best[1].toFixed(4));
const best2 = nm(nll, [1, 1.5, 1.5, 50, 0.5], [0.3, 0.3, 0.3, 50, 0.2]);
console.log('fitted (other start)', best2[0].map(v => +v.toFixed(3)), 'nll', best2[1].toFixed(4));
