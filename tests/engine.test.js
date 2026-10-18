import { describe, it, expect } from 'vitest';
import { ANIMALS, newGame, newPlayer, apply, tick, view, targets, score, cheapest, clampTimeout } from '../lib/engine';

const TYPES = Object.keys(ANIMALS);
const START = [0, 0, 10, 10, 10, 10, 50];
const MULE_PAY = [50, 100, 200, 500];
const sum = a => a.reduce((x, y) => x + y, 0);
const sorted = a => [...a].sort((x, y) => x - y);
const total = s => s.players.reduce((n, p) => n + sum(p.money), 0);
const zero = o => ({ ...Object.fromEntries(TYPES.map(t => [t, 0])), ...o });

function lobby(n = 3) { const s = newGame(); for (let i = 0; i < n; i++) s.players.push(newPlayer('P' + i, 'tok' + i)); return s; }
// Started game, player 0 to move. `draws` is the order cards will be drawn from the deck.
function game(n = 3, draws = ['duck', 'duck', 'duck']) { const s = lobby(n); apply(s, 0, { type: 'start' }); s.turn = 0; s.deck = [...draws].reverse(); return s; }
const give = (s, i, animals) => Object.assign(s.players[i].animals, animals);
const act = (s, pi, x, now = 1000) => apply(s, pi, x, now); // fixed clock so timers never fire by accident
const open = (draws = ['cow']) => { const s = game(3, draws); apply(s, 0, { type: 'auction' }, 0); return s; }; // deadline 20000
const snapshot = s => JSON.stringify(s);
const expire = s => tick(s, s.auction.deadline); // only the timer ends bidding

describe('setup', () => {
  // Animal point values used at this table (horse 1000 down to chicken 10).
  it('has the agreed animal values', () => {
    expect(ANIMALS).toEqual({ horse: 1000, cow: 800, pig: 650, mule: 500, goat: 350, sheep: 250, dog: 160, cat: 90, duck: 40, chicken: 10 });
  });
  // Starting deals each player 0,0,10x4,50 (90 total), builds 10 types x 4 cards, and moves to the turn phase.
  it('deals 90 to everyone, builds a 40-card deck and starts the game', () => {
    const s = lobby(4); apply(s, 0, { type: 'start' });
    expect(s.phase).toBe('turn');
    expect(s.deck).toHaveLength(40);
    for (const t of TYPES) expect(s.deck.filter(x => x === t)).toHaveLength(4);
    s.players.forEach(p => expect(sorted(p.money)).toEqual(START));
    expect(s.turn).toBeGreaterThanOrEqual(0); expect(s.turn).toBeLessThan(4);
  });
  // A non-host player cannot start the game.
  it('only the host can start', () => expect(() => apply(lobby(3), 1, { type: 'start' })).toThrow(/host/));
  // The game refuses to start with fewer than 3 players.
  it('needs at least 3 players', () => expect(() => apply(lobby(2), 0, { type: 'start' })).toThrow(/3 players/));
  // Start is rejected once the game is already running.
  it('cannot be started twice', () => expect(() => apply(game(), 0, { type: 'start' })).toThrow(/lobby/));
  // Game actions such as auction are rejected while still in the lobby.
  it('allows no gameplay in the lobby', () => expect(() => apply(lobby(3), 0, { type: 'auction' })).toThrow(/Not allowed/));
});

describe('auction: opening and bidding', () => {
  // Auctioning flips the top card, opens bidding, and sets a deadline 20s ahead.
  it('draws the top card and opens bidding with a 10s timer', () => {
    const s = game(3, ['cow', 'pig']); apply(s, 0, { type: 'auction' }, 1000);
    expect(s.phase).toBe('auction');
    expect(s.auction).toMatchObject({ type: 'cow', auctioneer: 0, high: null, stage: 'bidding', deadline: 21000 });
    expect(s.deck).toEqual(['pig']);
  });
  // A player who is not on turn cannot start an auction.
  it('only the player whose turn it is can auction', () => expect(() => act(game(), 1, { type: 'auction' })).toThrow(/Not your turn/));
  // Auctioning is rejected when no cards are left in the deck.
  it('cannot auction from an empty deck', () => expect(() => act(game(3, []), 0, { type: 'auction' })).toThrow(/empty/));
  // Each higher bid becomes the high bid and resets the deadline to 10s from that moment.
  it('accepts raising bids and resets the timer to 10s on each', () => {
    const s = open();
    act(s, 1, { type: 'bid', amount: 30 }, 4000);
    expect(s.auction.high).toEqual({ p: 1, amt: 30 }); expect(s.auction.deadline).toBe(14000);
    act(s, 2, { type: 'bid', amount: 40 }, 5000);
    expect(s.auction.high).toEqual({ p: 2, amt: 40 }); expect(s.auction.deadline).toBe(15000);
  });
  // A bid sent as a string (from the text input) is accepted as a number.
  it('accepts a bid sent as a numeric string (form input)', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: '50' }); expect(s.auction.high.amt).toBe(50);
  });
  // A bid up to the bidder's total money is allowed; one coin above it is rejected.
  it('lets a player bid all of their money but not more', () => {
    const s = open();
    expect(() => act(s, 1, { type: 'bid', amount: 100 })).toThrow(/that much money/);
    act(s, 1, { type: 'bid', amount: 90 }); expect(s.auction.high.amt).toBe(90);
  });
  // Every invalid bid (auctioneer bidding, equal or lower, not a multiple of 10, fractional, zero, negative, non-numeric) is rejected and leaves the state untouched.
  it.each([
    ['the auctioneer bidding', 0, 30, /auctioneer cannot bid/],
    ['a bid equal to the current one', 2, 30, /higher/],
    ['a lower bid', 2, 20, /higher/],
    ['a non-multiple of 10', 2, 45, /multiples of 10/],
    ['a fractional bid', 2, 40.5, /multiples of 10/],
    ['a zero bid', 2, 0, /higher/],
    ['a negative bid', 2, -10, /higher/],
    ['a non-numeric bid', 2, 'abc', /higher/],
  ])('rejects %s', (_, pi, amount, re) => {
    const s = open(); act(s, 1, { type: 'bid', amount: 30 });
    const before = snapshot(s);
    expect(() => act(s, pi, { type: 'bid', amount })).toThrow(re);
    expect(snapshot(s)).toBe(before);
  });
  // The auctioneer can add 5s once per auction, never above 20s left; nobody else can extend.
  it('lets the auctioneer add 5s once, capped at 20s left', () => {
    const s = open(); // deadline 20000
    act(s, 0, { type: 'extend' }, 10000); expect(s.auction.deadline).toBe(25000); // 10s left -> 15s
    expect(() => act(s, 0, { type: 'extend' }, 11000)).toThrow(/once/);
    const t = open(); act(t, 0, { type: 'extend' }, 1000); expect(t.auction.deadline).toBe(21000); // 19s left -> capped at 20s
    expect(() => act(open(), 1, { type: 'extend' })).toThrow(/Auctioneer only/);
  });
  // Nobody, not even the auctioneer, can end bidding early: only the timer closes it.
  it('does not let anyone close bidding early', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 30 });
    for (const pi of [0, 1, 2]) expect(() => act(s, pi, { type: 'close' })).toThrow(/Not allowed/);
    expect(s.auction.stage).toBe('bidding');
  });
  // The current highest bidder cannot raise their own bid; once someone outbids them they can bid again.
  it('does not let the highest bidder outbid themselves', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 30 });
    expect(() => act(s, 1, { type: 'bid', amount: 40 })).toThrow(/already the highest bidder/);
    act(s, 2, { type: 'bid', amount: 40 }); act(s, 1, { type: 'bid', amount: 50 });
    expect(s.auction.high).toEqual({ p: 1, amt: 50 });
  });
});

