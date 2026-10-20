// Milliseconds per decision for an insane budget: node agent/scripts/time_insane.mjs <worlds> <depth> [params json]
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
const [W = 8, D = 16, th = '{}'] = process.argv.slice(2);
const ins = makeAgent({ kind: 'insane', worlds: +W, depth: +D, th: JSON.parse(th) }), hard = makeAgent({ kind: 'smart', th: JSON.parse(th) });
const times = [];
const wrap = { cap: (...a) => { const t = performance.now(); const v = ins.cap(...a); times.push(performance.now() - t); return v; },
  act: (...a) => { const t = performance.now(); const v = ins.act(...a); times.push(performance.now() - t); return v; } };
for (let g = 0; g < 2; g++) { const r = rng(g + 3), s = newSimGame(4, 40, r); playOut(s, [wrap, hard, hard, hard], r); }
times.sort((a, b) => a - b);
console.log(`worlds ${W} depth ${D}: ${times.length} decisions, median ${times[times.length >> 1].toFixed(0)}ms, p90 ${times[Math.floor(times.length * 0.9)].toFixed(0)}ms, max ${times[times.length - 1].toFixed(0)}ms`);
