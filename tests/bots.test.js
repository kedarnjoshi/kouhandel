import { describe, it, expect } from 'vitest';
import { newGame, newPlayer, apply, tick, view, waiting, countsOf } from '../lib/engine';
import { LEVELS, thinkMs, botRand } from '../lib/bots/index';
import { TYPES, sum } from '../lib/rules';

const LV = Object.keys(LEVELS);
const total = s => s.players.reduce((n, p) => n + sum(p.money), 0);
const sorted = a => [...a].sort((x, y) => x - y);
// A lobby with one person (the host) and the given bots.
function table(bots = ['hard', 'hard'], o = {}) {
  const s = newGame({ timeout: 20, ...o }); s.players.push(newPlayer('Ann', 'tokA'));
  for (const level of bots) apply(s, 0, { type: 'addbot', level }, 0);
  return s;
}
// Let time pass in small steps; the person (seat 0) lets their clock run out unless `me` decides for them.
function run(s, until, me = null, step = 500) {
  for (let now = s.clockT || 1; now <= until && s.phase !== 'over'; now += step) {
    tick(s, now); s.clockT = now;
    const w = waiting(s);
    if (me && w && w.p === 0) { const x = me(s); if (x) apply(s, 0, x, now); }
  }
  return s;
}

describe('adding bots in the lobby', () => {
  // The host adds bots of every level, up to 5 seats; each gets its own name.
  it('lets the host fill the table with bots', () => {
    const s = table(['easy', 'medium', 'hard', 'insane']);
    expect(s.players.map(p => p.bot || null)).toEqual([null, 'easy', 'medium', 'hard', 'insane']);
    expect(new Set(s.players.map(p => p.name.toLowerCase())).size).toBe(5);
    expect(() => apply(s, 0, { type: 'addbot', level: 'random' }, 0)).toThrow(/full/);
    expect(s.log[0]).toMatch(/\(insane bot\) joined/);
  });
  // Only the host may add bots, only known levels, and only before the game starts.
  it('refuses bots from others, unknown levels and after the start', () => {
    const s = table([]); s.players.push(newPlayer('Bob', 'tokB'));
    expect(() => apply(s, 1, { type: 'addbot', level: 'hard' }, 0)).toThrow(/host/);
    expect(() => apply(s, 0, { type: 'addbot', level: 'godlike' }, 0)).toThrow(/level/);
    expect(() => apply(s, 0, { type: 'addbot', level: '__proto__' }, 0)).toThrow(/level/);
    apply(s, 0, { type: 'addbot', level: 'random' }, 0); apply(s, 0, { type: 'start' }, 0);
    expect(() => apply(s, 0, { type: 'addbot', level: 'hard' }, 0)).toThrow(/before the game starts/);
  });
  // Bots count towards the 3 players needed; the host can remove one again.
  it('counts bots as players and lets the host remove them', () => {
    const s = table(['easy']);
    expect(() => apply(s, 0, { type: 'start' }, 0)).toThrow(/3 players/);
    apply(s, 0, { type: 'addbot', level: 'confusing' }, 0); apply(s, 0, { type: 'kick', target: 1 }, 0);
    expect(s.players.map(p => p.bot || null)).toEqual([null, 'confusing']);
  });
  // A bot is never the host: when the host leaves, the next person takes over; with only bots left the table empties.
  it('never makes a bot the host and clears a table of only bots', () => {
    const s = table(['hard']); s.players.push(newPlayer('Bob', 'tokB'));
    apply(s, 0, { type: 'leave' }, 0);
    expect(view(s, 1).host).toBe(1); expect(() => apply(s, 1, { type: 'start' }, 0)).toThrow(/3 players/);
    apply(s, 1, { type: 'addbot', level: 'easy' }, 0); apply(s, 1, { type: 'start' }, 0); expect(s.phase).toBe('turn');
    const t = table(['hard', 'easy']); apply(t, 0, { type: 'leave' }, 0); expect(t.players).toEqual([]);
  });
});