describe('auction: timer', () => {
  // If the timer runs out with no bids, the auctioneer keeps the animal for free and the turn advances.
  it('with no bids, expiry gives the auctioneer the animal free and passes the turn', () => {
    const s = open(['cow', 'pig']); tick(s, 20000);
    expect(s.players[0].animals.cow).toBe(1); expect(s.phase).toBe('turn'); expect(s.turn).toBe(1); expect(s.auction).toBeNull();
  });
  // Bidding stays open until the deadline and closes at exactly the deadline, moving to the decision stage.
  it('does not expire before the deadline, and expires exactly at it', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 20 }); // deadline 11000
    tick(s, 10999); expect(s.auction.stage).toBe('bidding');
    tick(s, 11000); expect(s.auction.stage).toBe('decide');
  });
  // Bids and extensions arriving after the deadline are rejected against the closed auction.
  it('rejects bids that arrive after expiry', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 20 }); // deadline 11000
    expect(() => act(s, 2, { type: 'bid', amount: 30 }, 22000)).toThrow(/auctioneer decides/);
    expect(() => act(s, 0, { type: 'extend' }, 22000)).toThrow(/Not allowed/);
  });
});

describe('auction: sell, buy and payment', () => {
  const decided = (amt = 30) => { const s = open(['cow', 'pig']); act(s, 1, { type: 'bid', amount: amt }); expire(s); return s; };

  // Selling: the high bidder pays the auctioneer with chosen cards, receives the animal, and the turn passes on.
  it('sell: the high bidder pays the auctioneer and gets the animal', () => {
    const s = decided(); act(s, 0, { type: 'sell' });
    expect(s.auction).toMatchObject({ stage: 'pay', payer: 1, payee: 0 });
    act(s, 1, { type: 'pay', cards: [10, 10, 10] });
    expect(s.players[1].animals.cow).toBe(1); expect(s.players[0].animals.cow).toBe(0);
    expect(sorted(s.players[1].money)).toEqual([0, 0, 10, 50]);
    expect(sorted(s.players[0].money)).toEqual(sorted([...START, 10, 10, 10]));
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(1);
  });
  // Buying: the auctioneer pays the high bidder, gets the animal, and the bidder receives the cards.
  it('buy: the auctioneer pays the high bidder and gets the animal', () => {
    const s = decided(); act(s, 0, { type: 'buy' });
    expect(s.auction).toMatchObject({ stage: 'pay', payer: 0, payee: 1 });
    act(s, 0, { type: 'pay', cards: [50] });
    expect(s.players[0].animals.cow).toBe(1); expect(s.players[1].animals.cow).toBe(0);
    expect(sorted(s.players[1].money)).toEqual(sorted([...START, 50]));
  });
  // The auctioneer cannot buy at a price above their total money.
  it('buy: refused when the auctioneer cannot afford the high bid', () => {
    const s = open(); s.players[0].money = [10]; act(s, 1, { type: 'bid', amount: 30 }); expire(s);
    expect(() => act(s, 0, { type: 'buy' })).toThrow(/afford/);
  });
  // Other players cannot make the sell/buy decision.
  it('only the auctioneer decides sell or buy', () => {
    const s = decided();
    expect(() => act(s, 1, { type: 'sell' })).toThrow(/auctioneer decides/);
    expect(() => act(s, 2, { type: 'buy' })).toThrow(/auctioneer decides/);
  });
  // Payment must cover the bid; extra is kept by the payee (no change), and short payments are rejected.
  it('gives no change: overpaying is allowed, underpaying is not', () => {
    const s = decided(); act(s, 0, { type: 'sell' });
    expect(() => act(s, 1, { type: 'pay', cards: [10, 10] })).toThrow(/at least 30/);
    expect(() => act(s, 1, { type: 'pay', cards: [0, 0] })).toThrow(/at least 30/);
    act(s, 1, { type: 'pay', cards: [50] });
    expect(sorted(s.players[0].money)).toEqual(sorted([...START, 50]));
  });
  // Paying with cards you do not have (wrong value, too many copies, not a list) is rejected.
  it('rejects paying with cards the payer does not hold', () => {
    const s = decided(); act(s, 0, { type: 'sell' });
    expect(() => act(s, 1, { type: 'pay', cards: [500] })).toThrow(/do not have/);
    expect(() => act(s, 1, { type: 'pay', cards: [10, 10, 10, 10, 10] })).toThrow(/do not have/);
    expect(() => act(s, 1, { type: 'pay', cards: 'lots' })).toThrow();
  });
  // Only the designated payer can submit the payment cards.
  it('only the payer can pay', () => {
    const s = decided(); act(s, 0, { type: 'sell' });
    expect(() => act(s, 0, { type: 'pay', cards: [50] })).toThrow(/Not your payment/);
    expect(() => act(s, 2, { type: 'pay', cards: [50] })).toThrow(/Not your payment/);
  });
  // The total money in the game is unchanged by a payment.
  it('conserves money through a payment', () => {
    const s = decided(); const before = total(s); act(s, 0, { type: 'sell' }); act(s, 1, { type: 'pay', cards: [50] });
    expect(total(s)).toBe(before);
  });
  // A rejected payment does not modify the game state.
  it('a failed payment leaves the state unchanged', () => {
    const s = decided(); act(s, 0, { type: 'sell' }); const before = snapshot(s);
    expect(() => act(s, 1, { type: 'pay', cards: [10] })).toThrow();
    expect(snapshot(s)).toBe(before);
  });
  // No other action (such as a new auction) is allowed while a payment is outstanding.
  it('blocks other actions while a payment is pending', () => {
    const s = decided(); act(s, 0, { type: 'sell' });
    expect(() => act(s, 0, { type: 'auction' })).toThrow(/Not allowed/);
  });
});

