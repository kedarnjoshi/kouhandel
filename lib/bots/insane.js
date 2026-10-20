// Insane: the hard bot's judgement, checked by simulation. Before a big decision it imagines the hidden part of the
// table (who holds which money cards, what is left in the deck) many times, plays every candidate move out to the
// end of the game in each imagined world, and picks the move that wins most often. All candidates are played out in
// the same imagined worlds, so the comparison is fair even with few playouts.
import { observe, Model, bidLimit, chooseTurn, bestOffer, counterAmount, targetsOf, sums, sampleComposition } from './brain.js';
import { smart } from './policies.js';
import { playOut, settleAuction, shuffle, wins } from './sim.js';
import { apply } from '../engine.js';
import { TYPES, sum, cheapest } from '../rules.js';

const clone = s => JSON.parse(JSON.stringify(s));
const tens = x => Math.max(0, Math.floor(x / 10) * 10);
const seeded = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// One imagined world consistent with what player i knows.
export function imagine(s, i, rand) {
  const o = observe(s, i), d = clone(s);
  // Money: the cards not in my hand are spread over the others with their visible card counts; of a few random
  // deals, keep one that fits the public estimates of everyone's money best.
  // A standing bid must be affordable (it was checked when it was made).
  const others = d.players.map((p, j) => j).filter(j => j !== i && d.players[j].money.length);
  const unknown = others.flatMap(j => s.players[j].money);
  const a = s.auction, owes = a && a.high && a.high.p !== i ? a.high : null;
  let best = null;
  for (let t = 0; t < 30 && !(best && t >= 12); t++) {
    const cards = shuffle([...unknown], rand), deal = {}; let at = 0, cost = 0;
    for (const j of others) { const n = s.players[j].money.length; deal[j] = cards.slice(at, at + n); at += n; cost += Math.abs(sum(deal[j]) - o.money[j]) / (30 + 0.25 * o.money[j]); }
    if (owes && sum(deal[owes.p]) < owes.amt) continue;
    const w = Math.exp(-cost) * rand();
    if (!best || w > best.w) best = { w, deal };
  }
  if (best) for (const j of others) d.players[j].money = best.deal[j];
  // An offer lying face down in front of me: some cards of that (imagined) hand, as many as I can see.
  const tr = d.trade;
  if (tr && tr.a !== i && tr.a in tr.bids) tr.bids[tr.a] = shuffle([...d.players[tr.a].money], rand).slice(0, s.trade.bids[tr.a].length);
  if (tr && tr.b !== i && tr.b in tr.bids) tr.bids[tr.b] = shuffle([...d.players[tr.b].money], rand).slice(0, s.trade.bids[tr.b].length);
  // Deck: what is left of the (possibly secret) composition, in a random order.
  if (o.hidden && d.deck.length) {
    const c = sampleComposition(o.deckSize, o.seen, rand);
    d.counts = Object.fromEntries(TYPES.map((t, k) => [t, c[k]]));
    d.deck = shuffle(TYPES.flatMap((t, k) => Array(c[k] - o.seen[k]).fill(t)), rand);
  } else d.deck = shuffle([...d.deck], rand); // (with a secret deck and none left, everything is known)
  d.mem = d.players.map(() => d.players.map(() => 0)); // the others' private knowledge is unknown: they go by the public estimates
  for (const p of d.players) delete p.bot; // nobody is scheduled in a simulation: the playout drives everyone
  d.botAt = null; d.log = []; d.clock = (s.clock || 1);
  return d;
}

// Value of a playout for player i: winning matters most, a bigger share of the top score breaks ties. A playout
// cut short after `depth` moves is judged by the brain's own estimate of the chance to win from there.
const value = (scores, i) => wins(scores)[i] + 0.2 * scores[i] / Math.max(1, ...scores);
function playValue(d, agents, r, i, depth, th) {
  const scores = playOut(d, agents, r, depth || 600);
  if (d.phase === 'over' || !depth) return value(scores, i);
  if (d.phase === 'auction' && d.auction.stage === 'bidding') settleAuction(d, agents, r);
  const o = observe(d, i);
  return 1.2 * new Model(o, th).util(i, [], []);
}

