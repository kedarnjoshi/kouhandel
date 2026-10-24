// Koehandels once the deck is empty: who wins and how much the winner pays the loser, against both players' money.
// For fitting the endgame model (lib/bots/endgame.js). node agent/scripts/endkh.mjs <lineup> [games] [deck size]
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
const [lineup = 'insane;insane;insane', games = 100, size = 20] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), rows = [];
for (let g = 0; g < +games; g++) {
  const r = rng(4000 + g), s = newSimGame(names.length, +size, r);
  let pend = null;
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    if (!s.deck.length && s.phase === 'trade' && !pend) pend = { a: s.trade.a, b: s.trade.b, ma: sum(s.players[s.trade.a].money), mb: sum(s.players[s.trade.b].money), k: s.trade.type, c: s.trade.count, hk: s.hist ? s.hist.length : 0 };
    try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
    if (pend && s.hist && s.hist.length > pend.hk) {
      const e = s.hist[s.hist.length - 1];
      if (e.t === 'k') { const da = sum(s.players[pend.a].money) - pend.ma; rows.push({ ...pend, aWins: e.win === pend.a, net: da }); }
      pend = null;
    }
  }
}
// summary: attacker win rate by who is richer, and what the winner paid as a share of the loser's money (+10)
const bin = rows => { const n = rows.length || 1; return { n: rows.length, aWin: (rows.filter(x => x.aWins).length / n).toFixed(2) }; };
const rich = rows.filter(x => x.ma > x.mb + 20), poor = rows.filter(x => x.ma + 20 < x.mb), even = rows.filter(x => Math.abs(x.ma - x.mb) <= 20);
console.log(`${lineup} @${size}: ${rows.length} endgame koehandels; attacker richer`, bin(rich), 'even', bin(even), 'defender richer', bin(poor));
const share = (rs, win) => { const v = rs.map(x => { const paid = win(x) ? -x.net : x.net, loserM = win(x) ? x.mb : x.ma; return paid / (loserM + 10); }); v.sort((a, b) => a - b); return v.length ? `median ${v[Math.floor(v.length / 2)].toFixed(2)} mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)} (n ${v.length})` : '-'; };
console.log('attacker won: paid / (defender money + 10):', share(rows.filter(x => x.aWins), () => true));
console.log('defender won: paid / (attacker money + 10):', share(rows.filter(x => !x.aWins), () => false));
// least squares: paid = a * loser's money + b * winner's money + c, by who won
const fit = (rs, win) => {
  const X = rs.map(x => (win ? [x.mb, x.ma, 1] : [x.ma, x.mb, 1])), y = rs.map(x => (win ? -x.net : x.net));
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  X.forEach((r, i) => { for (let p = 0; p < 3; p++) { v[p] += r[p] * y[i]; for (let q = 0; q < 3; q++) A[p][q] += r[p] * r[q]; } });
  for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) { const f = A[q][p] / A[p][p]; for (let z = 0; z < 3; z++) A[q][z] -= f * A[p][z]; v[q] -= f * v[p]; }
  const w = [0, 0, 0]; for (let p = 2; p >= 0; p--) { let t = v[p]; for (let q = p + 1; q < 3; q++) t -= A[p][q] * w[q]; w[p] = t / A[p][p]; }
  return w.map(x => x.toFixed(2)).join(', ');
};
console.log('paid = a*loser money + b*winner money + c; attacker won:', fit(rows.filter(x => x.aWins), true), ' defender won:', fit(rows.filter(x => !x.aWins), false));
