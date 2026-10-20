import { newSimGame, playOut, rng, wins } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
import { imagine } from '../../lib/bots/insane.js';
import { readFileSync } from 'node:fs';
const th = JSON.parse(readFileSync('agent/runs/stageC.params.json'));
const hard = makeAgent({ kind: 'smart', th });
const r = rng(11), s = newSimGame(4, 40, r);
playOut(s, [hard, hard, hard, hard], r, 30); // partway
console.log('phase', s.phase, 'deck', s.deck.length, 'clock', s.clock, 'due', s.due);
// full playouts from imagined worlds: do they finish? who wins?
let unfinished = 0, steps = [], w0 = [0, 0, 0, 0];
for (let k = 0; k < 40; k++) {
  const d = imagine(s, 0, rng(100 + k)), rr = rng(200 + k);
  const sc = playOut(d, [hard, hard, hard, hard], rr, 600);
  if (d.phase !== 'over') unfinished++;
  wins(sc).forEach((x, i) => w0[i] += x);
}
console.log('unfinished', unfinished, 'wins by seat', w0);
// the same from the real state
let w1 = [0, 0, 0, 0];
for (let k = 0; k < 40; k++) { const d = JSON.parse(JSON.stringify(s)), rr = rng(300 + k); const sc = playOut(d, [hard, hard, hard, hard], rr, 600); wins(sc).forEach((x, i) => w1[i] += x); }
console.log('real-state wins by seat', w1);
