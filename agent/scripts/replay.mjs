// A logged game (games/<room>-<game>.json, written by app/local.py's server) as a readable story, secret amounts
// and cards included: node agent/scripts/replay.mjs <file.json>
// Also accepts a raw stored room ("<version>|<json>").
import fs from 'node:fs';
import { ANIMALS, START_MONEY, sum } from '../../lib/rules.js';
import { score } from '../../lib/engine.js';

const raw = fs.readFileSync(process.argv[2], 'utf8'), s = JSON.parse(raw.slice(raw[0] === '{' ? 0 : raw.indexOf('|') + 1));
const P = s.players, name = j => `${P[j].name}${P[j].bot ? ` (${P[j].bot})` : ''}`, cards = c => `[${c.join(',')}]`;
const counts = s.counts || Object.fromEntries(Object.keys(ANIMALS).map(t => [t, 4]));
console.log(`${s.name}: ${P.length} players, ${s.deckSize || 40} cards, ${s.phase}`);
// money as it really was, replayed from the history (start money, mules, payments, koehandels)
const money = P.map(() => START_MONEY.slice());
const take = (h, cs) => { for (const c of cs) { const i = h.indexOf(c); if (i >= 0) h.splice(i, 1); } };
const show = () => P.map((p, j) => `${p.name} ${sum(money[j])}`).join(', ');
for (const e of s.hist || []) {
  if (e.t === 'm') { for (const j of e.to) money[j].push(e.amt); console.log(`money mule: everyone gets ${e.amt}            money: ${show()}`); continue; }
  if (e.t === 'x') { console.log(`${name(e.p)} left the game`); continue; }
  if (e.t === 'a') {
    const bids = Object.entries(e.mx || {}).map(([j, b]) => `${P[j].name} ${b}`).join(', ');
    let what = e.w == null ? 'no bids' : e.buy ? `${P[e.A].name} buys it back for ${e.p}` : `${P[e.w].name} gets it for ${e.p}`;
    if (e.cs) { take(money[e.P], e.cs); money[e.Q].push(...e.cs); if (sum(e.cs) > e.p) what += ` (paid ${cards(e.cs)})`; }
    console.log(`${P[e.A].name} auctions ${e.k}: highest bids ${bids || '-'} -> ${what}`);
    continue;
  }
  if (e.t === 'k') {
    const A = name(e.a), B = name(e.b), x = e.x, y = e.y;
    take(money[e.a], e.ca || []);
    let line = `${A} koehandel vs ${B} for ${e.c > 1 ? e.c + ' ' : ''}${e.k}: offers ${x} in ${e.na} cards ${cards(e.ca || [])} (${B} had ${sum(money[e.b])})`;
    if (e.nb == null) { money[e.b].push(...(e.ca || [])); line += `; accepted`; }
    else {
      take(money[e.b], e.cb || []);
      if (x === y) { money[e.a].push(...(e.ca || [])); money[e.b].push(...(e.cb || [])); line += `; counter ${y} ${cards(e.cb || [])}: tie`; }
      else { money[e.a].push(...(e.cb || [])); money[e.b].push(...(e.ca || [])); line += `; counter ${y} in ${e.nb} ${cards(e.cb || [])} -> ${P[e.win].name} wins`; }
    }
    console.log(line + `      money: ${show()}`);
  }
}
if (s.phase === 'over') console.log('\nfinal: ' + P.map(p => `${p.name} ${score(p, counts).score}`).join(', '));
console.log('hands now: ' + P.map(p => `${p.name} ${cards([...p.money].sort((a, b) => a - b))}`).join(', '));
