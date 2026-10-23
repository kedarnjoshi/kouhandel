// Koehandel offers in self-play, against what the defender really had: node agent/scripts/offers.mjs <lineup> [games]
// Per offer: the defender's real money and card count, the attacker's estimate (and its uncertainty), the offer and
// the answer. Shows how much is paid above what the defender could ever counter.
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum, TYPES } from '../../lib/rules.js';
import { look } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
const [lineup = 'v3,v3,v3', games = 6] = process.argv.slice(2);
const names = lineup.split(lineup.includes(';') ? ';' : ','), agents = names.map(agentFor);
let waste = 0, n = 0, over = 0;
for (let g = 0; g < +games; g++) {
  const r = rng(300 + g), s = newSimGame(names.length, 40, r);
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    const a = agents[w.p].act(s, w.p, w.what, r);
    if (w.what === 'offer') {
      const tr = s.trade, o = look(s, w.p), real = sum(s.players[tr.b].money), x = sum(a.cards);
      n++; if (x > real + 10) { over++; waste += x - real - 10; }
      console.log(`g${g} deck ${String(s.deck.length).padStart(2)} P${w.p}->P${tr.b} ${tr.type.padEnd(7)} x${tr.count}  offer ${String(x).padStart(4)} in ${a.cards.length}  | def real ${String(real).padStart(4)} [${s.players[tr.b].money.length} cards]  est ${o.money[tr.b]} sd ${Math.round(o.sd[tr.b])}  att has ${sum(s.players[w.p].money)}`);
    }
    try { apply(s, w.p, a, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
console.log(`offers ${n}, above defender's money+10: ${over}, average excess ${(waste / Math.max(1, over)).toFixed(0)}`);