describe('money mules', () => {
  // Messages call it a money mule.
  it('calls the mule a money mule in the log', () => {
    const s = game(3, ['mule']); act(s, 0, { type: 'auction' });
    expect(s.log.slice(0, 2)).toEqual(['P0 auctions a money mule', 'Money mule! Everyone receives 50']);
  });
  // The four money mules pay all players 50, 100, 200, then 500 when drawn, and are then auctioned like any animal.
  it('pay everyone 50, 100, 200 then 500, and are still auctioned', () => {
    const s = game(4, ['mule', 'mule', 'mule', 'mule']);
    let cum = 0;
    MULE_PAY.forEach((amt, i) => {
      cum += amt;
      act(s, s.turn, { type: 'auction' });
      expect(s.auction.type).toBe('mule'); expect(s.mules).toBe(i + 1);
      s.players.forEach(p => expect(sum(p.money)).toBe(90 + cum));
      expire(s);
    });
    expect(s.players.reduce((n, p) => n + p.animals.mule, 0)).toBe(4);
  });
  // The money mule payout counts towards what players can bid in that same auction.
  it('can be bid on with the money just received', () => {
    const s = game(3, ['mule']); act(s, 0, { type: 'auction' });
    act(s, 1, { type: 'bid', amount: 140 }); expect(s.auction.high.amt).toBe(140);
  });
});

describe('koehandel: starting one', () => {
  const setup = (a = 1, b = 1) => { const s = game(3); give(s, 0, { horse: a }); give(s, 1, { horse: b }); return s; };
  const start = (s, target = 1, animal = 'horse') => act(s, 0, { type: 'koehandel', target, animal }); // player 0 starts a koehandel

  // targets() returns exactly the (player, animal) pairs both sides share.
  it('lists exactly the possible koehandels', () => {
    const s = setup(); give(s, 2, { cow: 1 }); give(s, 0, { cow: 1 });
    expect(targets(s, 0)).toEqual(expect.arrayContaining([{ p: 1, type: 'horse', count: 1 }, { p: 2, type: 'cow', count: 1 }]));
    expect(targets(s, 0)).toHaveLength(2);
  });
  // A koehandel is rejected if the other player does not hold that animal.
  it('needs a shared animal type', () => {
    const s = game(); give(s, 0, { horse: 1 }); give(s, 1, { cow: 1 });
    expect(() => start(s)).toThrow(/cannot start a koehandel/);
  });
  // A koehandel is rejected if the starter does not hold that animal.
  it('needs the starter to own that type too', () => {
    const s = game(); give(s, 1, { horse: 1 }); expect(() => start(s)).toThrow(/cannot start a koehandel/);
  });
  // You cannot start a koehandel with yourself or a player that does not exist.
  it('rejects koehandels with yourself and unknown players', () => {
    const s = setup();
    expect(() => start(s, 0)).toThrow(/cannot start a koehandel/);
    expect(() => start(s, 9)).toThrow(/cannot start a koehandel/);
  });
  // Only the player on turn can start a koehandel.
  it('only works on your own turn', () => {
    const s = setup(); expect(() => act(s, 1, { type: 'koehandel', target: 0, animal: 'horse' })).toThrow(/Not your turn/);
  });
  // Option A: the number of animals traded is the smaller of the two counts (1v1, 2v1, 2v2, 3v1).
  it.each([[1, 1, 1], [2, 1, 1], [2, 2, 2], [3, 1, 1]])('with %i vs %i animals puts %i at stake', (a, b, n) => {
    const s = setup(a, b); start(s);
    expect(s.phase).toBe('trade'); expect(s.trade).toMatchObject({ a: 0, b: 1, type: 'horse', count: n });
  });
});