describe('bots during the game', () => {
  // A bot on turn gets a moment to move, before its time limit, and the view tells players when to look again.
  it('schedules the bot move within the time limit and shows when', () => {
    const s = table(['hard', 'hard']); apply(s, 0, { type: 'start' }, 1000);
    if (s.turn === 0) { apply(s, 0, { type: 'auction' }, 1000); run(s, 40000); }
    const w = waiting(s);
    if (w && s.players[w.p].bot) {
      expect(s.botAt).toBeGreaterThan(s.due - 20000); expect(s.botAt).toBeLessThan(s.due);
      expect(view(s, 0).next).toBe(s.botAt);
      const before = s.step; tick(s, s.botAt); expect(s.step).toBe(before + 1);
    }
  });
  // Thinking time: about a quarter of the time per move, never under 0.7s or over 80% of the limit, steadier for
  // better bots and all over the place for the confusing one. Insane takes a second for every move, to be easy to follow.
  it('thinks for about a quarter of the limit, with level-dependent spread', () => {
    expect(thinkMs('insane', 'turn', 20000, botRand({ seed: 1 }, 0, 'x'))).toBe(1000);
    const stats = l => {
      const r = botRand({ seed: 1 }, 0, l), xs = Array.from({ length: 4000 }, () => thinkMs(l, 'turn', 20000, r));
      const m = sum(xs) / xs.length, sd = Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(700); expect(Math.max(...xs)).toBeLessThanOrEqual(16000);
      return { m, sd };
    };
    const e = stats('easy'), m = stats('medium'), h = stats('hard'), c = stats('confusing');
    for (const x of [e, m, h]) expect(Math.abs(x.m - 5000)).toBeLessThan(400);
    expect(e.sd).toBeGreaterThan(m.sd); expect(m.sd).toBeGreaterThan(h.sd); expect(c.sd).toBeGreaterThan(e.sd);
    expect(thinkMs('hard', 'turn', 120000, botRand({ seed: 2 }, 0, 'x'))).toBeLessThan(20000); // long limits do not drag
  });
  // Bots bid on an animal the person auctions, raise in steps, never beyond their money, and before the clock ends.
  it('bots bid on auctions before the clock runs out', () => {
    let seen = 0;
    for (let k = 0; k < 6; k++) {
      const s = table(['hard', 'medium', 'easy']); s.seed = k; apply(s, 0, { type: 'start' }, 0);
      s.turn = 0; s.deck = ['cow', 'horse', 'pig', 'cat'].concat(s.deck.slice(4)); s.due = 30000; s.botAt = null;
      apply(s, 0, { type: 'auction' }, 1000);
      const a = s.auction, cap = { ...a.caps };
      expect(view(s, 0).auction).not.toHaveProperty('caps');
      let last = 0;
      for (let now = 1000; s.phase === 'auction' && s.auction.stage === 'bidding' && now < 200000; now += 250) {
        tick(s, now);
        const h = s.phase === 'auction' && s.auction.high;
        if (h && h.amt !== last) { seen++; expect(h.amt).toBeGreaterThan(last); expect(h.amt).toBeLessThanOrEqual(cap[h.p]); last = h.amt; }
      }
      expect(s.log.join('\n')).not.toMatch(/ran out of time/);
    }
    expect(seen).toBeGreaterThan(0);
  });
  // The first bid comes late in the opening window (a bid shows interest, and nobody else may bid at all).
  it('waits with the first bid until late', () => {
    let firsts = 0;
    for (let k = 0; k < 6; k++) {
      const s = table(['insane', 'hard', 'hard']); s.seed = k; apply(s, 0, { type: 'start' }, 0);
      s.turn = 0; s.deck = ['cow', 'horse', 'pig', 'cat'].concat(s.deck.slice(4)); s.due = 30000; s.botAt = null;
      apply(s, 0, { type: 'auction' }, 1000);
      const end = s.auction.deadline;
      for (let now = 1000; now < end && !s.auction.high; now += 250) tick(s, now);
      if (s.auction.high) { firsts++; expect(s.auction.at).toBeGreaterThanOrEqual(end - 4000); }
    }
    expect(firsts).toBeGreaterThan(0);
  });
  // With only one possible move (here a turn with nothing to koehandel for) a bot takes just a moment.
  it('moves quickly when there is only one thing to do', () => {
    let seen = 0;
    for (let k = 0; k < 12; k++) {
      const s = table(['insane', 'insane']); apply(s, 0, { type: 'start' }, 0);
      if (s.turn !== 0) { seen++; expect(s.botAt).toBeLessThanOrEqual(1500); } // nobody has animals yet: auction it is
    }
    expect(seen).toBeGreaterThan(0);
  });
  // Whoever looks first triggers the bot move; looking again from a copy gives exactly the same move.
  it('makes the same move no matter who triggers it', () => {
    const s = table(['hard', 'insane', 'confusing']); apply(s, 0, { type: 'start' }, 0); s.turn = 1; s.due = 30000; s.botAt = 3000;
    const copy = JSON.parse(JSON.stringify(s));
    tick(s, 60000); tick(copy, 60000);
    expect(copy).toEqual(s);
  });
  // When the last person leaves, the bots do not play on.
  it('ends the game when only bots are left', () => {
    const s = table(['hard', 'easy']); apply(s, 0, { type: 'start' }, 0);
    apply(s, 0, { type: 'leave' }, 10); expect(s.phase).toBe('over'); expect(s.log[0]).toMatch(/only bots/);
  });
  // The host can kick a bot mid-game: its money is shared out and its animals stay up for grabs.
  it('lets the host kick a bot mid-game', () => {
    const s = table(['hard', 'easy', 'random']); apply(s, 0, { type: 'start' }, 0);
    apply(s, 0, { type: 'kick', target: 2 }, 10);
    expect(s.players[2]).toMatchObject({ out: true, money: [] }); expect(s.phase).not.toBe('over');
  });
});

