import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { DEFAULTS, Model, observe } from '../../lib/bots/brain.js';
import { smart } from '../../lib/bots/policies.js';
const r = rng(5), s = newSimGame(4, 40, r);
// play partway
const A = [0,1,2,3].map(() => smart(DEFAULTS));
playOut(s, A, r, 60);
const o = observe(s, 0), M = new Model(o, DEFAULTS);
let x = 0; const t0 = performance.now(), N = 1e6;
const dh = [[0, 3, 1], [1, 3, -1]], dm = [[0, -50], [1, 50]];
for (let i = 0; i < N; i++) x += M.util(0, dh, dm);
console.log('ns/util (static args)', ((performance.now() - t0) * 1e6 / N).toFixed(0), x > 0);
const t1 = performance.now();
for (let i = 0; i < N; i++) x += M.util(0, [[0, 3, 1], [1, 3, -1]], [[0, -i % 300], [1, i % 300]]);
console.log('ns/util (fresh args)', ((performance.now() - t1) * 1e6 / N).toFixed(0));
