// "Shark": a stand-in for a sharp human player, used only as a benchmark opponent (it is not one of the bots).
// Plain rules of thumb plus the tricks people use against bots: a 10 bid on anything nobody bids on (you either get
// the animal for 10 or the auctioneer pays you 10), koehandels against players who are broke, offers just above
// what the other can pay, counters just above what the card count suggests, and a cash reserve while exposed.
import { ANIMALS, TYPES, sum, cheapest } from '../../lib/rules.js';
import { observe, targetsOf, IDX } from '../../lib/bots/brain.js';

const tens = x => Math.max(0, Math.floor(x / 10) * 10);
const W = [0.22, 0.32, 0.5, 0.9]; // share of an animal's value worth paying, by how many I already hold
function worth(o, j, k) {
  const h = o.herd[j][k], others = o.active.filter(x => x !== j).reduce((a, x) => a + o.herd[x][k], 0);
  const avg = o.active.reduce((a, x) => a + o.money[x], 0) / o.active.length;
  const infl = Math.min(2.5, Math.max(0.35, (avg + 150) / 450));
  return ANIMALS[Object.keys(ANIMALS)[k]] * W[Math.min(3, h)] * infl * (others >= 3 ? 0.6 : 1);
}
const exposed = (o, j) => o.herd[j].reduce((a, h, k) => a + (h && o.active.some(x => x !== j && o.herd[x][k]) ? 1 : 0), 0);
export const shark = {
  cap(s, i) {
    const o = observe(s, i), k = o.auction.k, m = o.money[i];
    const reserve = o.deckLeft > 4 ? Math.min(m * 0.35, 40 * exposed(o, i)) : 0;
    return Math.max(Math.min(10, m), tens(Math.min(m - reserve, worth(o, i, k))));
  },
  act(s, i, what, rand) {
    const o = observe(s, i), me = i, m = o.money[i];
    if (what === 'pay') return { type: 'pay', cards: cheapest(o.hand, s.auction.high.amt) };
    if (what === 'decide') {
      const a = o.auction, p = a.high.amt;
      return { type: m >= p && o.herd[me][a.k] >= 1 && p < worth(o, me, a.k) * 1.1 ? 'buy' : 'sell' };
    }
    if (what === 'turn') {
      const ts = targetsOf(o).map(t => ({ ...t, val: worth(o, me, t.k) * t.count + worth(o, t.p, t.k) * t.count * 0.5, cost: o.out[t.p] ? 0 : o.money[t.p] + 10 }));
      const cheap = ts.filter(t => t.cost <= Math.min(m, 40) || (t.cost < t.val * 0.7 && t.cost <= m * 0.6)).sort((a, b) => b.val - b.cost - (a.val - a.cost));
      if (cheap.length && (!o.deckLeft || cheap[0].val > 30)) return { type: 'koehandel', target: cheap[0].p, animal: TYPES[cheap[0].k] };
      if (o.deckLeft) return { type: 'auction' };
      const t = ts.sort((a, b) => b.val - b.cost - (a.val - a.cost))[0];
      return { type: 'koehandel', target: t.p, animal: TYPES[t.k] };
    }
    const tr = o.trade;
    if (what === 'offer') {
      const mb = o.money[tr.b], val = worth(o, me, tr.k) * tr.count * 1.6;
      let x = mb + 10 <= Math.min(m, Math.max(val, 60)) ? mb + 10 : tens(Math.min(m, val) * (0.5 + 0.3 * rand()));
      if (mb <= 0) x = 0;
      const cards = x ? cheapest(o.hand, x) : [];
      const zeros = o.hand.filter(c => c === 0).length - cards.filter(c => c === 0).length;
      if (zeros && rand() < 0.5) cards.push(0);
      return { type: 'tradebid', cards };
    }
    const a = tr.a, n = tr.offer, avg = o.money[a] / Math.max(1, o.cards[a]);
    const guess = Math.min(o.money[a], n * avg), val = worth(o, me, tr.k) * tr.count * 1.8 + worth(o, a, tr.k) * tr.count * 0.6;
    const y = tens(guess) + 10;
    if (y <= m && y < val) return { type: 'tradebid', cards: cheapest(o.hand, y) };
    return { type: 'accept' };
  },
};
void IDX; void sum;
