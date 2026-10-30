// Where the money and animals went, per seat, from movelog.exe output (agent/cpp/movelog.cpp): auctions won and their
// price, buy-backs, koehandels as attacker and defender (won, accepted, net money), final score and money left:
//   ./agent/cpp/movelog.exe "insane;x9;x9" 40 1001 150 > ml.txt && node agent/scripts/flows.mjs ml.txt
import fs from 'node:fs';
import { ANIMALS } from '../../lib/rules.js';
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const S = () => ({ games: 0, wins: 0, score: 0, money: 0, aucWon: 0, aucPaid: 0, aucPts: 0, soldRev: 0, buyBack: 0, buyPaid: 0, khAtt: 0, khAttWon: 0, khAttNet: 0, khDef: 0, khDefWon: 0, khDefNet: 0, khAcc: 0 });
const st = [S(), S(), S()]; let ps = [];
for (const l of lines) {
  if (l.startsWith('h a ')) {
    const [, , k] = l.split(' '), A = +l.match(/ A=(\d+)/)[1], w = +l.match(/ w=(-?\d+)/)[1], p = +l.match(/ p=(\d+)/)[1], buy = / buy=1/.test(l);
    if (w < 0) continue;
    if (buy) { st[A].buyBack++; st[A].buyPaid += p; st[A].aucPts += ANIMALS[k]; continue; }
    st[w].aucWon++; st[w].aucPaid += p; st[w].aucPts += ANIMALS[k]; if (w !== A) st[A].soldRev += p;
  } else if (l.startsWith('h k ')) {
    const g = n => { const m = l.match(new RegExp(' ' + n + '=(-?[0-9]+)')); return m ? +m[1] : -1; }, a = g('a'), b = g('b'), win = g('win'), x = g('x'), y = g('y');
    const acc = / nb=null/.test(l), yy = acc ? 0 : y;
    st[a].khAtt++; st[b].khDef++; if (acc) st[b].khAcc++;
    if (win === a) { st[a].khAttWon++; st[a].khAttNet += yy - x; st[b].khDefNet += x - yy; } else { st[b].khDefWon++; st[b].khDefNet += x - yy; st[a].khAttNet += yy - x; }
  } else if (l.startsWith('p ')) ps.push(l);
  else if (l.startsWith('end')) {
    const sc = ps.map(q => +q.match(/score=(\d+)/)[1]), mo = ps.map(q => (q.match(/money=\[([^\]]*)\]/)[1] || '').split(',').filter(Boolean).reduce((s, v) => s + +v, 0));
    const top = Math.max(...sc), tied = sc.filter(v => v === top).length;
    ps.forEach((_, i) => { st[i].games++; st[i].score += sc[i]; st[i].money += mo[i]; if (sc[i] === top) st[i].wins += 1 / tied; });
    ps = [];
  }
}
const f = x => x.toFixed(2);
for (const [i, s] of st.entries()) {
  const G = s.games;
  console.log(`seat ${i}: win ${f(3 * s.wins / G)} | score ${(s.score / G).toFixed(0)} money left ${(s.money / G).toFixed(0)} | auctions won ${f(s.aucWon / G)} paid ${(s.aucPaid / G).toFixed(0)} (${f(s.aucPaid / Math.max(1, s.aucWon))} each), sold ${(s.soldRev / G).toFixed(0)}, buy-backs ${f(s.buyBack / G)} paid ${(s.buyPaid / G).toFixed(0)} | kh attack ${f(s.khAtt / G)} won ${f(s.khAttWon / Math.max(1, s.khAtt))} net ${(s.khAttNet / G).toFixed(0)} | kh defend ${f(s.khDef / G)} won ${f(s.khDefWon / Math.max(1, s.khDef))} accepted ${f(s.khAcc / Math.max(1, s.khDef))} net ${(s.khDefNet / G).toFixed(0)}`);
}
