// Quick match: node agent/scripts/match.mjs '<candidate spec json>' '<field spec json array>' [deals] [players] [size]
import { pool, duplicate, candidateShare } from './pool.mjs';
const [c, f, deals = 500, players = 4, size = 40] = process.argv.slice(2);
const P = pool(), cand = JSON.parse(c), field = JSON.parse(f);
const games = duplicate(cand, field, { deals: +deals, players: +players, size: +size });
const t0 = Date.now(), res = await P.play(games);
const share = candidateShare(games, res), se = Math.sqrt(share * (1 - share) / res.length);
console.log(`candidate win share ${(share * 100).toFixed(1)}% ± ${(se * 100).toFixed(1)} (fair = ${(100 / players).toFixed(1)}%), ${res.length} games in ${((Date.now() - t0) / 1000).toFixed(1)}s, unfinished ${res.filter(r => !r.done).length}`);
P.close();
