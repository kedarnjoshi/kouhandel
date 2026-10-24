// Where does each seat gain and lose? node agent/scripts/ledger.mjs <lineup> [games] [seed] [deck size]
// Per seat over all games: animals bought at auction and what they cost, income from selling, koehandels as attacker
// and defender (won/lost, net money), final sets and wins.
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick, score, countsOf } from '../../lib/engine.js';
import { sum, ANIMALS } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
const [lineup, games = 20, seed = 1, size = 40] = process.argv.slice(2);
const names = lineup.split(lineup.includes(';') ? ';' : ','), agents = names.map(agentFor), n = names.length;
const T = names.map(() => ({ bought: 0, paid: 0, boughtVal: 0, sold: 0, income: 0, buyback: 0, atkW: 0, atkL: 0, atkNet: 0, defW: 0, defL: 0, defNet: 0, acc: 0, sets: 0, score: 0, wins: 0 }));
for (let g = 0; g < +games; g++) {
  const r = rng(+seed * 1000 + g), s = newSimGame(n, +size, r);
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    const before = s.players.map(p => sum(p.money)), tr = s.trade && { ...s.trade }, au = s.auction && { ...s.auction, high: s.auction.high && { ...s.auction.high } };
    let a; try { a = agents[w.p].act(s, w.p, w.what, r); } catch (e) { a = null; }
    try { apply(s, w.p, a, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
    if (w.what === 'pay' && au) {
      const payer = au.payer, payee = au.payee, amt = before[payer] - sum(s.players[payer].money);
      T[payer].bought++; T[payer].paid += amt; T[payer].boughtVal += ANIMALS[au.type];
      if (payer === au.auctioneer) T[payer].buyback++; else { T[payee].sold++; T[payee].income += amt; }
    }
    if (w.what === 'respond' && tr) {
      const A = tr.a, B = tr.b, wonA = s.players[A].animals[tr.type] > (tr.prevA ?? -1);
      const netA = sum(s.players[A].money) - before[A];
      if (!s.trade || s.trade.ties === undefined || s.phase !== 'trade') { // resolved (not a first tie)
        const aGot = s.players[A].animals[tr.type] > 0 && s.players[B].animals[tr.type] === 0 || netA < 0 && a && a.type === 'accept';
        const winA = a && a.type === 'accept' ? true : netA <= 0;
        if (winA) { T[A].atkW++; T[B].defL++; } else { T[A].atkL++; T[B].defW++; }
        if (a && a.type === 'accept') T[B].acc++;
        T[A].atkNet += netA; T[B].defNet -= netA;
        void aGot; void wonA;
      }
    }
  }
  const sc = s.players.map(p => score(p, countsOf(s))), best = Math.max(...sc.map(x => x.score)), nb = sc.filter(x => x.score === best).length;
  sc.forEach((x, j) => { T[j].sets += x.sets; T[j].score += x.score; if (x.score === best) T[j].wins += 1 / nb; });
}
const G = +games;
names.forEach((nm, j) => { const t = T[j]; console.log(`${('P' + j + ' ' + nm).padEnd(22)} auction buys ${(t.bought / G).toFixed(1)} (pay ${(t.paid / Math.max(1, t.bought)).toFixed(0)}/animal, value ${(t.boughtVal / Math.max(1, t.bought)).toFixed(0)}, buybacks ${(t.buyback / G).toFixed(1)}) sells ${(t.sold / G).toFixed(1)} for ${(t.income / Math.max(1, t.sold)).toFixed(0)} | attack W/L ${(t.atkW / G).toFixed(1)}/${(t.atkL / G).toFixed(1)} net ${(t.atkNet / G).toFixed(0)} | defend W/L ${(t.defW / G).toFixed(1)}/${(t.defL / G).toFixed(1)} net ${(t.defNet / G).toFixed(0)} acc ${(t.acc / G).toFixed(1)} | sets ${(t.sets / G).toFixed(2)} score ${(t.score / G).toFixed(0)} wins ${(t.wins / G).toFixed(2)}`); });