describe('koehandel: offers and resolution', () => {
  const setup = (a = 1, b = 1) => { const s = game(3); give(s, 0, { horse: a }); give(s, 1, { horse: b }); act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' }); return s; };
  const bids = (s, c0, c1) => { act(s, 0, { type: 'tradebid', cards: c0 }); act(s, 1, { type: 'tradebid', cards: c1 }); };

  // Higher bid wins the animal, and the two players swap the bid cards they put down.
  it('the starter wins with the higher bid; bids are swapped', () => {
    const s = setup(); bids(s, [50], [10, 10]);
    expect(s.players[0].animals.horse).toBe(2); expect(s.players[1].animals.horse).toBe(0);
    expect(sorted(s.players[0].money)).toEqual(sorted([0, 0, 10, 10, 10, 10, 10, 10]));
    expect(sorted(s.players[1].money)).toEqual(sorted([0, 0, 10, 10, 50, 50]));
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(1); expect(s.trade).toBeNull();
  });
  // The other player can win and take the animal from the starter.
  it('defender wins with the higher bid', () => {
    const s = setup(); bids(s, [10], [50]);
    expect(s.players[1].animals.horse).toBe(2); expect(s.players[0].animals.horse).toBe(0);
  });
  // Equal totals (even with different cards) cancel the bids and both players bid again.
  it('a tie clears both bids and lets them bid again', () => {
    const s = setup(); s.players[1].money = [10, 10, 10, 10, 10]; bids(s, [50], [10, 10, 10, 10, 10]);
    expect(s.phase).toBe('trade'); expect(s.trade.bids).toEqual({}); expect(s.players[0].animals.horse).toBe(1);
    bids(s, [50], [10]);
    expect(s.players[0].animals.horse).toBe(2);
  });
  // Official rule: a second tie in a row gives the starter the animals for free, with no money changing hands.
  it('a second tie gives the starter the animals for free', () => {
    const s = setup(2, 2); const m0 = sorted(s.players[0].money), m1 = sorted(s.players[1].money);
    bids(s, [10], [10]); expect(s.phase).toBe('trade');
    bids(s, [0], []);
    expect(s.players[0].animals.horse).toBe(4); expect(s.players[1].animals.horse).toBe(0);
    expect(sorted(s.players[0].money)).toEqual(m0); expect(sorted(s.players[1].money)).toEqual(m1);
    expect(s.phase).toBe('turn'); expect(s.trade).toBeNull();
  });
  // Two players with no money can no longer tie forever and lock up the game.
  it('two broke players cannot deadlock the game', () => {
    const s = setup(); s.players[0].money = [0]; s.players[1].money = [];
    bids(s, [0], []); bids(s, [], []);
    expect(s.players[0].animals.horse).toBe(2); expect(s.phase).toBe('turn');
  });
  // The public log never reveals how much was bid in a cow trade.
  it('does not reveal trade amounts in the log', () => {
    const s = setup(); bids(s, [50], [10, 10]);
    expect(s.log[0]).not.toMatch(/50|20/);
  });
  // The starter always offers first; the other player has to wait for that offer.
  it('the other player cannot bid before the starter', () => {
    const s = setup();
    expect(() => act(s, 1, { type: 'tradebid', cards: [10] })).toThrow(/Wait for P0/);
    expect(() => act(s, 1, { type: 'accept' })).toThrow(/Wait for P0/);
    act(s, 0, { type: 'tradebid', cards: [10] }); act(s, 1, { type: 'tradebid', cards: [50] });
    expect(s.players[1].animals.horse).toBe(2);
  });
  // Everyone sees how many cards the starter offered, but never their values.
  it('shows the number of offered cards, not their value', () => {
    const s = setup(); expect(view(s, 1).trade.offer).toBeNull();
    act(s, 0, { type: 'tradebid', cards: [10, 0, 50] });
    for (const pi of [1, 2, -1]) { const v = view(s, pi); expect(v.trade.offer).toBe(3); expect(JSON.stringify(v.trade)).not.toContain('50'); }
  });
  // The other player may accept the offer: they hand over the animals and keep the starter's cards.
  it('the defender can accept the offer', () => {
    const s = setup(2, 2); const before = total(s);
    act(s, 0, { type: 'tradebid', cards: [10, 0] }); act(s, 1, { type: 'accept' });
    expect(s.players[0].animals.horse).toBe(4); expect(s.players[1].animals.horse).toBe(0);
    expect(sorted(s.players[0].money)).toEqual([0, 10, 10, 10, 50]);
    expect(sorted(s.players[1].money)).toEqual(sorted([...START, 10, 0]));
    expect(total(s)).toBe(before); expect(s.phase).toBe('turn');
  });
  // Only the defender can accept, and only once the offer is on the table.
  it('only the defender can accept', () => {
    const s = setup(); act(s, 0, { type: 'tradebid', cards: [10] });
    expect(() => act(s, 0, { type: 'accept' })).toThrow();
    expect(() => act(s, 2, { type: 'accept' })).toThrow(/not in this koehandel/);
  });
  // Bidding no cards counts as 0 and is allowed.
  it('allows an empty (zero) bid', () => {
    const s = setup(); bids(s, [], [10]); expect(s.players[1].animals.horse).toBe(2);
  });
  // Bidding only 0-value cards equals an empty bid and ties.
  it('zero-value cards bid 0 and tie with an empty bid', () => {
    const s = setup(); bids(s, [], [0, 0]); expect(s.phase).toBe('trade');
  });
  // A resolved trade does not create or destroy money.
  it('conserves money', () => {
    const s = setup(); const before = total(s); bids(s, [50], [10, 10]); expect(total(s)).toBe(before);
  });
  // Starter holds 2, other player 1, starter wins: only one animal moves (3 vs 0).
  it('unequal counts: only the smaller count moves (starter has more, wins)', () => {
    const s = setup(2, 1); bids(s, [50], [10]);
    expect(s.players[0].animals.horse).toBe(3); expect(s.players[1].animals.horse).toBe(0);
  });
  // Starter holds 2, other player 1, other player wins: only one animal moves (1 vs 2).
  it('unequal counts: only the smaller count moves (defender wins)', () => {
    const s = setup(2, 1); bids(s, [10], [50]);
    expect(s.players[1].animals.horse).toBe(2); expect(s.players[0].animals.horse).toBe(1);
  });
  // Winning a 3 vs 1 trade gives the winner a complete set of 4, which scores.
  it('3 vs 1 completes a set for the winner', () => {
    const s = setup(3, 1); bids(s, [50], [10]);
    expect(s.players[0].animals.horse).toBe(4); expect(score(s.players[0])).toEqual({ sets: 1, score: 1000 });
  });
  // With 2 each, the winner takes both animals.
  it('2 vs 2 moves both animals', () => {
    const s = setup(2, 2); bids(s, [50], [10]);
    expect(s.players[0].animals.horse).toBe(4); expect(s.players[1].animals.horse).toBe(0);
  });
  // The other player's view shows only who has bid, never the cards.
  it('keeps bids hidden until both are in', () => {
    const s = setup(); act(s, 0, { type: 'tradebid', cards: [50] });
    const v = view(s, 1);
    expect(v.trade.submitted).toEqual([0]); expect(v.trade).not.toHaveProperty('bids');
    expect(JSON.stringify(v)).not.toContain('"cards":[50]');
  });
  // Only the two traders can bid, each once, using cards they actually hold.
  it('rejects bids from non-participants, double bids and cards not held', () => {
    const s = setup();
    expect(() => act(s, 2, { type: 'tradebid', cards: [] })).toThrow(/not in this koehandel/);
    expect(() => act(s, 0, { type: 'tradebid', cards: [500] })).toThrow(/do not have/);
    expect(() => act(s, 0, { type: 'tradebid', cards: [50, 50] })).toThrow(/do not have/);
    expect(() => act(s, 0, { type: 'tradebid', cards: null })).toThrow();
    act(s, 0, { type: 'tradebid', cards: [10] });
    expect(() => act(s, 0, { type: 'tradebid', cards: [50] })).toThrow(/already bid/);
  });
  // No other action is allowed while a trade is waiting for bids.
  it('blocks other actions while a trade is pending', () => {
    const s = setup(); expect(() => act(s, 0, { type: 'auction' })).toThrow(/Not allowed/);
  });
});

describe('turn order and game end', () => {
  // After each auction the turn moves to the next player and wraps around.
  it('passes the turn round the table', () => {
    const s = game(3, ['duck', 'duck', 'duck', 'duck']);
    for (const who of [0, 1, 2, 0]) { expect(s.turn).toBe(who); act(s, who, { type: 'auction' }); expire(s); }
  });
  // The game ends once the deck is empty and no player pair shares an incomplete animal.
  it('ends when the deck is empty and nobody can trade', () => {
    const s = game(3, ['duck']); act(s, 0, { type: 'auction' }); expire(s);
    expect(s.phase).toBe('over');
  });
  // With an empty deck but trades still possible, play continues and auctions are rejected.
  it('continues while trades remain, with no auctions possible', () => {
    const s = game(3, ['duck']); give(s, 1, { horse: 1 }); give(s, 2, { horse: 1 });
    act(s, 0, { type: 'auction' }); expire(s);
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(1);
    expect(() => act(s, 1, { type: 'auction' })).toThrow(/empty/);
  });
  // With an empty deck the turn skips players who cannot start a koehandel.
  it('skips players who cannot trade once the deck is empty', () => {
    const s = game(3, ['duck']); give(s, 2, { duck: 1 });
    act(s, 0, { type: 'auction' }); expire(s); // p0 now holds a duck, p2 too; p1 has nothing
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // Only the host can end the game early.
  it('lets only the host end the game early', () => {
    const s = game(); expect(() => act(s, 1, { type: 'end' })).toThrow(/Host only/);
    act(s, 0, { type: 'end' }); expect(s.phase).toBe('over');
  });
  // The host cannot "end" a game that has not started or is already over.
  it('cannot end a game from the lobby or twice', () => {
    expect(() => act(lobby(3), 0, { type: 'end' })).toThrow(/not running/);
    const s = game(); act(s, 0, { type: 'end' }); expect(() => act(s, 0, { type: 'end' })).toThrow(/not running/);
  });
  // Ending mid-auction clears the auction so nothing is left half-done.
  it('ending mid-auction clears the auction', () => {
    const s = open(); act(s, 0, { type: 'end' }); expect(s.auction).toBeNull(); expect(s.phase).toBe('over');
  });
  // In the lobby a player can give up their seat; if the host leaves the next player becomes host.
  it('lets players leave their seat in the lobby', () => {
    const s = lobby(3); act(s, 0, { type: 'leave' });
    expect(s.players.map(p => p.name)).toEqual(['P1', 'P2']);
  });
  // A koehandel target must be a real player index (not a string or object).
  it('rejects non-integer koehandel targets', () => {
    const s = game(); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 });
    expect(() => act(s, 0, { type: 'koehandel', target: '1', animal: 'horse' })).toThrow(/cannot start a koehandel/);
  });
  // Nothing can be done after the game is over.
  it('allows no actions once the game is over', () => {
    const s = game(); act(s, 0, { type: 'end' });
    expect(() => act(s, 0, { type: 'auction' })).toThrow(/Not allowed/);
    expect(() => act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' })).toThrow(/Not allowed/);
  });
});

describe('private money notices', () => {
  const setup = () => { const s = game(3); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 }); act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' }); return s; };
  // After a cow trade each trader is told exactly which cards they got and gave; nobody else sees it.
  it('tells both traders what they received and gave', () => {
    const s = setup(); act(s, 0, { type: 'tradebid', cards: [50] }); act(s, 1, { type: 'tradebid', cards: [10, 10] });
    expect(view(s, 0).note).toMatchObject({ got: [10, 10], gave: [50] }); expect(view(s, 0).note.text).toMatch(/You win/);
    expect(view(s, 1).note).toMatchObject({ got: [50], gave: [10, 10] });
    expect(view(s, 2).note).toBeNull(); expect(view(s, -1).note).toBeNull();
  });
  // Accepting an offer shows the defender the cards they received.
  it('tells the defender what they got when accepting', () => {
    const s = setup(); act(s, 0, { type: 'tradebid', cards: [10, 0] }); act(s, 1, { type: 'accept' });
    expect(view(s, 1).note).toMatchObject({ got: [10, 0], gave: [] }); expect(view(s, 0).note).toMatchObject({ gave: [10, 0] });
  });
  // After an auction payment the payee sees the exact cards (overpayment included).
  it('tells the payee what they were paid', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 30 }); expire(s); act(s, 0, { type: 'sell' }); act(s, 1, { type: 'pay', cards: [50] });
    expect(view(s, 0).note).toMatchObject({ got: [50] }); expect(view(s, 1).note).toMatchObject({ gave: [50] });
  });
  // Each new notice gets a new id so the client can animate it once.
  it('gives every notice a new id, surviving a reset', () => {
    const s = setup(); act(s, 0, { type: 'tradebid', cards: [10] }); act(s, 1, { type: 'tradebid', cards: [10] }); // tie
    const id = view(s, 1).note.id; expect(view(s, 1).note.text).toMatch(/Tie/);
    act(s, 0, { type: 'tradebid', cards: [50] }); act(s, 1, { type: 'tradebid', cards: [] });
    expect(view(s, 1).note.id).toBeGreaterThan(id);
    expect(newGame(s).seq).toBe(s.seq);
  });
});

