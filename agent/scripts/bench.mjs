import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { smart } from '../../lib/bots/policies.js';
import { DEFAULTS, Model } from '../../lib/bots/brain.js';
const orig = Model.prototype.util; let calls = 0; Model.prototype.util = function (...a) { calls++; return orig.apply(this, a); };
const cnt = {}; const A = [0,1,2,3].map(() => smart(DEFAULTS));
const wrap = A.map(a => ({ cap: (s, i, r) => { const c0 = calls; const v = a.cap(s, i, r); cnt.cap = (cnt.cap || 0) + calls - c0; return v; },
  act: (s, i, w, r) => { const c0 = calls; const v = a.act(s, i, w, r); cnt[w] = (cnt[w] || 0) + calls - c0; cnt[w + '#'] = (cnt[w + '#'] || 0) + 1; return v; } }));
const N = 50, t0 = performance.now();
for (let g = 0; g < N; g++) { const r = rng(g + 1); playOut(newSimGame(4, 40, r), wrap, r); }
const ms = performance.now() - t0;
console.log('util calls/game', calls / N, 'ns/call approx', (ms * 1e6 / calls).toFixed(0)); for (const k in cnt) console.log(k, Math.round(cnt[k] / N));
