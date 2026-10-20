// Does searching help? Insane (several budgets) against three hard bots, duplicate deals.
//   node agent/scripts/insane_exp.mjs '<hard params json>' <deals> <configs like 8:0,24:0,8:12> [players] [out name]
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { pool, duplicate, candidateShare } from './pool.mjs';
const [thJson, deals = 30, configs = '8:0', players = 4, name = 'insane'] = process.argv.slice(2);
const th = JSON.parse(thJson), P = pool(), hard = { kind: 'smart', th };
const outFile = `agent/runs/exp-${name}.json`, results = existsSync(outFile) ? JSON.parse(readFileSync(outFile)) : {};
for (const c of configs.split(',')) {
  const [worlds, depth] = c.split(':').map(Number);
  const games = duplicate({ kind: 'insane', th, worlds, depth }, [hard], { deals: +deals, players: +players, seed0: 50000 });
  const t0 = Date.now(), res = await P.play(games, 1), share = candidateShare(games, res), se = Math.sqrt(share * (1 - share) / res.length);
  results[c] = { worlds, depth, share, se, games: res.length, secs: (Date.now() - t0) / 1000 };
  console.log(`worlds ${worlds} depth ${depth || 'full'}: ${(share * 100).toFixed(1)}% ± ${(se * 100).toFixed(1)} (fair ${(100 / players).toFixed(1)}%) ${res.length} games ${results[c].secs}s`);
  writeFileSync(outFile, JSON.stringify(results, null, 1));
}
P.close();