describe('endless koehandels', () => {
  // Once the deck is empty a koehandel is compulsory; two bots could win the same animal back from each other
  // forever. The table remembers recent koehandels so bots settle a repeated one instead.
  it('remembers the last koehandels (and only the last 24)', () => {
    const s = table(['hard', 'hard']); apply(s, 0, { type: 'start' }, 0);
    s.players[0].animals.cow = 1; s.players[1].animals.cow = 1;
    for (let i = 0; i < 30; i++) { s.phase = 'turn'; s.turn = 0; s.trade = null; apply(s, 0, { type: 'koehandel', target: 1, animal: 'cow' }, 0); }
    expect(s.khs).toHaveLength(24); expect(s.khs[0]).toEqual([0, 1, 'cow']);
  });
  // Self-play between tuned bots used to get stuck in such loops now and then; now every game ends.
  it('bot-only games always finish', async () => {
    const { newSimGame, playOut, rng } = await import('../lib/bots/sim');
    const { makeAgent } = await import('../lib/bots/levels');
    const hard = makeAgent(LEVELS.hard.spec);
    for (let g = 0; g < 40; g++) {
      const r = rng(g + 1), s = newSimGame(3 + g % 3, g % 2 ? 40 : 24, r);
      playOut(s, s.players.map(() => hard), r, 3000);
      expect(s.phase).toBe('over');
    }
  }, 60000);
});

// ---- the koehandel solver, personalities and what the bots may see of the history ----
describe('second-generation pieces', () => {
  // A defender who sees three cards from someone holding mostly zeros must not simply accept: the solver keeps
  // in mind that a pile of zeros is a cheap bluff.
  it('solver: does not accept a likely bluff it can cheaply beat', async () => {
    const { solve } = await import('../lib/bots/solver');
    const lin = { win: d => 200 + d, lose: d => d }; // the animal is worth 200 to both, money counts 1:1
    const aTypes = [{ hand: [0, 0, 0, 10, 10, 50], w: 0.5 }, { hand: [0, 0, 0, 10, 10, 10], w: 0.5 }];
    const bTypes = [{ hand: [10, 10, 50, 100], w: 1 }];
    const g = solve({ aTypes, bTypes, UA: lin, UB: lin, iters: 40 });
    expect(g.answer([10, 10, 50, 100], 3)).toBeGreaterThan(0);
  });
  it('solver: the cards for an offer add up and have the right count', async () => {
    const { cardsFor } = await import('../lib/bots/solver');
    const c = cardsFor([0, 0, 10, 10, 50, 100], 60, 4);
    expect(c).toHaveLength(4); expect(sum(c)).toBe(60);
    expect(cardsFor([10, 50], 30, 1)).toBe(null);
  });
  // Every bot seat gets its own leanings, the same each time it is asked during a game.
  it('personalities are fixed per table and seat, and differ between seats', async () => {
    const { styleOf } = await import('../lib/bots/expert');
    const s = { seed: 99 };
    expect(styleOf(s, 1, 1)).toEqual(styleOf(s, 1, 1));
    expect(styleOf(s, 1, 1)).not.toEqual(styleOf(s, 2, 1));
    expect(styleOf(s, 1, 0)).toBe(null);
  });
  // The history the bots learn from never shows a koehandel's amounts or a payment's cards to outsiders.
  it('history: amounts stay with the players in the deal', async () => {
    const { observe } = await import('../lib/bots/brain');
    const s = table(['hard', 'hard']); apply(s, 0, { type: 'start' }, 0);
    s.players[0].animals.cow = 1; s.players[1].animals.cow = 1; s.phase = 'turn'; s.turn = 0;
    apply(s, 0, { type: 'koehandel', target: 1, animal: 'cow' }, 0);
    apply(s, 0, { type: 'tradebid', cards: [50] }, 0); apply(s, 1, { type: 'accept' }, 0);
    const e = s.hist.find(x => x.t === 'k');
    expect(e).toMatchObject({ a: 0, b: 1, na: 1, nb: null, x: 50 });
    expect(observe(s, 2).hist.find(x => x.t === 'k')).toMatchObject({ na: 1, x: null, ca: null });
    expect(observe(s, 1).hist.find(x => x.t === 'k').x).toBe(50);
  });
});