describe('decision timer', () => {
  const T = 30000; // default limit
  // Starting the game puts the first player on the clock; the limit defaults to 30s and is clamped to 10s..2min.
  it('puts the player on turn on the clock', () => {
    const s = game(); act(s, 0, { type: 'end' }); expect(s.due).toBeNull();
    const g = lobby(3); apply(g, 0, { type: 'start' }, 5000); expect(g.due).toBe(5000 + T);
    expect([clampTimeout(undefined), clampTimeout(5), clampTimeout(45), clampTimeout(1e6), clampTimeout('x')]).toEqual([30, 10, 45, 120, 30]);
    expect(newGame({ timeout: 45 }).timeout).toBe(45);
  });
  // Doing nothing on your turn skips it.
  it('turn timeout skips the turn', () => {
    const s = game(3, ['cow']); s.due = 2000;
    tick(s, 1999); expect(s.turn).toBe(0);
    tick(s, 2000); expect(s.phase).toBe('turn'); expect(s.turn).toBe(1); expect(s.deck).toEqual(['cow']);
    expect(s.due).toBe(2000 + T); expect(s.log[0]).toMatch(/P0 ran out of time and skips the turn/);
  });
  // With an empty deck the skip also passes over players who cannot koehandel.
  it('turn timeout with an empty deck skips to the next player who can koehandel', () => {
    const s = game(3, []); give(s, 0, { horse: 1 }); give(s, 2, { horse: 1 }); s.due = 2000;
    tick(s, 2000); expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // An auctioneer who does not decide buys (if they can afford it); a payer who does not pay pays the cheapest way.
  it('decide timeout makes the auctioneer buy, pay timeout pays the smallest covering amount', () => {
    const s = open(['cow', 'pig']); act(s, 1, { type: 'bid', amount: 30 }, 1000);
    tick(s, 11000); expect(s.auction.stage).toBe('decide'); expect(s.due).toBe(11000 + T);
    tick(s, 11000 + T); expect(s.auction).toMatchObject({ stage: 'pay', payer: 0, payee: 1 }); expect(s.due).toBe(11000 + 2 * T);
    tick(s, 11000 + 2 * T);
    expect(s.players[0].animals.cow).toBe(1); expect(sorted(s.players[0].money)).toEqual([0, 0, 10, 50]);
    expect(sorted(s.players[1].money)).toEqual(sorted([...START, 10, 10, 10]));
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(1);
  });
  // An auctioneer who cannot afford to buy sells instead.
  it('decide timeout sells when the auctioneer cannot afford to buy', () => {
    const s = open(['cow', 'pig']); s.players[0].money = [10]; act(s, 1, { type: 'bid', amount: 30 }, 1000);
    tick(s, 11000); tick(s, 11000 + T); expect(s.auction).toMatchObject({ stage: 'pay', payer: 1, payee: 0 });
  });
  // The player who started a koehandel and does not offer offers nothing; the other player who does not answer accepts.
  it('koehandel timeouts: no offer means 0 cards, no answer means accept', () => {
    const s = game(3); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 });
    act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' }, 1000); expect(s.due).toBe(1000 + T);
    tick(s, 1000 + T); expect(s.trade.bids).toEqual({ 0: [] }); expect(s.due).toBe(1000 + 2 * T);
    tick(s, 1000 + 2 * T); expect(s.players[0].animals.horse).toBe(2); expect(s.phase).toBe('turn');
  });
  // Every move hands the clock to the next decision with a fresh limit.
  it('restarts the clock after each move', () => {
    const s = game(3); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 });
    act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' }, 1000);
    act(s, 0, { type: 'tradebid', cards: [10] }, 5000); expect(s.due).toBe(5000 + T);
  });
  // Missing moves counts strikes; making any move clears them.
  it('counts missed moves in a row and forgives them after a move', () => {
    const s = game(3, ['cow', 'pig', 'duck']); s.due = 1000;
    tick(s, 1000); expect(s.players[0].strikes).toBe(1);
    act(s, 1, { type: 'auction' }, 2000); expect(s.players[1].strikes).toBe(0);
  });
  // A table that nobody looked at for ages only advances one step per look (no runaway chain of auto moves).
  it('a very late look does not cascade through many steps', () => {
    const s = game(3, ['cow', 'pig']); s.due = 1000;
    tick(s, 1e9); expect(s.phase).toBe('turn'); expect(s.turn).toBe(1); expect(s.due).toBe(1e9 + 30000);
  });
  // The auto-payment picks the least overpayment, then the fewest cards.
  it.each([
    [[0, 0, 10, 10, 10, 10, 50], 30, 30], [[0, 10, 50], 20, 50], [[10, 10, 50, 100], 60, 60], [[200, 50, 50, 10], 100, 100], [[500], 10, 500],
  ])('cheapest(%j, %i) pays %i', (hand, amt, paid) => {
    const c = cheapest(hand, amt); expect(sum(c)).toBe(paid); expect(() => c.reduce((h, x) => { const i = h.indexOf(x); if (i < 0) throw 0; h.splice(i, 1); return h; }, [...hand])).not.toThrow();
    expect(c).not.toContain(0);
  });
});

