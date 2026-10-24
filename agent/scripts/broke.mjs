// How often does a seat run out of money while animals are still to come, and how does it do then?
// node agent/scripts/broke.mjs <lineup> [games] [deck size] [threshold]   (seat 0 is the one measured)
import { newSimGame, rng, settleAuction, wins } from '../../lib/bots/sim.js';
import { apply, waiting, tick, score, countsOf } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
const [lineup, games = 60, size = 20, th = 20] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), n = names.length, R = names.map(() => ({ broke: 0, bw: 0, ok: 0, ow: 0, endM: 0 }));
for (let g = 0; g < +games; g++) for (let rot = 0; rot < n; rot++) {
  const r = rng(9000 + g), s = newSimGame(n, +size, r), seatOf = j => (j + rot) % n, ag = names.map((_, x) => agents[(x - rot + n) % n]);
  const low = new Array(n).fill(false);
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.deck.length >= +size / 4) s.players.forEach((p, j) => { if (sum(p.money) <= +th) low[j] = true; });
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, ag, r); continue; }
    const w = waiting(s); if (!w) break;
    let a; try { a = ag[w.p].act(s, w.p, w.what, r); } catch { a = null; }
    try { apply(s, w.p, a, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  const wn = wins(s.players.map(p => score(p, countsOf(s)).score));
  names.forEach((_, x) => { const j = seatOf(x), t = R[x]; if (low[j]) { t.broke++; t.bw += wn[j]; } else { t.ok++; t.ow += wn[j]; } });
}
names.forEach((nm, x) => { const t = R[x]; console.log(`${nm.padEnd(24)} broke (<=${th} with a quarter of the deck left) in ${(100 * t.broke / (t.broke + t.ok)).toFixed(0)}% of games, wins then ${(t.bw / Math.max(1, t.broke)).toFixed(2)}, otherwise ${(t.ow / Math.max(1, t.ok)).toFixed(2)}`); });
