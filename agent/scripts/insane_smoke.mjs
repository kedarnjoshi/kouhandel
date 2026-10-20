import { newSimGame, playOut, rng, wins } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
const W = +process.argv[2] || 8;
const ins = makeAgent({ kind: 'insane', worlds: W }), hard = makeAgent({ kind: 'smart' });
let calls = 0, ms = 0;
const timed = { cap: (...a) => { const t = performance.now(); const v = ins.cap(...a); ms += performance.now() - t; calls++; return v; },
  act: (...a) => { const t = performance.now(); const v = ins.act(...a); ms += performance.now() - t; calls++; return v; } };
const r = rng(7), s = newSimGame(4, 40, r), t0 = performance.now();
const sc = playOut(s, [timed, hard, hard, hard], r);
console.log('scores', sc, 'done', s.phase, 'decisions', calls, 'avg ms', (ms / calls).toFixed(0), 'game s', ((performance.now() - t0) / 1000).toFixed(1));
