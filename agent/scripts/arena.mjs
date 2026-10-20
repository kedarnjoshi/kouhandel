// Candidate vs field, duplicate deals at 3, 4 and 5 players: node agent/scripts/arena.mjs <candidate> <field;...> [deals] [sizes] [players]
// Names are resolved by registry.mjs (levels, old bots, shark, novice). Prints the win share per table size
// relative to fair (1.00 = as good as the field) with a standard error.
import { pool, duplicate } from './pool.mjs';
const [cand, fieldArg, deals = 200, sizesArg = '40', playersArg = '3,4,5'] = process.argv.slice(2);
const field = fieldArg.split(';'), sizes = sizesArg.split(',').map(Number), players = playersArg.split(',').map(Number);
const P = pool(), t0 = Date.now();
const out = [];
let all = 0, allN = 0, allVar = 0;
for (const n of players) for (const size of sizes) {
  const games = duplicate(cand, field, { deals: +deals, players: n, size, seed0: 1000 * n + size });
  const res = await P.play(games, 4);
  const errs = res.filter(r => r.errors); if (errs.length) console.log(`!! ${errs.length} games with bot errors, e.g. ${errs[0].lastError}`);
  const w = res.map((r, i) => r.wins[games[i].seat] * n);
  const m = w.reduce((a, b) => a + b, 0) / w.length, sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  out.push(`${n}p/${size}: ${m.toFixed(2)} ±${(sd / Math.sqrt(w.length)).toFixed(2)}${res.some(r => !r.done) ? ` (${res.filter(r => !r.done).length} unfinished)` : ''}`);
  all += m * w.length; allN += w.length; allVar += sd * sd * w.length;
}
console.log(`${cand} vs ${fieldArg}: ${(all / allN).toFixed(3)} ±${(Math.sqrt(allVar / allN) / Math.sqrt(allN)).toFixed(3)}  [${out.join(', ')}]  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
P.close();
