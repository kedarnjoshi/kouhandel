import { newSimGame, playOut, rng, wins } from '../../lib/bots/sim.js';
import { smart, random, confusing } from '../../lib/bots/policies.js';
import { DEFAULTS } from '../../lib/bots/brain.js';
const N = +process.argv[2] || 100, kinds = (process.argv[3] || 'smart,smart,random,random').split(',');
const mk = k => k === 'smart' ? smart(DEFAULTS) : k === 'random' ? random : k === 'confusing' ? confusing(DEFAULTS) : smart(DEFAULTS, { noise: 0.35, slip: 0.15 });
const agents = kinds.map(mk), tot = kinds.map(() => 0); let steps = 0, unfinished = 0, scoreSum = kinds.map(() => 0);
const t0 = performance.now();
for (let g = 0; g < N; g++) {
  const r = rng(g + 1), s = newSimGame(kinds.length, 40, r);
  // rotate seats so position doesn't matter
  const rot = g % kinds.length, seat = kinds.map((_, i) => agents[(i + rot) % kinds.length]);
  const sc = playOut(s, seat, r);
  if (s.phase !== 'over') unfinished++;
  const w = wins(sc);
  for (let i = 0; i < kinds.length; i++) { tot[(i + rot) % kinds.length] += w[i]; scoreSum[(i + rot) % kinds.length] += sc[i]; }
}
const ms = (performance.now() - t0) / N;
console.log(`${ms.toFixed(2)} ms/game, unfinished ${unfinished}`);
kinds.forEach((k, i) => console.log(k.padEnd(10), (tot[i] / N * 100).toFixed(1) + '%', 'avg score', Math.round(scoreSum[i] / N)));
