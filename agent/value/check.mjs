// Checks lib/bots/value.js against PyTorch (agent/value/predict.py) on the first rows of a data file:
//   node agent/value/check.mjs <net.json> <data.bin> [rows]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadNet, NetModel } from '../../lib/bots/value.js';
const [file, data, rows = 50] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(file, 'utf8')), net = loadNet(j), N = j.players, NT = 10;
const want = JSON.parse(execFileSync('python', ['agent/value/predict.py', file, data, String(rows)], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, STYLE: j.style ? '1' : '0' } }));
const ROW = 4 + 2 * NT + N * (NT + 3) + 3 * N + 1 + (j.style ? 2 * N : 0), buf = fs.readFileSync(data), f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
let worst = 0, inc = 0;
for (let r = 0; r < want.length; r++) {
  const a = f.subarray(r * ROW, (r + 1) * ROW), P = x => a[4 + 2 * NT + Math.floor(x / (NT + 3)) * (NT + 3) + (x % (NT + 3))];
  const herd = [], money = [], cards = [], out = [];
  for (let j = 0; j < N; j++) { herd.push(Array.from({ length: NT }, (_, k) => P(j * (NT + 3) + k))); money.push(P(j * (NT + 3) + NT)); cards.push(P(j * (NT + 3) + NT + 1)); out.push(P(j * (NT + 3) + NT + 2) > 0.5); }
  const o = { n: N, out, herd, money, cards, remain: Array.from(a.subarray(4, 4 + NT)), seen: Array.from({ length: NT }, (_, k) => herd.reduce((t, h) => t + h[k], 0)), deckSize: a[0], deckLeft: a[1], mules: a[2], turn: a[3] };
  // style networks: the players' style as the row has it (there is no history here to work it out from)
  const st = j.style ? Array.from({ length: N }, (_, x) => [Math.log(a[ROW - 2 * N + 2 * x]), a[ROW - 2 * N + 2 * x + 1]]) : null;
  const M = new NetModel(o, {}, net); if (st) M.st = st;
  for (let j = 0; j < N; j++) worst = Math.max(worst, Math.abs(M.util(j, [], []) - want[r][j]));
  // a change through util (only the changed type re-evaluated) against a model built on the changed position
  const k = r % NT, p = r % N, q = (r + 1) % N, dh = [[p, k, 1], [q, (k + 3) % NT, -1]], dm = [[p, -40], [q, 40]];
  const o2 = { ...o, herd: herd.map(h => h.slice()), money: money.slice() };
  for (const [x, t, d] of dh) o2.herd[x][t] = Math.max(0, o2.herd[x][t] + d);
  for (const [x, d] of dm) o2.money[x] += d;
  const M2 = new NetModel(o2, {}, net); if (st) M2.st = st;
  for (let j = 0; j < N; j++) inc = Math.max(inc, Math.abs(M.util(j, dh, dm) - M2.util(j, [], [])));
}
console.log(`${want.length} rows: largest difference from PyTorch ${worst.toExponential(2)}, incremental against fresh ${inc.toExponential(2)}`);
