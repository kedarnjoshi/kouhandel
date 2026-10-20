// Replay a traced game up to the first koehandel/auction decision matching a filter and explain v2's view.
// node agent/scripts/why.mjs <seed> <lineup> <step-number-of-turn>
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum, TYPES } from '../../lib/rules.js';
import { Model } from '../../lib/bots/brain.js';
import { look, auctionValue, koehandelOptions, planOffer, bidCap, plainLimit, asSeenBy } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
import { EXPERT } from '../../lib/bots/expert.js';
const [seed, lineup, stop] = process.argv.slice(2);
const names = lineup.split(','), agents = names.map(agentFor), r = rng(+seed), s = newSimGame(names.length, 40, r);
let turns = 0;
for (let step = 0; s.phase !== 'over'; step++) {
  if (s.phase === 'auction' && s.auction.stage === 'bidding') {
    const a = s.auction, caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
    const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
    if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
    s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
  }
  const w = waiting(s);
  if (w.what === 'turn' && names[w.p] === 'v2' && s.deck.length && agents[w.p].act(s, w.p, 'turn', rng(1)).type === 'koehandel' && ++turns >= +stop) {
    const o = look(s, w.p), th = EXPERT, M = new Model(o, th);
    console.log('player', w.p, 'money', o.money.join(' '), 'seenAs', o.seenAs.join(' '), 'deck', o.deckLeft, 'future', o.future);
    s.players.forEach((p, j) => console.log(`  P${j} $${sum(p.money)} [${p.money.join(',')}]`, TYPES.filter(t => p.animals[t]).map(t => t + p.animals[t]).join(' ')));
    console.log('now', M.util(w.p, [], []).toFixed(4), 'auction', auctionValue(o, th).toFixed(4));
    for (const t of koehandelOptions(o, th, M, r)) {
      const pl = planOffer(o, th, M, t.p, t.k, t.count, r, false);
      console.log(`  kh P${t.p} ${TYPES[t.k]} x${t.count}: ev ${t.ev.toFixed(4)} full-plan offer ${pl.x}+${pl.p}zeros ev ${pl.ev.toFixed(4)}   win-free ${M.util(w.p, [[w.p, t.k, t.count], [t.p, t.k, -t.count]], []).toFixed(4)} lose-free ${M.util(w.p, [[t.p, t.k, t.count], [w.p, t.k, -t.count]], []).toFixed(4)}`);
    }
    break;
  }
  apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++);
}
// detail of the defender model for the first option (set DETAIL=p,k)
if (process.env.DETAIL) {
  const [jp, kk] = process.env.DETAIL.split(',').map(Number);
  const { offerBelief, bestCounter } = await import('../../lib/bots/expert.js');
  const w = waiting(s), o = look(s, w.p), M = new Model(o, EXPERT);
  const me = w.p, j = jp, k = kk, c = 1;
  const UB = { win: d => M.util(j, [[j, k, c], [me, k, -c]], [[j, d], [me, -d]]), lose: d => M.util(j, [[me, k, c], [j, k, -c]], [[j, d], [me, -d]]) };
  const hands = [{ hand: o.hand, w: 1 }];
  const bel = offerBelief(hands, o.money[j]);
  for (const [n, b] of [...bel].sort((a, b) => a[0] - b[0])) {
    const bc = bestCounter(b, [10, 20, 30, 50, 80, 110, 130], UB, false);
    console.log('n', n, 'belief', b.map(([x, w]) => `${x}:${w.toFixed(2)}`).join(' '), '-> counter', bc.y, 'v', bc.v.toFixed(4), 'acc', bc.acc.toFixed(4));
  }
  console.log('UB win(0)', UB.win(0).toFixed(4), 'lose(0)', UB.lose(0).toFixed(4), 'lose(100)', UB.lose(100).toFixed(4), 'win(-100)', UB.win(-100).toFixed(4));
}
