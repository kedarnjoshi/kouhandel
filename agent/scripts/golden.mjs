// A fingerprint of how the bots play: a few whole games with fixed seeds, every move hashed. Run before and after a
// change that should only make things faster (node agent/scripts/golden.mjs [spec] [games]); the hashes must match.
import { createHash } from 'node:crypto';
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { agentFor } from './registry.mjs';
const [spec = 'insane', games = 4] = process.argv.slice(2), a = agentFor(spec), h = createHash('sha1'), t0 = performance.now();
for (const size of [20, 40]) for (let g = 0; g < +games; g++) {
  const r = rng(424242 + g), s = newSimGame(3, size, r), ag = [a, a, a];
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, ag, r); h.update(JSON.stringify(s.auction.high)); continue; }
    const w = waiting(s); if (!w) break;
    let mv; try { mv = ag[w.p].act(s, w.p, w.what, r); } catch (e) { mv = null; h.update('err' + e); }
    h.update(JSON.stringify(mv));
    try { apply(s, w.p, mv, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  h.update(JSON.stringify(s.players.map(p => [p.money, p.animals])));
}
console.log(`${spec}: ${h.digest('hex')} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
