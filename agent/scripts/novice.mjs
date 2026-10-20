// A stand-in for a person in their first games, used only to calibrate the Easy bot (it is not one of the bots).
// It plays by the rules of thumb new players tend to use: bid on valuable animals and on ones you already have,
// buy back what you collect, koehandel when you have a pair, offer a chunk of your money, defend what you own.
import { ANIMALS, TYPES, sum, cheapest } from '../../lib/rules.js';
import { targets } from '../../lib/engine.js';

const tens = x => Math.max(0, Math.floor(x / 10) * 10);
const noise = (rand, sd) => Math.exp(sd * (rand() + rand() + rand() - 1.5) * 1.4);
export const novice = {
  cap(s, i, rand) {
    const me = s.players[i], t = s.auction.type, have = me.animals[t], money = sum(me.money);
    const want = ANIMALS[t] * 0.18 * (1 + 0.6 * have) + 20;
    return tens(Math.min(money * 0.7, want * noise(rand, 0.35)));
  },
  act(s, i, what, rand) {
    const me = s.players[i], money = sum(me.money);
    if (what === 'turn') {
      const opts = targets(s, i).filter(o => o.free || me.animals[o.type] >= 2 || ANIMALS[o.type] >= 500);
      if (opts.length && (!s.deck.length || rand() < 0.35)) { const o = opts[Math.floor(rand() * opts.length)]; return { type: 'koehandel', target: o.p, animal: o.type }; }
      if (s.deck.length) return { type: 'auction' };
      const o = targets(s, i)[0]; return { type: 'koehandel', target: o.p, animal: o.type };
    }
    const a = s.auction;
    if (what === 'decide') return { type: me.animals[a.type] >= 1 && money >= a.high.amt && a.high.amt < ANIMALS[a.type] * 0.25 ? 'buy' : 'sell' };
    if (what === 'pay') return { type: 'pay', cards: cheapest(me.money, a.high.amt) };
    const tr = s.trade;
    if (what === 'offer') return { type: 'tradebid', cards: cheapest(me.money, tens(money * (0.3 + 0.3 * rand()))) };
    const guess = (tr.bids[tr.a] || []).length * 25;
    if (me.animals[tr.type] >= 2 && money > guess + 20) return { type: 'tradebid', cards: cheapest(me.money, tens(guess + 20 + 30 * rand())) };
    return { type: 'accept' };
  },
};