describe('fourth-round fixes', () => {
  // A small table set up by hand: 20-card deck (pairs), the given hands and animals, ledger matching the hands.
  async function setup(hands, herds, deck = ['cow', 'pig', 'horse']) {
    const { newSimGame, rng } = await import('../lib/bots/sim');
    const s = newSimGame(3, 20, rng(5)); s.deck = deck.slice();
    s.players.forEach((p, i) => { for (const t in p.animals) p.animals[t] = 0; Object.assign(p.animals, herds[i]); p.money = hands[i].slice(); });
    s.ledger = s.players.map(p => sum(p.money));
    return s;
  }
  const insane = async over => { const { makeAgent } = await import('../lib/bots/levels'); const { INSANE } = await import('../lib/bots/index'); return makeAgent({ kind: 'expert', th: { ...INSANE, ...over } }); };
  const r = async seed => (await import('../lib/bots/sim')).rng(seed);
  // Everyone can work out that the other player holds only two zeros: offering anything at all is wasted.
  it('offers nothing to a player known to be broke', async () => {
    const s = await setup([[0, 0, 10, 10, 50, 100, 10], [0, 0, 10, 10, 10, 10, 50, 50], [0, 0]], [{}, { goat: 1 }, { goat: 1 }]);
    s.turn = 1; apply(s, 1, { type: 'koehandel', target: 2, animal: 'goat' }, s.clock++);
    const A = await insane({ sharp: 1, padCost: 0.5 });
    for (let g = 0; g < 4; g++) expect(A.act(s, 1, 'offer', await r(g)).cards).toEqual([]);
  });
  // Deck empty, and whichever way this koehandel goes the attacker shares no animal with anyone afterwards: money
  // cannot change its score any more, so it puts everything in.
  it('puts everything in when money can no longer matter', async () => {
    const s = await setup([[0, 0, 100, 50, 50, 50, 50, 10, 10, 10], [50, 10, 100, 10], [0, 0, 0, 0, 50, 100]],
      [{ cow: 2, mule: 1, cat: 1 }, { horse: 2, mule: 1, goat: 2 }, { pig: 2, sheep: 2, cat: 1 }], []);
    s.turn = 2; apply(s, 2, { type: 'koehandel', target: 0, animal: 'cat' }, s.clock++);
    const A = await insane({ allIn: 1 });
    expect(sorted(A.act(s, 2, 'offer', await r(1)).cards)).toEqual([0, 0, 0, 0, 50, 100]);
    s.players[0].animals.chicken = 1; s.players[1].animals.chicken = 1; // a fight between the other two changes nothing
    expect(sorted(A.act(s, 2, 'offer', await r(1)).cards)).toEqual([0, 0, 0, 0, 50, 100]);
    // a mule fight with player 0 is still to come, and with player 0 holding less than this attacker it can be won:
    // money matters
    s.players[2].animals.mule = 1; s.players[1].animals.mule = 0; s.players[0].money = [0, 0, 10, 10, 10, 50]; s.ledger[0] = 80;
    expect(sum(A.act(s, 2, 'offer', await r(1)).cards)).toBeLessThan(150);
  });
  // th.solo: the settings for a table where all the others are people (the bots can see who is a bot).
  it('plays its solo settings only when all the others are people', async () => {
    const s = await setup([[0, 0, 10, 10, 50, 100, 10], [0, 0, 10, 10, 10, 10, 50, 50], [0, 0, 10, 50, 50]], [{}, { goat: 1 }, { goat: 1 }]);
    s.turn = 1; s.players[1].bot = 'insane';
    const A = await insane({ khBias: -0.99, khBiasP: -0.99, solo: { khBias: 10, khBiasP: 10 } }); // never a koehandel, or always one
    expect(A.act(s, 1, 'turn', await r(1)).type).toBe('koehandel');
    s.players[0].bot = 'hard';
    expect(A.act(s, 1, 'turn', await r(1)).type).toBe('auction');
  });
  // The opening bid reaches the table: a bot jumps to it instead of raising by 10.
  it('a bot opens with its opening bid', async () => {
    const { nextBid } = await import('../lib/bots/index');
    expect(nextBid('insane', 0, 200, Math.random, 120)).toBe(120);
    expect(nextBid('insane', 130, 200, () => 0, 120)).toBe(140); // already above it: the usual step
    expect(nextBid('insane', 0, 100, Math.random, 120)).toBe(10); // never above the limit
  });
});

