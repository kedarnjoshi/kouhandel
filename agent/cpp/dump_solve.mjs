// Saves the koehandel solver's inputs and results from real games, for checking and timing the C++ kernel:
// node agent/cpp/dump_solve.mjs <out.txt> [games]   (one case per block; see solve.cpp for the format)
import fs from 'node:fs';
import { newSimGame, rng, playOut } from '../../lib/bots/sim.js';
import { agentFor } from '../scripts/registry.mjs';
const [out, games = 2] = process.argv.slice(2), a = agentFor('insane'), lines = [];
const num = x => (Number.isInteger(x) ? String(x) : x.toPrecision(17));
const list = (f, maxN) => { const r = []; for (let n = 0; n <= maxN; n++) { const l = f ? f(n) : []; r.push(l.length, ...l.flat().map(num)); } return r.join(' '); };
globalThis.DBG_SOLVE = c => {
  const L = [[c.X, c.ties ? 1 : 0, c.floor, c.iters, num(c.eps), c.maxN, c.maxPad, num(c.habitW), num(c.answersW)].join(' ')];
  for (const T of [c.aTypes, c.bTypes]) { L.push(T.length); for (const t of T) L.push([num(t.w), t.hand.length, ...t.hand].join(' ')); }
  for (const t of [c.aW, c.aL, c.bW, c.bL]) L.push(Array.from(t, num).join(' '));
  L.push(c.habit && c.habitW > 0 ? list(c.habit, c.maxN) : list(null, c.maxN));
  L.push(c.answers && c.answersW > 0 ? list(c.answers, c.maxN) : list(null, c.maxN));
  for (const t of c.A) L.push([t.cnt.length, ...Array.from(t.cnt, num)].join(' '));
  lines.push(L.join('\n'));
};
const t0 = performance.now();
for (let g = 0; g < +games; g++) { const r = rng(900 + g), s = newSimGame(3, 20, r); playOut(s, [a, a, a], r); }
fs.writeFileSync(out, lines.length + '\n' + lines.join('\n') + '\n');
console.log(`${lines.length} solves dumped (${((performance.now() - t0) / 1000).toFixed(1)}s including the dump)`);
