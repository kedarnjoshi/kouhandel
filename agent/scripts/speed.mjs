// Time per decision for an agent, by kind of decision: node agent/scripts/speed.mjs <agent> [games] [players] [deck size]
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
const [name = 'v2', games = 3, players = 4, size = 40] = process.argv.slice(2);
const A = agentFor(name), T = {}, add = (k, t) => { (T[k] ||= []).push(t); };
for (let g = 0; g < +games; g++) {
  const r = rng(77 + g), s = newSimGame(+players, +size, r);
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') {
      const a = s.auction, caps = s.players.map((p, j) => { if (j === a.auctioneer) return -1; const t0 = performance.now(), c = A.cap(s, j, r); add('cap', performance.now() - t0); return Math.min(c, sum(p.money)); });
      const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
      if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
      s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
    }
    const w = waiting(s); if (!w) break;
    const t0 = performance.now(), act = A.act(s, w.p, w.what, r); add(w.what + (w.what === 'turn' && !s.deck.length ? '-end' : ''), performance.now() - t0);
    try { apply(s, w.p, act, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
for (const [k, a] of Object.entries(T)) console.log(k.padEnd(9), 'n', String(a.length).padStart(4), 'median', q(a, 0.5).toFixed(1), 'ms  p90', q(a, 0.9).toFixed(1), 'max', Math.max(...a).toFixed(1));
