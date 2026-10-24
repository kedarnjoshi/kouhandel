// Time per bot decision (one thread), to check live moves stay quick: node agent/scripts/movetime.mjs <spec> [games] [deck size] [players]
import { newSimGame, rng, playOut } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
const [spec, games = 4, size = 20, players = 3] = process.argv.slice(2), a = agentFor(spec), ts = {};
const timed = (f, what) => (...x) => { const t0 = performance.now(), r = f(...x); (ts[what(x)] ||= []).push(performance.now() - t0); return r; };
const b = { ...a, act: timed(a.act, x => x[2]) };
if (a.bid) b.bid = timed(a.bid, () => 'bid'); if (a.cap) b.cap = timed(a.cap, () => 'bid');
for (let g = 0; g < +games; g++) { const r = rng(g + 1), s = newSimGame(+players, +size, r); playOut(s, Array(+players).fill(b), r); }
for (const [w, v] of Object.entries(ts)) {
  v.sort((x, y) => x - y);
  console.log(`${w.padEnd(7)} n=${String(v.length).padStart(5)} mean ${(v.reduce((x, y) => x + y, 0) / v.length).toFixed(1)} ms  p95 ${v[Math.floor(v.length * 0.95)].toFixed(1)}  max ${v[v.length - 1].toFixed(1)}`);
}