// Play every candidate out in the same `worlds` imagined worlds; return the index of the best candidate.
function pick(s, i, cands, applyCand, agents, worlds, seed, depth, th) {
  if (cands.length < 2) return 0;
  const tot = cands.map(() => 0);
  for (let w = 0; w < worlds; w++) {
    const world = imagine(s, i, seeded(seed + w * 7919));
    cands.forEach((c, ci) => {
      const d = clone(world), r = seeded(seed + w * 104729 + 1);
      try { applyCand(d, c, r); } catch { tot[ci] -= 1e9; return; }
      tot[ci] += playValue(d, agents, r, i, depth, th);
    });
  }
  let b = 0; tot.forEach((v, ci) => { if (v > tot[b]) b = ci; });
  return b;
}

export function insane(th, { worlds = 24, depth = 0 } = {}) {
  const base = smart(th);
  const field = n => Array.from({ length: n }, () => base);
  return {
    // Auction: compare a few limits around the hard bot's own.
    cap(s, i, rand) {
      const o = observe(s, i), mine = o.money[i], c0 = Math.min(mine, bidLimit(o, th));
      const cands = [...new Set([0, c0 * 0.6, c0 * 0.85, c0, c0 * 1.2, c0 * 1.5 + 20].map(x => Math.min(mine, tens(x))))];
      const agents = field(s.players.length);
      const k = pick(s, i, cands, (d, c, r) => {
        const me = { cap: () => c, act: base.act };
        settleAuction(d, agents.map((a, j) => (j === i ? me : a)), r);
      }, agents, worlds, Math.floor(rand() * 2 ** 30), depth, th);
      return cands[k];
    },
    act(s, i, what, rand) {
      const o = observe(s, i), M = new Model(o, th), agents = field(s.players.length), seed = Math.floor(rand() * 2 ** 30);
      const run = (cands, wl = worlds) => cands[pick(s, i, cands, (d, x) => apply(d, i, x, d.clock++), agents, wl, seed, depth, th)];
      if (what === 'pay') return { type: 'pay', cards: cheapest(o.hand, s.auction.high.amt) };
      if (what === 'decide') {
        if (o.money[i] < s.auction.high.amt) return { type: 'sell' };
        return run([{ type: 'sell' }, { type: 'buy' }]);
      }
      if (what === 'turn') {
        // the hard bot's choice plus the best-looking alternatives
        const opts = targetsOf(o).map(t => ({ t, ev: o.out[t.p] ? 1 : bestOffer(o, th, M, t.p, t.k, t.count, 0, true).ev })).sort((a, b) => b.ev - a.ev).slice(0, 3);
        const cands = opts.map(({ t }) => ({ type: 'koehandel', target: t.p, animal: TYPES[t.k] }));
        if (o.deckLeft) cands.unshift({ type: 'auction' });
        const hard = chooseTurn(o, th, M);
        if (hard && !cands.some(c => JSON.stringify(c) === JSON.stringify(hard))) cands.push(hard);
        return run(cands);
      }
      const tr = o.trade, hand = o.hand, all = sums(hand);
      const nearest = x => all.find(v => v >= x) ?? all[all.length - 1];
      if (what === 'offer') {
        const b = bestOffer(o, th, M, tr.b, tr.k, tr.count), x0 = b ? b.x : 0;
        const xs = [...new Set([0, x0 * 0.5, x0 * 0.75, x0, x0 * 1.3, o.money[tr.b] + 10].map(x => nearest(Math.min(o.money[i], tens(x)))))];
        return run(xs.map(x => ({ type: 'tradebid', cards: x ? cheapest(hand, x) : [] })));
      }
      const y0 = counterAmount(o, th, M) ?? 0;
      const ys = [...new Set([y0 * 0.7, y0, y0 * 1.4, y0 + 50, 10].map(y => nearest(Math.min(o.money[i], tens(y)))).filter(y => y > 0))];
      return run([{ type: 'accept' }, ...ys.map(y => ({ type: 'tradebid', cards: cheapest(hand, y) }))]);
    },
  };
}