describe('fifth-round changes', () => {
  // with the fifth round's 20-card settings (the seventh round's bid lower and leave this horse unopened)
  // (net: 0, the formula alone: these are its settings)
  const FIFTH = { delta: 0.527, deltaEnd: 1.4, muEnd: 0.47, shade: 1.32, mu: 660, gamma: 1.29, rho: 0.874, tau: 1.46, tau1: 125, mDec: 0.0521, khBias: 0, net: 0 };
  const agent = async () => { const { makeAgent } = await import('../lib/bots/levels'); const { INSANE } = await import('../lib/bots/index'); return makeAgent({ kind: 'expert', th: { ...INSANE, small: { ...INSANE.small, ...FIFTH } } }); };
  const sim = () => import('../lib/bots/sim');
  it('blends the 20-card settings into the full-deck ones up to 30 cards', async () => {
    const { forDeck } = await import('../lib/bots/expert');
    const th = { shade: 1, mu: 500, small: { shade: 1.4, mu: 700 } };
    expect(forDeck(th, 20)).toMatchObject({ shade: 1.4, mu: 700 });
    expect(forDeck(th, 25).shade).toBeCloseTo(1.2);
    expect(forDeck(th, 30)).toMatchObject({ shade: 1, mu: 500 });
    expect(forDeck(th, 40)).toMatchObject({ shade: 1, mu: 500 });
  });
  // A high opening bid only pays when the auctioneer might buy the animal back: against a player who never did, it is
  // just a higher price.
  it('opens lower against an auctioneer who never buys back', async () => {
    const { newSimGame, rng } = await sim(), A = await agent();
    const s = newSimGame(3, 20, rng(305)); apply(s, s.turn, { type: 'auction' }, s.clock++);
    const a = s.auction, me = (a.auctioneer + 1) % 3;
    expect(a.type).toBe('horse');
    const past = buy => [1, 2, 3, 4, 5].map(() => ({ t: 'a', k: 'dog', A: a.auctioneer, w: buy ? a.auctioneer : me, p: 40, buy, mx: {}, pred: {} }));
    const fresh = A.bid(s, me, rng(1)).open;
    s.hist = past(false); const sold = A.bid(s, me, rng(1)).open;
    s.hist = past(true); const bought = A.bid(s, me, rng(1)).open;
    expect(fresh).toBeGreaterThan(0);
    expect(sold).toBeLessThan(fresh);
    expect(bought).toBeGreaterThanOrEqual(fresh);
  });
  // Late in a 20-card game a split pair goes to whoever can pay more in the koehandel: paying all your money for the
  // second pig while a player who holds the first keeps theirs just hands them the pair.
  it('keeps money to defend a pair late in the game', async () => {
    const { newSimGame, rng } = await sim(), A = await agent();
    const s = newSimGame(3, 20, rng(5)); s.deck = ['duck', 'cat', 'dog', 'goat', 'sheep', 'chicken', 'horse', 'cow'];
    const herds = [{ cow: 2 }, { pig: 1, horse: 2 }, { sheep: 2 }], hands = [[0, 0, 50, 50, 100], [0, 0, 10, 10, 50], [0, 0, 10, 50, 50]];
    s.players.forEach((p, i) => { for (const t in p.animals) p.animals[t] = 0; Object.assign(p.animals, herds[i]); p.money = hands[i]; });
    s.ledger = s.players.map(p => sum(p.money)); s.turn = 2;
    apply(s, 2, { type: 'auction' }, s.clock++); s.auction.type = 'pig';
    expect(A.bid(s, 0, rng(1)).cap).toBeLessThan(200);
  });
});

