// How much auction payments overpay (no change is given), which only the payer and payee see:
// node agent/scripts/overpay.mjs [lineup a;b;c] [games]
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
const [lineup = 'hard;hard;hard', G = 40] = process.argv.slice(2);
const agents = lineup.split(';').map(agentFor), rows = [];
for (let g = 0; g < +G; g++) {
  const r = rng(700 + g), s = newSimGame(agents.length, 40, r); playOut(s, agents, r);
  for (const e of s.hist || []) if (e.t === 'a' && e.cs) rows.push([e.p, e.m, e.cs.reduce((a, b) => a + b, 0) - e.p]);
}
const by = f => { const m = new Map(); for (const x of rows) { const k = f(x); const a = m.get(k) || []; a.push(x[2]); m.set(k, a); } return [...m].sort((a, b) => a[0] - b[0]); };
const st = a => { const n = a.length, mean = a.reduce((x, y) => x + y, 0) / n, sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / n); return `n ${n} share>0 ${(a.filter(x => x > 0).length / n).toFixed(2)} mean ${mean.toFixed(1)} sd ${sd.toFixed(1)}`; };
console.log('all', st(rows.map(x => x[2])));
for (const [k, a] of by(x => (x[0] < 50 ? 0 : x[0] < 100 ? 50 : x[0] < 200 ? 100 : x[0] < 400 ? 200 : 400))) console.log('price from', k, st(a));
for (const [k, a] of by(x => Math.min(x[1], 5))) console.log('cards', k, st(a));