describe('kicking and leaving mid-game', () => {
  // The kicked player's money is spread as evenly as possible; the poorer player wins ties.
  it('shares the money out evenly, poorer players first', () => {
    const s = game(3); s.players[1].money = [0, 10]; const before = total(s);
    act(s, 0, { type: 'kick', target: 2 });
    expect(s.players[2]).toMatchObject({ out: true, money: [] });
    expect(sorted(s.players[1].money)).toEqual(sorted([0, 10, 50])); // the poorer player gets the 50 on the tie
    expect(sum(s.players[0].money)).toBe(90 + 40);
    expect(total(s)).toBe(before);
    expect(view(s, 1).note).toMatchObject({ got: [50] });
  });
  // Splitting 4 equal cards between 2 players gives 2 each.
  it('splits equal cards evenly', () => {
    const s = game(3); s.players[2].money = [10, 10, 10, 10];
    act(s, 0, { type: 'kick', target: 2 });
    expect(sum(s.players[0].money) - 90).toBe(20); expect(sum(s.players[1].money) - 90).toBe(20);
  });
  // Only the host may kick, unless the player missed 2 moves in a row; nobody kicks themselves.
  it('limits who can kick', () => {
    const s = game(3);
    expect(() => act(s, 1, { type: 'kick', target: 2 })).toThrow(/Only the host/);
    expect(() => act(s, 0, { type: 'kick', target: 0 })).toThrow(/Pick a player/);
    s.players[2].strikes = 2; act(s, 1, { type: 'kick', target: 2 }); expect(s.players[2].out).toBe(true);
    expect(() => act(s, 0, { type: 'kick', target: 2 })).toThrow(/Not allowed/);
  });
  // A kicked player is skipped and can no longer act, but still sees the table.
  it('skips kicked players and blocks their actions', () => {
    const s = game(3, ['duck', 'duck', 'duck']); act(s, 0, { type: 'kick', target: 1 });
    expect(() => act(s, 1, { type: 'auction' })).toThrow(/no longer in this game/);
    act(s, 0, { type: 'auction' }); expire(s); expect(s.turn).toBe(2);
    act(s, 2, { type: 'auction' }); expire(s); expect(s.turn).toBe(0);
    expect(view(s, 1).players[1].out).toBe(true);
  });
  // Animals left behind stay in limbo; anyone owning that type can koehandel for them and take them for free.
  it('lets players take animals from the abandoned herd for free', () => {
    const s = game(3); give(s, 0, { horse: 1 }); give(s, 2, { horse: 2, cow: 1 });
    act(s, 0, { type: 'kick', target: 2 });
    expect(s.players[2].animals).toMatchObject({ horse: 2, cow: 1 });
    expect(targets(s, 0)).toEqual([{ p: 2, type: 'horse', count: 1, free: true }]);
    const money = sorted(s.players[0].money);
    act(s, 0, { type: 'koehandel', target: 2, animal: 'horse' });
    expect(s.players[0].animals.horse).toBe(2); expect(s.players[2].animals.horse).toBe(1);
    expect(sorted(s.players[0].money)).toEqual(money); expect(s.phase).toBe('turn'); expect(s.turn).toBe(1);
    expect(targets(s, 1)).toEqual([]); // no cows, so the cow stays in limbo
  });
  // Kicking the auctioneer mid-bidding: bidding goes on; the highest bidder then buys it and the payment is shared out.
  it('kicking the auctioneer during bidding: the auction finishes and the payment is shared', () => {
    const s = game(3, ['cow', 'pig']); s.turn = 1; act(s, 1, { type: 'auction' }); act(s, 2, { type: 'bid', amount: 30 });
    act(s, 0, { type: 'kick', target: 1 });
    expect(s.players[1].out).toBe(true); expect(s.auction.stage).toBe('bidding');
    act(s, 0, { type: 'bid', amount: 40 }); expire(s);
    expect(s.auction).toMatchObject({ stage: 'pay', payer: 0, payee: 1 }); // nobody left to decide: sold
    const before = total(s);
    act(s, 0, { type: 'pay', cards: [50] });
    expect(s.players[0].animals.cow).toBe(1); expect(s.players[1].money).toEqual([]);
    expect(total(s)).toBe(before); expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // With no bids the animal stays in the departed auctioneer's abandoned herd.
  it('kicking the auctioneer with no bids leaves the animal in limbo', () => {
    const s = game(3, ['cow', 'pig']); s.turn = 1; act(s, 1, { type: 'auction' }); act(s, 0, { type: 'kick', target: 1 });
    expire(s); expect(s.players[1].animals.cow).toBe(1); expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // Kicking the auctioneer while they decide: the highest bidder buys it.
  it('kicking the auctioneer while deciding sells to the highest bidder', () => {
    const s = game(3, ['cow', 'pig']); s.turn = 1; act(s, 1, { type: 'auction' }); act(s, 2, { type: 'bid', amount: 30 }); expire(s);
    act(s, 0, { type: 'kick', target: 1 });
    expect(s.auction).toMatchObject({ stage: 'pay', payer: 2, payee: 1 });
  });
  // The example from testing: A bid 30, the auctioneer sold to A, A is kicked before paying. A pays like a timeout would.
  it('kicking a player who still has to pay: they pay first with their cheapest cards, then leave', () => {
    const s = game(3, ['cow', 'pig']); act(s, 0, { type: 'auction' }); act(s, 1, { type: 'bid', amount: 30 }); expire(s);
    act(s, 0, { type: 'sell' }); act(s, 0, { type: 'kick', target: 1 });
    expect(s.players[1]).toMatchObject({ out: true, money: [] }); expect(s.players[1].animals.cow).toBe(1); // in limbo now
    expect(s.log.join('|')).toMatch(/P1 gets the cow for 30/);
    expect(sum(s.players[0].money) + sum(s.players[2].money)).toBe(270); // the 30 plus the rest of P1's money
    expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // The auctioneer chose to buy and is kicked before paying: they pay the highest bidder first.
  it('kicking an auctioneer who bought: they pay the bidder first', () => {
    const s = game(3, ['cow', 'pig']); s.turn = 1; act(s, 1, { type: 'auction' }); act(s, 2, { type: 'bid', amount: 30 }); expire(s);
    act(s, 1, { type: 'buy' }); act(s, 0, { type: 'kick', target: 1 });
    expect(view(s, 2).note).toBeTruthy(); expect(s.players[1].animals.cow).toBe(1);
    expect(s.log.join('|')).toMatch(/P1 gets the cow for 30/); expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
  });
  // The auctioneer bought from a bidder who is then kicked: the payment still happens and is shared out.
  it('kicking the bidder an auctioneer is paying: the payment is shared out', () => {
    const s = open(['cow', 'pig']); act(s, 1, { type: 'bid', amount: 30 }); expire(s); act(s, 0, { type: 'buy' });
    act(s, 0, { type: 'kick', target: 1 }); expect(s.auction).toMatchObject({ stage: 'pay', payer: 0 });
    const before = total(s); act(s, 0, { type: 'pay', cards: [10, 10, 10] });
    expect(s.players[1].money).toEqual([]); expect(total(s)).toBe(before); expect(s.players[0].animals.cow).toBe(1);
  });
  // A kicked player is told so privately.
  it('tells the kicked player', () => {
    const s = game(3); act(s, 0, { type: 'kick', target: 2 });
    expect(view(s, 2).note.text).toMatch(/P0 removed you from the game/);
  });
  // A payment that somehow cannot be covered never freezes the game.
  it('never gets stuck on a payment that cannot be made', () => {
    const s = open(['cow', 'pig']); act(s, 1, { type: 'bid', amount: 30 }); expire(s); act(s, 0, { type: 'sell' });
    s.players[1].money = [10]; tick(s, s.due);
    expect(s.phase).toBe('turn'); expect(s.players[0].animals.cow).toBe(1); expect(s.log[0]).toMatch(/cannot pay/);
  });
  // Kicking the highest bidder starts the bidding over.
  it('kicking the highest bidder restarts the bidding', () => {
    const s = open(); act(s, 1, { type: 'bid', amount: 30 }); expire(s);
    act(s, 0, { type: 'kick', target: 1 }, 30000);
    expect(s.auction).toMatchObject({ stage: 'bidding', high: null, deadline: 40000 });
    act(s, 2, { type: 'bid', amount: 10 }, 31000); expect(s.auction.high.p).toBe(2);
  });
  // If the other side of a koehandel is kicked, the player who started it takes the animals for free; if the starter is kicked it is cancelled.
  it('settles a koehandel when one side is kicked', () => {
    const s = game(4); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 });
    act(s, 0, { type: 'koehandel', target: 1, animal: 'horse' }); act(s, 0, { type: 'kick', target: 1 });
    expect(s.players[0].animals.horse).toBe(2); expect(s.phase).toBe('turn'); expect(s.turn).toBe(2);
    const t = game(4); give(t, 1, { horse: 1 }); give(t, 2, { horse: 1 }); t.turn = 1;
    act(t, 1, { type: 'koehandel', target: 2, animal: 'horse' }); act(t, 0, { type: 'kick', target: 1 });
    expect(t.trade).toBeNull(); expect(t.turn).toBe(2); expect(t.players[2].animals.horse).toBe(1);
  });
  // Leaving mid-game is a forfeit; when fewer than 2 players are left the game ends.
  it('ends the game when everyone else has left', () => {
    const s = game(3); act(s, 1, { type: 'leave' }); expect(s.players[1].out).toBe(true); expect(s.phase).toBe('turn');
    act(s, 2, { type: 'leave' }); expect(s.phase).toBe('over'); expect(s.log[0]).toMatch(/not enough players/);
    expect(sum(s.players[0].money)).toBe(270);
  });
  // If the host leaves, the next player still in the game becomes host.
  it('passes host rights on when the host leaves', () => {
    const s = game(4); act(s, 0, { type: 'leave' });
    act(s, 1, { type: 'kick', target: 3 }); expect(s.players[3].out).toBe(true);
    act(s, 1, { type: 'end' }); expect(s.phase).toBe('over');
  });
  // Money mule money only goes to players still in the game.
  it('pays money mules only to players still in the game', () => {
    const s = game(3, ['mule']); act(s, 0, { type: 'kick', target: 2 }); const p0 = sum(s.players[0].money);
    act(s, 0, { type: 'auction' }); expect(sum(s.players[0].money)).toBe(p0 + 50); expect(s.players[2].money).toEqual([]);
  });
  // Animals stuck in limbo that nobody can claim do not stop the game from ending.
  it('ends normally when unclaimable animals remain in limbo', () => {
    const s = game(3, ['duck']); give(s, 2, { cow: 2 }); act(s, 0, { type: 'kick', target: 2 });
    act(s, 0, { type: 'auction' }); expire(s); expect(s.phase).toBe('over');
  });
  // In the lobby the host can remove a player; nobody else can.
  it('lets the host remove players in the lobby', () => {
    const s = lobby(3); expect(() => act(s, 1, { type: 'kick', target: 2 })).toThrow(/Only the host/);
    act(s, 0, { type: 'kick', target: 1 }); expect(s.players.map(p => p.name)).toEqual(['P0', 'P2']);
  });
});

describe('scoring', () => {
  // Score = (sum of completed set values) x (number of sets); horse+cow+dog = 1960 x 3 = 5880.
  it('multiplies the sum of set values by the number of sets', () => {
    expect(score({ animals: zero({ horse: 4, cow: 4, dog: 4 }) })).toEqual({ sets: 3, score: 5880 });
  });
  // One complete set scores its own value times 1.
  it('counts a single set once', () => expect(score({ animals: zero({ chicken: 4 }) })).toEqual({ sets: 1, score: 10 }));
  // Sets with fewer than 4 animals score nothing.
  it('ignores incomplete sets', () => expect(score({ animals: zero({ horse: 3, cow: 3 }) })).toEqual({ sets: 0, score: 0 }));
  // All ten sets score 3850 x 10 = 38500.
  it('scores a perfect hand of all ten sets', () => expect(score({ animals: zero(Object.fromEntries(TYPES.map(t => [t, 4]))) })).toEqual({ sets: 10, score: 38500 }));
  // Scores are absent from the view during play and included when the game is over.
  it('only reveals scores in the view once the game is over', () => {
    const s = game(); expect(view(s, 0).players[0]).not.toHaveProperty('score');
    give(s, 0, { horse: 4 }); act(s, 0, { type: 'end' });
    expect(view(s, 1).players[0]).toMatchObject({ sets: 1, score: 1000 });
  });
});

describe('view (hidden information)', () => {
  // You see your own money cards sorted; others show only a card count.
  it('shows only your own money cards, sorted, and counts for others', () => {
    const s = game(); s.players[1].money = [50, 0, 10];
    const v = view(s, 1);
    expect(v.players[1].money).toEqual([0, 10, 50]);
    expect(v.players[0].money).toBeNull(); expect(v.players[2].money).toBeNull();
    expect(v.players[0].cards).toBe(7); expect(v.players[1].cards).toBe(3);
  });
  // A spectator (not at the table) sees no player's money cards.
  it('shows spectators no money at all', () => view(game(), -1).players.forEach(p => expect(p.money).toBeNull()));
  // The view contains no player tokens, no private table code, and only the deck size, not its order.
  it('never leaks tokens, the table code or the deck order', () => {
    const s = game(); s.code = 'secret-code';
    const j = JSON.stringify(view(s, 0));
    expect(j).not.toContain('tok0'); expect(j).not.toContain('secret-code'); expect(j).not.toContain('"deck":[');
    expect(view(s, 0).deck).toBe(3);
  });
  // The view includes the table name and whether it is public.
  it('exposes table name and visibility', () => {
    const s = newGame({ name: 'Farm', public: true }); expect(view(s, -1)).toMatchObject({ name: 'Farm', public: true });
  });
  // Koehandel options are listed only for the player whose turn it is.
  it('gives possible koehandels only to the player on turn', () => {
    const s = game(); give(s, 0, { horse: 1 }); give(s, 1, { horse: 1 });
    expect(view(s, 0).targets).toEqual([{ p: 1, type: 'horse', count: 1 }]);
    expect(view(s, 1).targets).toEqual([]);
  });
});

// ---- randomised full games: legal moves only, invariants checked after every step ----
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

function step(s, r) {
  const P = s.players, pick = a => a[Math.floor(r() * a.length)];
  if (s.phase === 'turn') {
    const opts = [];
    if (s.deck.length) opts.push({ type: 'auction' }, { type: 'auction' });
    for (const t of targets(s, s.turn)) opts.push({ type: 'koehandel', target: t.p, animal: t.type });
    return apply(s, s.turn, pick(opts), 0);
  }
  if (s.phase === 'auction') {
    const au = s.auction;
    if (au.stage === 'bidding') {
      const b = pick(P.map((_, i) => i).filter(i => i !== au.auctioneer && !P[i].out && (!au.high || au.high.p !== i))), amt = (au.high ? au.high.amt : 0) + 10 * (1 + Math.floor(r() * 5));
      if (b !== undefined && r() < 0.6 && amt <= sum(P[b].money)) return apply(s, b, { type: 'bid', amount: amt }, 0);
      tick(s, au.deadline); return s;
    }
    if (au.stage === 'decide') return apply(s, au.auctioneer, { type: r() < 0.5 && sum(P[au.auctioneer].money) >= au.high.amt ? 'buy' : 'sell' }, 0);
    const cards = []; let acc = 0;
    for (const c of [...P[au.payer].money].sort((a, b) => b - a)) { if (acc >= au.high.amt) break; cards.push(c); acc += c; }
    return apply(s, au.payer, { type: 'pay', cards }, 0);
  }
  const tr = s.trade;
  for (const i of [tr.a, tr.b]) if (!(i in tr.bids)) {
    const hand = [...P[i].money], cards = [];
    for (let j = Math.floor(r() * Math.min(4, hand.length + 1)); j > 0; j--) cards.push(hand.splice(Math.floor(r() * hand.length), 1)[0]);
    return apply(s, i, { type: 'tradebid', cards }, 0);
  }
}
function invariants(s) {
  for (const k of TYPES) {
    const n = s.deck.filter(x => x === k).length + s.players.reduce((a, p) => a + p.animals[k], 0) + (s.auction && s.auction.type === k ? 1 : 0);
    if (n !== 4) throw new Error(`${k}: ${n} cards in play`);
    if (s.players.some(p => p.animals[k] < 0 || p.animals[k] > 4)) throw new Error(`${k}: count out of range`);
  }
  const expected = 90 * s.players.length + s.players.length * sum(MULE_PAY.slice(0, s.mules));
  if (total(s) !== expected) throw new Error(`money ${total(s)} != ${expected}`);
  if (s.players.some(p => p.money.some(c => ![0, 10, 50, 100, 200, 500].includes(c)))) throw new Error('bad card value');
}
describe('random full games', () => {
  for (let seed = 1; seed <= 60; seed++) {
    // Plays a full game with random legal moves and checks after every step that each animal has 4 copies in play and total money is correct; the game finishes or the host ends it.
    it(`seed ${seed}: invariants hold and the game finishes`, () => {
      const r = rng(seed), s = lobby(3 + (seed % 3)); apply(s, 0, { type: 'start' }, 0);
      let n = 0;
      while (s.phase !== 'over' && n++ < 4000) { step(s, r); invariants(s); }
      if (s.phase !== 'over') apply(s, 0, { type: 'end' }, 0); // endless trade ping-pong is allowed; the host ends it
      else expect(s.deck).toHaveLength(0), s.players.forEach((_, i) => expect(targets(s, i)).toEqual([]));
      expect(s.phase).toBe('over');
    });
  }
});
// ---- the same random games, with players kicked or leaving at random moments ----
describe('random full games with kicks and leaves', () => {
  const countAnimals = s => TYPES.map(k => s.deck.filter(x => x === k).length + s.players.reduce((a, p) => a + p.animals[k], 0) + (s.auction && s.auction.type === k ? 1 : 0));
  for (let seed = 1; seed <= 60; seed++) {
    // Kicks (by the host) and leaves happen during auctions, payments and koehandels; money is never created or lost and every animal stays accounted for.
    it(`seed ${seed}: kicks and leaves never break the game`, () => {
      const r = rng(1000 + seed), s = lobby(4 + (seed % 2)); apply(s, 0, { type: 'start' }, 0);
      const live = () => s.players.map((p, i) => i).filter(i => !s.players[i].out);
      let n = 0, removed = 0;
      while (s.phase !== 'over' && n++ < 4000) {
        const before = total(s), mules = s.mules, players = live().length;
        if (r() < 0.03 && removed < 2) {
          const who = live()[Math.floor(r() * live().length)], host = live()[0];
          if (who !== host && r() < 0.5) apply(s, host, { type: 'kick', target: who }, 0); else apply(s, who, { type: 'leave' }, 0);
          removed++;
        } else step(s, r);
        expect(countAnimals(s)).toEqual(TYPES.map(() => 4));
        expect(total(s)).toBe(before + (s.mules > mules ? MULE_PAY[mules] * players : 0));
        expect(s.players.filter(p => p.out).every(p => p.money.length === 0)).toBe(true);
        const w = s.phase === 'over' ? null : (s.phase === 'auction' && s.auction.stage === 'bidding' ? null : s.phase);
        if (w) { const p = { turn: s.turn, trade: s.trade && (s.trade.a in s.trade.bids ? s.trade.b : s.trade.a) }[w] ?? (s.auction.stage === 'decide' ? s.auction.auctioneer : s.auction.payer); expect(s.players[p].out).toBeFalsy(); }
      }
      if (s.phase !== 'over') apply(s, live()[0], { type: 'end' }, 0);
      expect(s.phase).toBe('over');
    });
  }
});
