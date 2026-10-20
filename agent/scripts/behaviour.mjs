// Behaviour statistics of a lineup: node agent/scripts/behaviour.mjs <agent,agent,...> [games] [size]
// What share of auctions get no bid, how much of their money winners spend, koehandels before the deck runs out,
// buy-backs, overpaying in koehandels, and how defenders answer. Seat 0 is reported separately.
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick, score, countsOf } from '../../lib/engine.js';
import { sum, ANIMALS } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';

const [lineup, games = 50, size = 40] = process.argv.slice(2);
const names = lineup.split(lineup.includes(';') ? ';' : ','), agents = names.map(agentFor);
const st = { auctions: 0, nobid: 0, oneBid: 0, allIn: 0, spentEarly: 0, early: 0, buyback: 0, decide: 0, khEarly: 0, khLate: 0, offers: 0, overpay: 0, overpayAmt: 0, accept: 0, counter10: 0, responds: 0, wins: names.map(() => 0), brokeAttack: 0, brokeChances: 0, priceRatio: {} };
for (let g = 0; g < +games; g++) {
  const r = rng(500 + g), s = newSimGame(names.length, +size, r);
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') {
      const a = s.auction, caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
      const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
      st.auctions++; if (!bids.length) st.nobid++; if (bids.length === 1) st.oneBid++;
      if (bids.length) {
        const amt = bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10, w = bids[0][1];
        if (amt >= 0.9 * sum(s.players[w].money)) st.allIn++;
        if (s.mules < 2) { st.early++; st.spentEarly += amt / Math.max(1, sum(s.players[w].money)); }
        const key = a.type + (s.deck.length > 20 ? '-early' : '-late');
        (st.priceRatio[key] ||= []).push(amt);
        apply(s, w, { type: 'bid', amount: amt }, s.clock);
      }
      s.clock = s.auction.deadline; tick(s, s.clock); s.clock++;
      continue;
    }
    const w = waiting(s);
    if (!w) break;
    if (w.what === 'turn' && s.deck.length) {
      const broke = s.players.some((p, j) => j !== w.p && !p.out && sum(p.money) <= 20 && Object.keys(p.animals).some(t => p.animals[t] && s.players[w.p].animals[t]));
      if (broke) st.brokeChances++;
      const act = agents[w.p].act(s, w.p, w.what, r);
      if (act.type === 'koehandel') { st.khEarly++; if (broke && sum(s.players[act.target].money) <= 20) st.brokeAttack++; }
      apply(s, w.p, act, s.clock++); continue;
    }
    const act = agents[w.p].act(s, w.p, w.what, r);
    if (w.what === 'turn' && act.type === 'koehandel') st.khLate++;
    if (w.what === 'decide') { st.decide++; if (act.type === 'buy') st.buyback++; }
    if (w.what === 'offer') { st.offers++; const mb = sum(s.players[s.trade.b].money), x = sum(act.cards); if (x > mb + 10) { st.overpay++; st.overpayAmt += x - mb - 10; if (process.env.SHOW && x > mb + 100) console.log(`  overpay: P${w.p} ${names[w.p]} offers ${x} (${act.cards.length} cards, has ${sum(s.players[w.p].money)}) to P${s.trade.b} who has ${sum(s.players[s.trade.b].money)} in ${s.players[s.trade.b].money.length} cards, for ${s.trade.count} ${s.trade.type}, deck ${s.deck.length}, est ${Math.round(s.ledger[s.trade.b] + s.mem[w.p][s.trade.b])}`); } }
    if (w.what === 'respond') { st.responds++; if (act.type === 'accept') st.accept++; else if (sum(act.cards) <= 10) st.counter10++; }
    try { apply(s, w.p, act, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  const sc = s.players.map(p => score(p, countsOf(s)).score), best = Math.max(...sc);
  sc.forEach((x, j) => { if (x === best) st.wins[j] += 1 / sc.filter(y => y === best).length; });
}
const pc = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
console.log(`${lineup} (${games} games)`);
console.log(`auctions: no bid ${pc(st.nobid, st.auctions)}, one bidder ${pc(st.oneBid, st.auctions)}, winner spends >=90% ${pc(st.allIn, st.auctions)}, early share of money spent ${(st.spentEarly / st.early * 100).toFixed(0)}%, buy-backs ${pc(st.buyback, st.decide)}`);
console.log(`koehandels per game: before deck empty ${(st.khEarly / games).toFixed(1)}, after ${(st.khLate / games).toFixed(1)}; attacked a broke player ${st.brokeAttack}/${st.brokeChances} chances`);
console.log(`offers above defender's money+10: ${pc(st.overpay, st.offers)} (avg waste ${(st.overpayAmt / Math.max(1, st.overpay)).toFixed(0)}), defenders accept ${pc(st.accept, st.responds)}, counter <=10 ${pc(st.counter10, st.responds)}`);
console.log('wins by seat', st.wins.map(x => x.toFixed(1)).join(' '));
const med = a => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
console.log('median prices', Object.keys(ANIMALS).map(t => `${t} ${med(st.priceRatio[t + '-early'] || [0])}/${med(st.priceRatio[t + '-late'] || [0])}`).join(', '));
