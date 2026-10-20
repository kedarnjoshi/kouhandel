// SPSA tuning (as chess engines are tuned): every step plays a version with all parameters nudged up against one
// with them nudged down (random directions), and moves the parameters towards the side that scored better.
// node agent/scripts/spsa.mjs <out.jsonl> <steps> [deals per step] [players] [base spec json] [field: name;name;...]
// Tables: the two nudged versions plus field players (3 players: +, -, one field player), every seating of a deal.
import fs from 'node:fs';
import { pool } from './pool.mjs';
import { EXPERT } from '../../lib/bots/expert.js';
import { DEFAULTS } from '../../lib/bots/brain.js';

const [out = 'spsa.jsonl', steps = 60, deals = 24, players = 3, baseArg = '', fieldArg = ''] = process.argv.slice(2);
const base = baseArg ? JSON.parse(baseArg) : { kind: 'expert', th: { ...EXPERT, solve: 1 } };
// name, low, high, log scale
const SPACE = [['tau', 0.5, 3, 1], ['tau1', 10, 250, 1], ['rho', 0.5, 2.5, 0], ['gamma', 0.6, 2, 0], ['delta', 0.3, 1.6, 0], ['mu', 100, 1500, 1], ['mDec', -0.05, 0.1, 0], ['shade', 0.8, 1.4, 0]];
const toX = (v, [, lo, hi, lg]) => (lg ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo));
const fromX = (x, [, lo, hi, lg]) => { x = Math.min(1, Math.max(0, x)); return lg ? lo * Math.pow(hi / lo, x) : lo + x * (hi - lo); };
const th0 = { ...DEFAULTS, ...base.th };
let x = SPACE.map(p => toX(th0[p[0]] ?? (p[0] === 'shade' ? 1 : 0), p));
// resume from the last line of an existing run
if (fs.existsSync(out)) { const lines = fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean); if (lines.length) { const last = JSON.parse(lines[lines.length - 1]); x = SPACE.map(p => toX(last.th[p[0]], p)); console.log('resuming at', last.step); } }
const spec = xs => ({ ...base, th: { ...base.th, ...Object.fromEntries(SPACE.map((p, i) => [p[0], +fromX(xs[i], p).toPrecision(4)])) } });
const field = fieldArg ? fieldArg.split(';') : [base];
const perms = n => { const out = []; const rec = (a, rest) => { if (!rest.length) out.push(a); rest.forEach((v, i) => rec([...a, v], rest.filter((_, j) => j !== i))); }; rec([], [...Array(n).keys()]); return out; };
const P = pool(), A = +(process.env.SPSA_A || 0.004), C = 0.06; // step size and nudge, in units of each parameter's range
let start = 0; if (fs.existsSync(out)) start = fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).length;
for (let t = start; t < start + +steps; t++) {
  const ck = C / Math.pow(1 + t / 30, 0.101), ak = A / Math.pow(1 + t / 10, 0.602) * 3;
  const d = SPACE.map(() => (Math.random() < 0.5 ? -1 : 1));
  const plus = spec(x.map((v, i) => v + ck * d[i])), minus = spec(x.map((v, i) => v - ck * d[i]));
  const games = [], seed0 = 100000 + t * 1000;
  for (let g = 0; g < +deals; g++) {
    const roles = [plus, minus, ...Array.from({ length: +players - 2 }, (_, f) => field[(g + f) % field.length])];
    for (const pm of perms(+players).slice(0, +players === 3 ? 6 : 12)) games.push({ specs: pm.map(r => roles[r]), seed: seed0 + g, size: 40, who: pm });
  }
  const res = await P.play(games, 3);
  let sp = 0, sm = 0;
  res.forEach((r, i) => { const pm = games[i].who; pm.forEach((role, seat) => { if (role === 0) sp += r.wins[seat]; if (role === 1) sm += r.wins[seat]; }); });
  const diff = (sp - sm) / games.length; // difference in win share per game
  x = x.map((v, i) => Math.min(1, Math.max(0, v + ak * diff / (2 * ck) * d[i] * 2)));
  const th = Object.fromEntries(SPACE.map((p, i) => [p[0], +fromX(x[i], p).toPrecision(4)]));
  fs.appendFileSync(out, JSON.stringify({ step: t, diff: +diff.toFixed(4), plus: +(sp / games.length).toFixed(3), minus: +(sm / games.length).toFixed(3), th }) + '\n');
  console.log(t, 'diff', diff.toFixed(3), JSON.stringify(th));
}
P.close();