describe('sixth-round changes', () => {
  // Two moments from a 20-card game a person won against two Insanes (tests/fixtures, rebuilt with
  // agent/scripts/rebuild.mjs): Pippin, rich, sold a horse for 60, and Clover, holding the other cat, sold a cat for 20.
  // Buying back looked better to both, but not by the fixed margin buy-backs used to need; a cheap buy-back needs less
  // (and counting their own expected score tips the horse further). These test the formula's margins, so without the
  // learned model of the eighth round (net: 0); with it, Insane buys the horse back either way and sells the cat.
  const fixture = async name => { const fs = await import('node:fs'); return JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')); };
  const agentWith = async (small = {}) => { const { makeAgent } = await import('../lib/bots/levels'); const { INSANE } = await import('../lib/bots/index'); return makeAgent({ kind: 'expert', th: { ...INSANE, small: { ...INSANE.small, net: 0, ...small } } }); };
  for (const name of ['horse60', 'cat20']) it(`buys back cheaply when it pays (${name})`, async () => {
    const { rng } = await import('../lib/bots/sim'), s = await fixture(name), A = s.auction.auctioneer;
    expect(s.auction.stage).toBe('decide');
    expect((await agentWith()).act(s, A, 'decide', rng(1)).type).toBe('buy');
    expect((await agentWith({ mDecP: 0, own: 0 })).act(s, A, 'decide', rng(1)).type).toBe('sell'); // as it played
  });
});

// ---- whole games: one person who plays simple moves (or sleeps), the rest bots of every kind ----
describe('full games with bots', () => {
  const person = s => { // auctions when it can, otherwise lets the clock decide
    const w = waiting(s);
    return w.what === 'turn' && s.deck.length ? { type: 'auction' } : null;
  };
  const combos = [['easy', 'medium', 'hard'], ['insane', 'random', 'confusing'], ['hard', 'hard', 'hard', 'hard'], ['random', 'confusing'], ['medium', 'insane', 'easy', 'confusing']];
  combos.forEach((bots, n) => [40, 26].forEach(size => {
    // Every animal and every coin stays accounted for, no bot ever runs out of time, and the game ends.
    it(`${bots.join(', ')} with a ${size}-card deck`, () => {
      const s = table(bots, { deckSize: size, timeout: 10 }); s.seed = n + size; apply(s, 0, { type: 'start' }, 1);
      const money = () => 90 * s.players.length + s.players.length * [50, 100, 200, 500].slice(0, s.mules).reduce((a, b) => a + b, 0);
      for (let now = 1, k = 0; s.phase !== 'over' && k < 40000; now += 400, k++) {
        tick(s, now);
        const w = waiting(s);
        if (w && w.p === 0 && k % 3 === 0) { const x = person(s); if (x) apply(s, 0, x, now); }
        for (const t of TYPES) {
          const c = s.deck.filter(x => x === t).length + s.players.reduce((a, p) => a + p.animals[t], 0) + (s.auction?.type === t ? 1 : 0);
          expect(c).toBe(countsOf(s)[t]);
        }
        expect(total(s)).toBe(money());
      }
      expect(s.phase).toBe('over');
      const late = s.log.filter(l => / ran out of time/.test(l) && !/^Ann /.test(l));
      expect(late).toEqual([]);
      s.players.slice(1).forEach(p => expect(p.strikes || 0).toBe(0));
    }, 60000);
  }));
});
