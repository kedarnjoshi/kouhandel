// How often and how high a bot opens above 10 (th.open), and what happens to those auctions:
// node agent/scripts/opens.mjs <bot> <field> [games] [players]
import { newSimGame, playOut, rng, bidOf } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
import { sum } from '../../lib/rules.js';
const [cand = 'insane:open=1', field = 'hard', G = 20, n = 3] = process.argv.slice(2);
const A = agentFor(cand), F = agentFor(field);
let auc = 0, opened = 0, rows = [];
for (let g = 0; g < +G; g++) {
  const rand = rng(100 + g), s = newSimGame(+n, +(process.env.SIZE || 40), rand);
  const agents = Array.from({ length: +n }, (_, j) => (j === 0 ? A : F));
  const probe = { bid: (s, j, r) => { const b = bidOf(A, s, j, r); auc++; if (b.open) { opened++; if (rows.length < 25) rows.push(`${s.auction.type} cap ${b.cap} open ${b.open} money ${sum(s.players[j].money)}`); } return b; }, act: A.act };
  agents[0] = probe;
  playOut(s, agents, rand);
}
console.log(`${opened}/${auc} auctions opened high`); console.log(rows.join('\n'));
