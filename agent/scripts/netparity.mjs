// Check that agent/scripts/net.mjs computes what the trained network computes: node agent/scripts/netparity.mjs <value.json>
import fs from 'node:fs';
import { loadNet, NetModel } from './net.mjs';
const file = process.argv[2], net = loadNet(JSON.parse(fs.readFileSync(file, 'utf8'))), cases = JSON.parse(fs.readFileSync(file + '.parity.json', 'utf8'));
let worst = 0;
for (const { row: r, me, p } of cases) {
  const v = r.views[me];
  const o = { me, n: r.n, herd: r.herd, money: v.money, cards: r.cards, sd: v.sd, remain: r.remain, deckLeft: r.deck, mules: r.mules, pool: r.pool, future: r.future, turn: r.turn, out: r.herd.map(() => false) };
  const M = new NetModel(o, {}, net);
  for (const j in p) worst = Math.max(worst, Math.abs(M.util(+j, [], []) - p[j]));
}
console.log('max difference', worst.toExponential(2));
