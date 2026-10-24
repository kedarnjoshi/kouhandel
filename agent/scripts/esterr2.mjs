// Money-estimate error at the moments it matters, for one seat: its koehandel decisions (about the other player in
// the deal) and its bids. node agent/scripts/esterr2.mjs <lineup> [games] [deck size] [seat]
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { look } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
const [lineup = 'insane;shark;shark', games = 60, size = 20, seat = 0] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), me = +seat;
const R = { kh: [], z: [] };
for (let g = 0; g < +games; g++) {
  const r = rng(900 + g), s = newSimGame(names.length, +size, r);
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    if (w.p === me && (w.what === 'offer' || w.what === 'respond')) {
      const o = look(s, me), j = w.what === 'offer' ? s.trade.b : s.trade.a, real = sum(s.players[j].money);
      R.kh.push(o.money[j] - real); R.z.push((o.money[j] - real) / Math.max(1, o.sdS[j]));
    }
    try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
const q = (a, p) => { const b = a.map(Math.abs).sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
console.log(`${lineup} @${size}: ${R.kh.length} koehandel decisions; error about the other side: mean abs ${(R.kh.reduce((a, b) => a + Math.abs(b), 0) / R.kh.length).toFixed(0)}, median ${q(R.kh, 0.5)}, p90 ${q(R.kh, 0.9)}, share off by >=50: ${(R.kh.filter(x => Math.abs(x) >= 50).length / R.kh.length).toFixed(2)}, |z|>2: ${(R.z.filter(x => Math.abs(x) > 2).length / R.z.length).toFixed(2)}`);
