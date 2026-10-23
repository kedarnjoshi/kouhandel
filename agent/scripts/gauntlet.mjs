// A candidate against several opponents in turn (each one fills all other seats), duplicate deals:
// node agent/scripts/gauntlet.mjs <candidate> <opp1;opp2;...> [deals] [players] [deck size]   (an opponent may be a field: a|b)
// Prints the win share per opponent relative to fair (1.00 = level), with a standard error.
import { pool, duplicate } from './pool.mjs';
const [cand, oppsArg = 'v2;hard0;shark;caller;padder', deals = 60, players = 3, size = 40] = process.argv.slice(2);
const P = pool(), t0 = Date.now(), n = +players, rows = [];
for (const opp of oppsArg.split(';')) {
  const games = duplicate(cand, opp.split('|'), { deals: +deals, players: n, size: +size, seed0: 5000 + n });
  const res = await P.play(games, 3);
  const errs = res.filter(r => r.errors); if (errs.length) console.log(`!! ${errs.length} games with bot errors, e.g. ${errs[0].lastError}`);
  const w = res.map((r, i) => r.wins[games[i].seat] * n), m = w.reduce((a, b) => a + b, 0) / w.length;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  rows.push(`${opp}: ${m.toFixed(2)} ±${(sd / Math.sqrt(w.length)).toFixed(2)}`);
  console.log(`  ${cand} vs ${rows[rows.length - 1]}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
console.log(`${cand} @${n}p${+size !== 40 ? '/' + size : ''}: ${rows.join(' | ')}`);
P.close();
