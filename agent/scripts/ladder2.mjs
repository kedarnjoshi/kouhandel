// Mixed tables for ratings, with any names the registry knows (levels, old bots, stand-ins, v2:k=v variants, or
// names from agent/runs/specs2.json): node agent/scripts/ladder2.mjs <out.json> <games> <name;name;...> [players e.g. 3,4,5]
// Each game seats bots drawn at random from the names (a name can appear twice). Rate with agent/scripts/bt.py.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { pool } from './pool.mjs';
import { rng } from '../../lib/bots/sim.js';
const [out, n = 600, namesArg, playersArg = '3,4,5'] = process.argv.slice(2);
const extra = existsSync('agent/runs/specs2.json') ? JSON.parse(readFileSync('agent/runs/specs2.json')) : {};
const names = namesArg.split(';'), players = playersArg.split(',').map(Number), r = rng(4242), games = [];
for (let g = 0; g < +n; g++) {
  const np = players[Math.floor(r() * players.length)], seats = Array.from({ length: np }, () => names[Math.floor(r() * names.length)]);
  games.push({ specs: seats.map(x => extra[x] || x), seed: 70000 + g, size: 40, seats });
}
const P = pool(), t0 = Date.now(), res = await P.play(games, 2);
const errs = res.filter(x => x.errors); if (errs.length) console.log(`!! ${errs.length} games with bot errors, e.g. ${errs[0].lastError}`);
writeFileSync(out, JSON.stringify(games.map((g, i) => ({ seats: g.seats, size: g.size, scores: res[i].scores, done: res[i].done }))));
console.log(`${games.length} games in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${out}`);
P.close();
