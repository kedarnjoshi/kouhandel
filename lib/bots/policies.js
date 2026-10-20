// The bot personalities. Each is { cap(s, i, rand): most it bids on the open auction, act(s, i, what, rand): its move }.
import { observe, Model, bidLimit, wantsToBuy, chooseTurn, bestOffer, offerCards, counterAmount, targetsOf, sums } from './brain.js';
import { TYPES, sum, cheapest } from '../rules.js';

const pick = (a, rand) => a[Math.floor(rand() * a.length)];
const gauss = rand => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const tens = x => Math.max(0, Math.floor(x / 10) * 10);
const randomTurn = (o, s, i, rand) => {
  const opts = targetsOf(o).map(t => ({ type: 'koehandel', target: t.p, animal: TYPES[t.k] }));
  if (s.deck.length) opts.push({ type: 'auction' });
  return pick(opts, rand);
};
const randomCards = (hand, rand) => hand.filter(() => rand() < 0.35);
const covering = (hand, amt, rand) => { // random cards that still cover the price
  const h = [...hand].sort(() => rand() - 0.5), out = []; let acc = 0;
  for (const c of h) { if (acc >= amt) break; out.push(c); acc += c; }
  return out;
};

// The thinking bots. `noise` blurs every price they come up with (lognormal), `slip` is the chance of a careless
// turn choice: together they make the easy and medium bots beatable without making them silly.
export function smart(th, { noise = 0, slip = 0 } = {}) {
  const blur = (x, rand) => (noise ? x * Math.exp(noise * gauss(rand) - noise * noise / 2) : x);
  return {
    cap(s, i, rand) { const o = observe(s, i); return tens(Math.min(o.money[i], blur(bidLimit(o, th), rand))); },
    act(s, i, what, rand) {
      const o = observe(s, i), M = new Model(o, th);
      if (what === 'turn') return slip && rand() < slip ? randomTurn(o, s, i, rand) : chooseTurn(o, th, M);
      if (what === 'decide') return { type: wantsToBuy(o, th, M) ? 'buy' : 'sell' };
      if (what === 'pay') return { type: 'pay', cards: cheapest(o.hand, s.auction.high.amt) };
      const tr = o.trade;
      if (what === 'offer') {
        const best = bestOffer(o, th, M, tr.b, tr.k, tr.count);
        const x = Math.min(o.money[i], tens(blur(best ? best.x : 0, rand)));
        return { type: 'tradebid', cards: offerCards(o, th, sums(o.hand).find(v => v >= x) ?? 0) };
      }
      const y = counterAmount(o, th, M);
      if (y === null) return { type: 'accept' };
      return { type: 'tradebid', cards: cheapest(o.hand, Math.min(o.money[i], tens(blur(y, rand)) || 10)) };
    },
  };
}

// Plays legal moves at random.
export const random = {
  cap(s, i, rand) { const m = sum(s.players[i].money); return rand() < 0.5 ? 0 : tens(rand() * m * 0.6); },
  act(s, i, what, rand) {
    const o = observe(s, i);
    if (what === 'turn') return randomTurn(o, s, i, rand);
    if (what === 'decide') return { type: rand() < 0.5 && o.money[i] >= s.auction.high.amt ? 'buy' : 'sell' };
    if (what === 'pay') return { type: 'pay', cards: covering(o.hand, s.auction.high.amt, rand) };
    if (what === 'respond' && rand() < 0.5) return { type: 'accept' };
    return { type: 'tradebid', cards: randomCards(o.hand, rand) };
  },
};

// Plays like a sensible player on a very strange day: generous offers, lowballs it lets slide, overpayments,
// wild bids on animals it does not need. It is not trying to lose, but its gifts shift the money around the
// table so nobody can count on anything.
export function confusing(th) {
  const base = smart(th, { noise: 0.15 });
  return {
    cap(s, i, rand) {
      const c = base.cap(s, i, rand), m = sum(s.players[i].money);
      const r = rand();
      if (r < 0.2) return tens(Math.min(m, c * 1.6 + 20)); // bids an animal up far beyond its worth
      if (r < 0.35) return 0;                               // or lets a bargain go
      return tens(Math.min(m, c * Math.exp(0.5 * gauss(rand))));
    },
    act(s, i, what, rand) {
      const o = observe(s, i);
      if (what === 'turn') return rand() < 0.4 ? randomTurn(o, s, i, rand) : base.act(s, i, what, rand);
      if (what === 'decide') return rand() < 0.3 ? { type: o.money[i] >= s.auction.high.amt && rand() < 0.5 ? 'buy' : 'sell' } : base.act(s, i, what, rand);
      if (what === 'pay') { // pays with a big card rather than the exact change
        const amt = s.auction.high.amt, big = [...o.hand].sort((a, b) => a - b).find(c => c >= amt);
        return { type: 'pay', cards: big !== undefined && rand() < 0.5 ? [big] : cheapest(o.hand, amt) };
      }
      const tr = o.trade;
      if (what === 'offer') {
        if (rand() < 0.5) { // a generous offer: more than the other player could ever counter, or half its money
          const x = Math.max(o.money[tr.b] + 10, o.money[i] * 0.5);
          return { type: 'tradebid', cards: cheapest(o.hand, Math.min(o.money[i], tens(x))) };
        }
        return base.act(s, i, what, rand);
      }
      if (rand() < 0.45) return { type: 'accept' }; // lets a lowball offer slide
      const r = base.act(s, i, what, rand);
      if (r.type === 'tradebid' && rand() < 0.5) return { type: 'tradebid', cards: cheapest(o.hand, Math.min(o.money[i], tens(sum(r.cards) * 1.6))) };
      return r;
    },
  };
}
