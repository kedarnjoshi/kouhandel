// Win share of several candidate specs against one field: node agent/scripts/grid.mjs '<field json>' deals '<json array of specs>'
import { pool, duplicate, candidateShare } from './pool.mjs';
const [fieldJson, deals = 200, specsJson] = process.argv.slice(2);
const P = pool(), field = JSON.parse(fieldJson);
for (const spec of JSON.parse(specsJson)) {
  const games = duplicate(spec, field, { deals: +deals, players: 4, seed0: 777 });
  const res = await P.play(games), sh = candidateShare(games, res);
  console.log(`${(sh * 100).toFixed(1).padStart(5)}% ±${(Math.sqrt(sh * (1 - sh) / res.length) * 100).toFixed(1)}  ${JSON.stringify(spec)}`);
}
P.close();
