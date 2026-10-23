// Koehandel amounts vs what onlookers can see (card counts), to estimate hidden transfers.
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
const [lineup = 'v2,v2,v2,v2', games = 30] = process.argv.slice(2);
const names = lineup.split(','), agents = names.map(agentFor), rows = [];
for (let g = 0; g < +games; g++) {
  const r = rng(300 + g), s = newSimGame(names.length, 40, r);
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') {
      const a = s.auction, caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
      const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
      if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
      s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
    }
    const w = waiting(s); if (!w) break;
    const act = agents[w.p].act(s, w.p, w.what, r);
    if (w.what === 'respond') {
      const tr = s.trade, A = s.players[tr.a], B = s.players[tr.b], x = sum(tr.bids[tr.a]), na = tr.bids[tr.a].length;
      const avgA = s.ledger[tr.a] / Math.max(1, A.money.length), avgB = s.ledger[tr.b] / Math.max(1, B.money.length);
      let tot = 0, n = 0; for (const p of s.players) { tot += sum(p.money); n += p.money.length; }
      const y = act.type === 'accept' ? null : sum(act.cards), nb = act.type === 'accept' ? 0 : act.cards.length;
      rows.push([na, nb, x, y ?? -1, avgA, avgB, tot / n, A.money.length, B.money.length, s.ledger[tr.a], s.ledger[tr.b]]);
    }
    try { apply(s, w.p, act, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
// regress offer amount x on public features: na * avgCard(all), na * ledger-avg(A)
const fit = (X, Y) => { // least squares, tiny normal equations
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  X.forEach((x, r) => { for (let i = 0; i < k; i++) { b[i] += x[i] * Y[r]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } });
  for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  return b.map((v, i) => v / A[i][i]);
};
const err = (X, Y, w) => Math.sqrt(X.reduce((a, x, r) => a + (x.reduce((s, v, i) => s + v * w[i], 0) - Y[r]) ** 2, 0) / X.length);
const Xo = rows.map(r => [r[0] * r[6], r[0] * Math.min(r[4], 3 * r[6]), 1]), Yo = rows.map(r => r[2]);
const wo = fit(Xo, Yo); console.log('offer x ~', wo.map(v => v.toFixed(3)).join(', '), 'rmse', err(Xo, Yo, wo).toFixed(0), 'sd', Math.sqrt(Yo.reduce((a, y) => a + (y - Yo.reduce((p, q) => p + q, 0) / Yo.length) ** 2, 0) / Yo.length).toFixed(0), 'n', rows.length);
const cr = rows.filter(r => r[3] >= 0), Xc = cr.map(r => [r[1] * r[6], r[1] * Math.min(r[5], 3 * r[6]), 1]), Yc = cr.map(r => r[3]);
const wc = fit(Xc, Yc); console.log('counter y ~', wc.map(v => v.toFixed(3)).join(', '), 'rmse', err(Xc, Yc, wc).toFixed(0), 'n', cr.length, 'accept rate', (1 - cr.length / rows.length).toFixed(2));
// net transfer a -> b, by case, regressed without intercept on n_a*avg, n_b*avg
for (const [name, f] of [['accept', r => r[3] < 0], ['a wins', r => r[3] >= 0 && r[2] > r[3]], ['b wins', r => r[3] >= 0 && r[2] < r[3]]]) {
  const rr = rows.filter(f), X = rr.map(r => [r[0] * r[6], r[1] * r[6]].concat(name === 'accept' ? [] : [])), Y = rr.map(r => r[2] - Math.max(0, r[3]));
  const Xa = name === 'accept' ? rr.map(r => [r[0] * r[6], r[0] * Math.min(r[4], 3 * r[6])]) : rr.map(r => [r[0] * r[6], r[1] * r[6]]);
  const w = fit(Xa, Y); const mae = rr.reduce((a, r, i) => a + Math.abs(Xa[i][0] * w[0] + Xa[i][1] * w[1] - Y[i]), 0) / rr.length, mae0 = Y.reduce((a, y) => a + Math.abs(y), 0) / rr.length;
  console.log(name, 'n', rr.length, 'w', w.map(v => v.toFixed(3)).join(', '), 'mae', mae.toFixed(0), 'mae if 0', mae0.toFixed(0)); void X;
}
console.log('--- richer: features n_a*avg, n_a*ownA, n_b*avg, n_b*ownB; mae by case');
for (const [name, f] of [['accept', r => r[3] < 0], ['a wins', r => r[3] >= 0 && r[2] > r[3]], ['b wins', r => r[3] >= 0 && r[2] < r[3]]]) {
  const rr = rows.filter(f), Y = rr.map(r => r[2] - Math.max(0, r[3]));
  const Xa = rr.map(r => name === 'accept' ? [r[0] * r[6], r[0] * Math.min(r[4], 3 * r[6])] : [r[0] * r[6], r[0] * Math.min(r[4], 3 * r[6]), r[1] * r[6], r[1] * Math.min(r[5], 3 * r[6])]);
  const w = fit(Xa, Y), pred = Xa.map(x => x.reduce((a, v, i) => a + v * w[i], 0));
  const mae = Y.reduce((a, y, i) => a + Math.abs(pred[i] - y), 0) / rr.length, mae0 = Y.reduce((a, y) => a + Math.abs(y), 0) / rr.length;
  console.log(name, 'w', w.map(v => v.toFixed(3)).join(', '), 'mae', mae.toFixed(0), 'mae if 0', mae0.toFixed(0));
}
