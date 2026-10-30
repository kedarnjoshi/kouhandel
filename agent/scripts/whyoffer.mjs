// Endgame koehandel offers of seat 0: what it offers, what it believes the defender holds (look()'s money estimate)
// against the truth, and the outcome: node agent/scripts/whyoffer.mjs "<spec;spec;spec>" <first seed> <games>
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
import { look, forDeck } from '../../lib/bots/expert.js';
import { LEVELS } from '../../lib/bots/index.js';
import { sum, TYPES } from '../../lib/rules.js';
const [lineup, seed0 = 1, games = 2] = process.argv.slice(2);
const specs = lineup.split(';'), th = forDeck(LEVELS.insane.spec.th, 40);
const rows = [];
for (let g = 0; g < +games; g++) {
  const r = rng(+seed0 + g), s = newSimGame(specs.length, 40, r);
  const agents = specs.map((sp, seat) => {
    const a = agentFor(sp);
    if (seat) return a;
    return { ...a, act(st, i, what, rr) {
      const mv = a.act(st, i, what, rr);
      if (what === 'offer' && !st.deck.length) {
        const o = look(st, i, th), b = st.trade.b;
        rows.push({ g: +seed0 + g, b, k: st.trade.type, c: st.trade.count, offer: sum(mv.cards), mine: sum(st.players[i].money), est: Math.round(o.money[b]), real: sum(st.players[b].money), n: st.hist.length });
      }
      return mv;
    } };
  });
  playOut(s, agents, r);
  for (const row of rows.filter(x => x.g === +seed0 + g)) { const e = s.hist.find((h, idx) => idx >= row.n && h.t === 'k' && h.a === 0); if (e) { row.win = e.win === 0; row.counter = e.y; } }
}
for (const x of rows) console.log(`g${x.g} ${x.c} ${x.k} from ${x.b}: offer ${x.offer} (holds ${x.mine}) | defender money est ${x.est} real ${x.real} | ${x.win ? 'won' : 'lost'} counter ${x.counter ?? 'accepted'}`);
const err = rows.map(x => x.est - x.real);
console.log(`offers ${rows.length}, won ${rows.filter(x => x.win).length}; money estimate error mean ${(sum(err) / err.length).toFixed(0)}, offer/holding ${(sum(rows.map(x => x.offer)) / sum(rows.map(x => x.mine))).toFixed(2)}`);
