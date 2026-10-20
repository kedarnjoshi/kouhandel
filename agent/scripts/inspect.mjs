import { newSimGame, playOut, rng, settleAuction } from '../../lib/bots/sim.js';
import { smart } from '../../lib/bots/policies.js';
import { DEFAULTS, observe, bidLimit } from '../../lib/bots/brain.js';
import { apply, waiting } from '../../lib/engine.js';
const A = [0,1,2,3].map(() => smart(DEFAULTS));
const r = rng(3), s = newSimGame(4, 40, r);
// log every auction: caps per bidder
const orig = settleAuction;
for (let step = 0; s.phase !== 'over' && step < 400; step++) {
  if (s.phase === 'auction' && s.auction.stage === 'bidding') {
    const caps = s.players.map((p, j) => j === s.auction.auctioneer ? '-' : bidLimit(observe(s, j), DEFAULTS));
    const before = s.log.length;
    settleAuction(s, A, r);
    console.log(`${s.deck.length.toString().padStart(2)} ${(s.log[0]).padEnd(40)} caps ${caps.join(' ')}  money ${s.players.map(p => p.money.reduce((a,b)=>a+b,0)).join(' ')}`);
    continue;
  }
  const w = waiting(s); if (!w) break;
  const act = A[w.p].act(s, w.p, w.what, r);
  apply(s, w.p, act, s.clock++);
  if (w.what === 'turn' && act.type === 'koehandel') console.log('   ', s.log[0]);
  if (w.what === 'respond' || (w.what==='offer' && s.phase!=='trade')) console.log('   ', s.log[0], JSON.stringify(act));
}
console.log(s.players.map(p => JSON.stringify(Object.fromEntries(Object.entries(p.animals).filter(([,v])=>v)))).join('\n'));
