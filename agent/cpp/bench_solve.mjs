// The JS solver on the cases saved by dump_solve.mjs (the C++ kernel's counterpart): node agent/cpp/bench_solve.mjs <cases> [repeats]
import fs from 'node:fs';
import { solve } from '../../lib/bots/solver.js';
const [file, reps = 20] = process.argv.slice(2), tok = fs.readFileSync(file, 'utf8').split(/\s+/).filter(Boolean);
let at = 0; const rd = () => +tok[at++];
const cases = [], n = rd();
for (let c = 0; c < n; c++) {
  const [X, ties, floor, iters, eps, maxN, maxPad, habitW, answersW] = Array.from({ length: 9 }, rd);
  const types = () => Array.from({ length: rd() }, () => { const w = rd(), L = rd(); return { w, hand: Array.from({ length: L }, rd) }; });
  const aTypes = types(), bTypes = types(), tabs = Array.from({ length: 4 }, () => Array.from({ length: 2 * X + 1 }, rd));
  const dist = () => Array.from({ length: maxN + 1 }, () => Array.from({ length: rd() }, () => [rd(), rd()]));
  const habit = dist(), answers = dist(); for (let m = 0; m < aTypes.length; m++) { const L = rd(); at += L; }
  const fn = t => ({ win: d => t[0][X + d / 10], lose: d => t[1][X + d / 10] });
  cases.push({ aTypes, bTypes, UA: fn([tabs[0], tabs[1]]), UB: fn([tabs[2], tabs[3]]), ties: !!ties, floor, iters, eps, maxN, maxPad,
    habit: habitW > 0 ? k => habit[k] || [] : null, habitW, answers: answersW > 0 ? k => answers[k] || [] : null, answersW });
}
for (const c of cases) solve(c); // warm up
const t0 = performance.now();
for (let r = 0; r < +reps; r++) for (const c of cases) solve(c);
console.log(`${cases.length} cases: ${((performance.now() - t0) / +reps / cases.length).toFixed(3)} ms per solve (JS)`);
