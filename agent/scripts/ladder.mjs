// Mixed tables of every level, for ratings: node agent/scripts/ladder.mjs <out.json> <games> [levels] [deck sizes]
// Each game seats 3-5 bots drawn at random from the levels (a level can appear twice); results are saved per game.
import { writeFileSync, readFileSync } from 'node:fs';
import { pool } from './pool.mjs';
import { rng } from '../../lib/bots/sim.js';
import { LEVELS } from '../../lib/bots/index.js';

const [out = 'agent/runs/ladder.json', n = 1000, levelsArg = 'novice,easy,medium,hard,random,confusing', sizesArg = '40'] = process.argv.slice(2);
const levels = levelsArg.split(','), sizes = sizesArg.split(',').map(Number);
import { existsSync } from 'node:fs';
const named = existsSync('agent/runs/specs.json') ? JSON.parse(readFileSync('agent/runs/specs.json')) : {}; // extra named specs for experiments
const spec = l => (named[l] ? named[l] : l === 'novice' ? { kind: 'novice' } : l.startsWith('p:') ? { kind: 'smart', th: JSON.parse(readFileSync(`agent/runs/${l.slice(2)}.params.json`)) } : l.startsWith('insane') ? { ...LEVELS.insane.spec, worlds: +(l.split(':')[1] || 0) || undefined, depth: +(l.split(':')[2] || 0) || undefined } : LEVELS[l].spec);
const r = rng(12345), games = [];
for (let g = 0; g < +n; g++) {
  const players = 3 + Math.floor(r() * 3), seats = Array.from({ length: players }, () => levels[Math.floor(r() * levels.length)]);
  games.push({ specs: seats.map(spec), seed: 1000 + g, size: sizes[g % sizes.length], seats });
}
const P = pool(), t0 = Date.now();
const res = await P.play(games, 2);
writeFileSync(out, JSON.stringify(games.map((g, i) => ({ seats: g.seats, size: g.size, scores: res[i].scores, done: res[i].done }))));
console.log(`${games.length} games in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${out}`);
P.close();
