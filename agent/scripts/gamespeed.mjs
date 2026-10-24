// Time for whole games per policy (one thread): node agent/scripts/gamespeed.mjs <spec> [games] [deck size] [players]
import { newSimGame, rng, playOut } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
const [spec, games = 20, size = 20, players = 3] = process.argv.slice(2), a = agentFor(spec), t0 = performance.now();
for (let g = 0; g < +games; g++) { const r = rng(g + 1), s = newSimGame(+players, +size, r); playOut(s, Array(+players).fill(a), r); }
console.log(`${spec}: ${((performance.now() - t0) / +games).toFixed(1)} ms per game (${size} cards, ${players} players)`);
