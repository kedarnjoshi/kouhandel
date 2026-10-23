// Explain v2's bid limits at the auction where the deck has <deck> cards left: node agent/scripts/whycap.mjs <seed> <lineup> <deck>
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum, TYPES } from '../../lib/rules.js';
import { Model } from '../../lib/bots/brain.js';
import { look, plainLimit, asSeenBy, bidCap, EXPERT } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
const [seed, lineup, deck] = process.argv.slice(2);
const names = lineup.split(','), agents = names.map(agentFor), r = rng(+seed), s = newSimGame(names.length, 40, r);
for (let step = 0; s.phase !== 'over'; step++) {
  if (s.phase === 'auction' && s.auction.stage === 'bidding') {
    const a = s.auction;
    if (s.deck.length === +deck) {
      console.log('auction', a.type, 'by', a.auctioneer);
      s.players.forEach((p, j) => console.log(`  P${j} $${sum(p.money)} [${p.money.join(',')}]`, TYPES.filter(t => p.animals[t]).map(t => t + p.animals[t]).join(' ')));
      for (let j = 0; j < names.length; j++) {
        if (j === a.auctioneer) continue;
        const o = look(s, j), th = EXPERT, M = new Model(o, th), k = o.auction.k, A = a.auctioneer;
        console.log(`P${j}: plain ${plainLimit(o, th, M)} cap ${bidCap(o, th, M)}  U now ${M.util(j, [], []).toFixed(4)} A-free ${M.util(j, [[A, k, 1]], []).toFixed(4)} me@10 ${M.util(j, [[j, k, 1]], [[j, -10], [A, 10]]).toFixed(4)} A-buys@10 ${M.util(j, [[A, k, 1]], [[A, -10], [j, 10]]).toFixed(4)}`);
        for (const x of o.active) if (x !== j && x !== A) { const ox = asSeenBy(o, x); console.log(`     predicted plain limit of P${x}: ${plainLimit(ox, th, new Model(ox, th))}`); }
      }
      break;
    }
    const caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
    const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
    if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
    s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
  }
  const w = waiting(s);
  apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++);
}
