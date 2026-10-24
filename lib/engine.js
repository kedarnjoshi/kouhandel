// Pure game engine. A bot is just a player that calls apply(state, playerIndex, action).
import { ANIMALS, TYPES, MULE_PAY, START_MONEY, sum, cheapest } from './rules.js';
import { LEVELS, isLevel, botName, botRand, botBid, botMove, thinkMs, reactMs, nextBid, publicLimits } from './bots/index.js';
export { ANIMALS, cheapest };
// Bidding: 20s when the auction opens, every bid resets the clock to 10s, the auctioneer may add 5s once (never above 20s left).
const OPEN_MS = 20000, BID_MS = 10000, EXTEND_MS = 5000, MAX_LEFT_MS = 20000;
// Seconds a player gets for every decision (turn, sell/buy, paying, koehandel offer/answer); set per table.
export const clampTimeout = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(120, Math.max(10, n)) : 30; };
const limitMs = s => (s.timeout || 30) * 1000;
// Deck size: 40 animals (10 types x 4) is the normal game. A smaller deck (down to 20) has 2 to 4 of each type,
// picked at random when the game starts and kept secret until the end; a set is all the copies of a type.
export const FULL_DECK = 40, MIN_DECK = 20;
export const clampDeck = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(FULL_DECK, Math.max(MIN_DECK, n)) : FULL_DECK; };
const ALL4 = Object.fromEntries(TYPES.map(k => [k, 4]));
export const countsOf = s => s.counts || ALL4;
// A uniformly random way to have 2, 3 or 4 of each type adding up to n cards (each possible deck equally likely).
export function composition(n, rand = Math.random) {
  const ways = [[1]]; // ways[k][r]: ways to give k types 2-4 cards each, r cards in total
  for (let k = 1; k <= TYPES.length; k++) { ways[k] = []; for (let r = 0; r <= 4 * k; r++) ways[k][r] = [2, 3, 4].reduce((w, c) => w + (ways[k - 1][r - c] || 0), 0); }
  const out = {}; let left = n;
  for (let k = TYPES.length; k > 0; k--) {
    let x = rand() * ways[k][left], c = 2;
    for (; c < 4; c++) { x -= ways[k - 1][left - c] || 0; if (x < 0) break; }
    out[TYPES[TYPES.length - k]] = c; left -= c;
  }
  return out;
}
const STRIKES_TO_KICK = 2; // anyone may kick a player who let the clock run out this many times in a row
const need = (c, m) => { if (!c) throw new Error(m); };
const say = (s, m) => { s.log.unshift(m); s.log.length = Math.min(s.log.length, 30); };
// Private message for one player about money that just changed hands (only they see it).
const note = (s, i, text, got = [], gave = []) => { s.seq = (s.seq || 0) + 1; (s.notes ||= {})[i] = { id:s.seq, text, got, gave }; };
// What the table knows about everyone's money, for the bots (they never look at hidden cards):
// ledger[j] is the public estimate (start money, mule payouts and auction prices, which everybody sees), and
// mem[i][j] is what player i privately knows on top of that (amounts in their own koehandels, overpayments to them).
const ledger = (s, j, d) => { if (s.ledger) s.ledger[j] += d; };
const know = (s, i, j, d) => { if (s.mem) s.mem[i][j] += d; };
// Koehandel amounts are secret, but everyone sees how many cards each side put down. The ledger books the net
// amount such numbers of cards usually stand for, fitted on games between Insane bots (agent/scripts/khdata.mjs):
// per card put down, a share of the average card on the table plus a share of that player's own average card (from
// the public estimates). The two players in the deal know the real amounts (mem corrects the
// ledger for them), and unc[i][j] records how unsure player i should be about j's money (a variance).
function secretDeal(s, a, b, pays, na, nb, aWins) {
  let tot = 0, cnt = 0; for (const p of s.players) { tot += sum(p.money); cnt += p.money.length; }
  const avg = tot / Math.max(1, cnt), own = Math.min(3 * avg, (s.ledger ? Math.max(0, s.ledger[a]) : 0) / Math.max(1, s.players[a].money.length));
  const ownB = Math.min(3 * avg, (s.ledger ? Math.max(0, s.ledger[b]) : 0) / Math.max(1, s.players[b].money.length));
  const guess = !nb ? 0.17 * na * avg + 0.396 * na * own
    : aWins ? 0.159 * na * avg + 0.093 * na * own + 0.164 * nb * avg + 0.08 * nb * ownB
    : -(0.076 * na * avg + 0.143 * na * own + 0.258 * nb * avg + 0.113 * nb * ownB);
  ledger(s, a, -guess); ledger(s, b, guess);
  know(s, a, b, pays - guess); know(s, b, a, guess - pays);
  if (s.unc) { const d = 0.8 * Math.abs(guess) + 20; s.unc.forEach((u, i) => { if (i !== a && i !== b) { u[a] += d * d; u[b] += d * d; } }); }
}
// What happened so far, for the bots to learn how each player plays: auctions (everyone's highest bid, who got the
// animal at what price, and what a plain bidder would have paid, from public information), and koehandels (card
// counts and the winner for everyone; the amounts x and y are only shown to the two players in the deal, see
// observe in lib/bots/brain.js).
const record = (s, e) => { (s.hist ||= []).push(e); if (s.hist.length > 600) { s.hist.shift(); s.histCut = true; } };
// Paid cards (cs) and the cards of koehandel offers (ca, cb) are only shown to the players who handled them.
function aucDone(s, got, price, bought, cards = null) {
  const a = s.auction;
  record(s, { t:'a', k:a.type, A:a.auctioneer, w:got ?? null, p:price || 0, buy:!!bought, mx:a.mx || {}, pred:a.pred || {}, led:a.led || null,
    ...(cards ? { P:a.payer, Q:a.payee, m:cards.length, cs:[...cards] } : {}) });
}
const khDone = (s, tr, ca, cb, win) => record(s, { t:'k', a:tr.a, b:tr.b, k:tr.type, c:tr.count, na:ca.length, nb:cb ? cb.length : null, win, x:sum(ca), y:cb ? sum(cb) : null, ca:[...ca], cb:cb ? [...cb] : null });
const nm = t => (t === 'mule' ? 'money mule' : t); // how an animal is called in messages
const plural = (n, t) => (n > 1 && t !== 'sheep' ? `${n} ${nm(t)}s` : `${n > 1 ? n + ' ' : ''}${nm(t)}`);

export const newGame = (o = {}) => ({ name:o.name || 'Table', public:!!o.public, code:o.code || '', showLog:o.showLog !== false, timeout:clampTimeout(o.timeout), deckSize:clampDeck(o.deckSize), due:null, seq:o.seq || 0, notes:{}, phase:'lobby', players:[], deck:[], mules:0, turn:0, auction:null, trade:null, log:[] });
// Games saved before the rooster became the chicken and the donkey became the money mule.
const RENAMED = { rooster:'chicken', donkey:'mule' };
export function upgrade(s) {
  const fix = t => RENAMED[t] || t;
  for (const p of s.players) for (const [o, n] of Object.entries(RENAMED)) if (o in p.animals) { p.animals[n] = p.animals[o]; delete p.animals[o]; }
  if ('donkeys' in s) { s.mules = s.donkeys; delete s.donkeys; }
  s.deck = s.deck.map(fix);
  if (s.auction) s.auction.type = fix(s.auction.type);
  if (s.trade) s.trade.type = fix(s.trade.type);
  return s;
}
export const newPlayer = (name, token) => ({ name, token, money:[], animals:Object.fromEntries(Object.keys(ANIMALS).map(k => [k, 0])) });

function take(hand, cards) { // returns hand minus cards, or throws
  need(Array.isArray(cards), 'Invalid cards');
  const h = [...hand];
  for (const c of cards) { const i = h.indexOf(c); need(i >= 0, 'You do not have those cards'); h.splice(i, 1); }
  return h;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Possible koehandels for player i: any other player sharing an incomplete animal type.
// Animals left behind by a player who left or was kicked ("limbo") can be taken for free by anyone who owns that type.
export function targets(s, i) {
  const me = s.players[i], out = [];
  if (me.out) return out;
  s.players.forEach((o, j) => {
    if (j === i) return;
    for (const t in ANIMALS) if (me.animals[t] && o.animals[t]) out.push({ p:j, type:t, count:Math.min(me.animals[t], o.animals[t]), ...(o.out ? { free:true } : {}) });
  });
  return out;
}
export const score = (p, counts = ALL4) => {
  const full = TYPES.filter(k => counts[k] && p.animals[k] === counts[k]);
  return { sets: full.length, score: sum(full.map(k => ANIMALS[k])) * full.length };
};
const active = s => s.players.filter(p => !p.out).length;
export const host = s => s.players.findIndex(p => !p.out && !p.bot); // the first person (not a bot) still in the game
const humans = s => s.players.some(p => !p.out && !p.bot);

function over(s, why) { s.auction = s.trade = null; s.phase = 'over'; delete s.paused; say(s, why); }
function advance(s) {
  s.auction = s.trade = null; s.phase = 'turn';
  const P = s.players;
  if (active(s) < 2) return over(s, 'Game over: not enough players left');
  if (!humans(s)) return over(s, 'Game over: only bots are left');
  if (!s.deck.length && !P.some((_, i) => targets(s, i).length)) return over(s, 'Game over');
  do s.turn = (s.turn + 1) % P.length; // skip players who left, and (once the deck is empty) players who cannot koehandel
  while (P[s.turn].out || (!s.deck.length && !targets(s, s.turn).length));
}
function closeBidding(s) {
  const a = s.auction, au = s.players[a.auctioneer];
  if (!a.high) { au.animals[a.type]++; say(s, `No bids: ${au.name} keeps the ${nm(a.type)}`); aucDone(s, a.auctioneer, 0, false); advance(s); }
  else if (au.out) sellToHighest(s); // nobody is left to decide: the highest bidder buys it
  else a.stage = 'decide';
}
function sellToHighest(s) { const a = s.auction; a.stage = 'pay'; a.payer = a.high.p; a.payee = a.auctioneer; }
// Who has to act right now and on what, or null (lobby, game over, and auction bidding, which has its own timer).
export function waiting(s) {
  const a = s.auction, tr = s.trade;
  if (s.phase === 'turn') return { p:s.turn, what:'turn' };
  if (s.phase === 'auction' && a.stage === 'decide') return { p:a.auctioneer, what:'decide' };
  if (s.phase === 'auction' && a.stage === 'pay') return { p:a.payer, what:'pay' };
  if (s.phase === 'trade') return tr.a in tr.bids ? { p:tr.b, what:'respond' } : { p:tr.a, what:'offer' };
  return null;
}
// Is there just one thing this player can do (so a bot need not take its time)? Paying, a turn with nothing to
// koehandel for (or exactly one koehandel left), buying back without the money, answering or offering without money.
function onlyMove(s, w) {
  const p = s.players[w.p], m = sum(p.money);
  if (w.what === 'pay') return true;
  if (w.what === 'turn') { const n = targets(s, w.p).length; return s.deck.length ? !n : n === 1; }
  if (w.what === 'decide') return m < s.auction.high.amt;
  if (w.what === 'respond') return m === 0;
  if (w.what === 'offer') return !p.money.length;
  return false;
}
// A fresh clock for whoever has to decide now. A bot also gets the moment it will move (well before the limit).
const restartClock = (s, now) => {
  const w = waiting(s), p = w && s.players[w.p];
  s.due = w ? now + limitMs(s) : null;
  s.botAt = p && p.bot && !p.out ? now + thinkMs(p.bot, w.what, limitMs(s), botRand(s, w.p, 't' + (s.step || 0)), onlyMove(s, w)) : null;
};
function timedOut(s, now) { // a turn is skipped; inside an action the obvious choice is made
  const w = waiting(s), p = s.players[w.p];
  p.strikes = (p.strikes || 0) + 1;
  say(s, `${p.name} ran out of time${w.what === 'turn' ? ' and skips the turn' : ''}`);
  obvious(s, w, now);
}
function obvious(s, w, now) {
  const p = s.players[w.p];
  if (w.what === 'turn') advance(s);
  else if (w.what === 'decide') act(s, w.p, { type:sum(p.money) >= s.auction.high.amt ? 'buy' : 'sell' }, now);
  else if (w.what === 'pay') autoPay(s, now);
  else if (w.what === 'offer') act(s, w.p, { type:'tradebid', cards:[] }, now);
  else act(s, w.p, { type:'accept' }, now);
}
// Pay with the cheapest covering cards. If the payer somehow cannot cover the price, the sale is called off
// and the auctioneer keeps the animal, so the game always moves on.
function autoPay(s, now) {
  const a = s.auction, pr = s.players[a.payer];
  if (sum(pr.money) >= a.high.amt) return act(s, a.payer, { type:'pay', cards:cheapest(pr.money, a.high.amt) }, now, true);
  s.players[a.auctioneer].animals[a.type]++;
  say(s, `${pr.name} cannot pay: ${s.players[a.auctioneer].name} keeps the ${nm(a.type)}`); aucDone(s, a.auctioneer, 0, false); advance(s);
}
// Timers are enforced lazily: whoever looks at the table after a deadline triggers what should have happened.
// Bots move the same way: at the moment they were due to (so a few bot moves in a row all happen on one look).
export function tick(s, now) {
  if (s.paused) return; // nothing runs while the host has paused the game
  for (let i = 0; i < 400; i++) {
    const a = s.auction;
    if (s.phase === 'auction' && a.stage === 'bidding') {
      const b = plannedBid(s);
      if (b && b.at <= now) { s.step = (s.step || 0) + 1; try { act(s, b.p, { type:'bid', amount:b.amt }, b.at); } catch { a.caps[b.p] = 0; } continue; }
      if (now < a.deadline) break;
      closeBidding(s);
    } else {
      const w = waiting(s);
      if (!w) break;
      if (s.botAt && s.botAt <= now && !(s.due && s.due < s.botAt)) { botMoves(s, w, s.botAt); continue; }
      if (!(s.due && now >= s.due)) break;
      timedOut(s, now);
    }
    restartClock(s, now);
  }
  ended(s, now);
}
// The first bid one of the bots will make on the open auction, if any: a moment after the last bid, and always
// before the clock runs out.
function plannedBid(s) {
  const a = s.auction; let best = null;
  if (!a.caps) return null;
  s.players.forEach((p, j) => {
    if (!p.bot || p.out || j === a.auctioneer || (a.high && a.high.p === j) || !(j in a.caps)) return;
    const cur = a.high ? a.high.amt : 0, cap = Math.min(a.caps[j], sum(p.money));
    if (cap < cur + 10) return;
    const r = botRand(s, j, `b${s.deck.length}:${a.nb || 0}`);
    // the first bid comes late (a bid shows interest, and nobody else may bid at all), later ones after a moment
    const gap = LEVELS[p.bot].bidGap ?? 2500; // bidGap: how much later at most, on top of reacting
    const wait = a.high ? reactMs(p.bot, r) + Math.floor(r() * gap) : a.deadline - (a.at || 0) - 1500 - Math.floor(r() * 2500);
    const at = Math.max(a.at || 0, Math.min((a.at || 0) + wait, a.deadline - 300 - Math.floor(r() * 500)));
    if (!best || at < best.at) best = { at, p:j, amt:nextBid(p.bot, cur, cap, r, a.opens ? a.opens[j] || 0 : 0) };
  });
  return best;
}
// A bot makes its move. Should it ever come up with something the rules refuse, it makes the obvious move instead.
function botMoves(s, w, at) {
  s.step = (s.step || 0) + 1;
  try { act(s, w.p, botMove(s, w.p, w.what, botRand(s, w.p, 'm' + s.step)), at); }
  catch { obvious(s, w, at); }
  restartClock(s, at);
}
// Every bot at the table decides how much it would pay for the animal that just came up.
function botCaps(s, now) {
  const a = s.auction; a.caps = {}; a.opens = {}; a.at = now; a.nb = 0;
  s.players.forEach((p, j) => { if (p.bot && !p.out && j !== a.auctioneer) try { const b = botBid(s, j, botRand(s, j, 'c' + s.deck.length)); a.caps[j] = b.cap; if (b.open) a.opens[j] = b.open; } catch { a.caps[j] = 0; } });
}
function resolveTrade(s) {
  const tr = s.trade, A = s.players[tr.a], B = s.players[tr.b], ca = tr.bids[tr.a], cb = tr.bids[tr.b], sa = sum(ca), sb = sum(cb);
  if (sa === sb) {
    if (!tr.ties) {
      tr.ties = 1; tr.tieAt = sa; tr.bids = {}; say(s, `Tie! ${A.name} and ${B.name} bid again`);
      note(s, tr.a, `Tie: you both offered ${sa}. ${A.name} offers again first.`); note(s, tr.b, `Tie: you both offered ${sa}. ${A.name} offers again first.`);
      return;
    }
    // Official rule: a second tie gives the player who started the koehandel the animals for free.
    A.animals[tr.type] += tr.count; B.animals[tr.type] -= tr.count;
    say(s, `Tie again! ${A.name} takes ${plural(tr.count, tr.type)} from ${B.name} for free`); khDone(s, tr, ca, cb, tr.a);
    note(s, tr.a, `Tie again at ${sa}: you take the ${nm(tr.type)} for free. No money changes hands.`);
    note(s, tr.b, `Tie again at ${sa}: ${A.name} takes the ${nm(tr.type)} for free. No money changes hands.`);
    advance(s); return;
  }
  const [wi, li, cw, cl] = sa > sb ? [tr.a, tr.b, ca, cb] : [tr.b, tr.a, cb, ca], w = s.players[wi], l = s.players[li];
  secretDeal(s, tr.a, tr.b, sa - sb, ca.length, cb.length, sa > sb);
  w.money = take(w.money, cw).concat(cl); l.money = take(l.money, cl).concat(cw); // bids are swapped
  w.animals[tr.type] += tr.count; l.animals[tr.type] -= tr.count;
  say(s, `${w.name} wins ${plural(tr.count, tr.type)} from ${l.name}`); // amounts stay secret, as in the real game
  khDone(s, tr, ca, cb, wi);
  note(s, wi, `You win the ${nm(tr.type)}! You gave ${l.name} ${sum(cw)} and got ${sum(cl)} back.`, cl, cw);
  note(s, li, `${w.name} wins the ${nm(tr.type)}. You got ${sum(cw)} from ${w.name} and gave ${sum(cl)}.`, cw, cl);
  advance(s);
}

// Hand out a departing player's money as evenly as possible: biggest cards first, each to whoever has received
// the least so far; ties go to the poorer player (then fewer cards received, then seat order).
export function shareOut(s, ki) {
  const K = s.players[ki], cards = [...K.money].sort((a, b) => b - a), wealth = s.players.map(p => sum(p.money));
  const got = new Map(s.players.map((p, i) => [i, []]).filter(([i]) => i !== ki && !s.players[i].out));
  if (!got.size) return;
  const rank = i => [sum(got.get(i)), wealth[i], got.get(i).length, i];
  const before = (x, y) => { const a = rank(x), b = rank(y); for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };
  for (const c of cards) got.get([...got.keys()].reduce((best, i) => (before(i, best) ? i : best))).push(c);
  const n = K.money.length || 1;
  for (const [i, cs] of got) { ledger(s, i, (s.ledger?.[ki] || 0) * cs.length / n); s.mem?.forEach(m => { m[i] += m[ki] * cs.length / n; }); }
  if (s.ledger) s.ledger[ki] = 0; s.mem?.forEach(m => { m[ki] = 0; });
  K.money = [];
  for (const [i, cs] of got) if (cs.length) { s.players[i].money.push(...cs); note(s, i, `${K.name} is out of the game. You received ${sum(cs)} of their money.`, cs); }
}
// A player leaves mid-game (or is kicked). Whatever they owe right now is settled like a timeout (a payment they
// were about to make is made with their cheapest cards), then the rest of their money is shared out and their
// animals stay behind in limbo. Anything else that was waiting on them is resolved so the game can go on.
function removeFromPlay(s, ki, why, now) {
  const K = s.players[ki];
  say(s, why);
  if (s.phase === 'auction' && s.auction.stage === 'pay' && s.auction.payer === ki) autoPay(s, now);
  K.out = true; shareOut(s, ki); record(s, { t:'x', p:ki }); // (the bots stop tracking cards exactly after this)
  if (active(s) < 2) return over(s, 'Game over: not enough players left');
  if (!humans(s)) return over(s, 'Game over: only bots are left');
  const a = s.auction, tr = s.trade;
  if (s.phase === 'turn' && s.turn === ki) advance(s);
  else if (s.phase === 'auction' && a.auctioneer === ki && a.stage === 'decide') sellToHighest(s); // bidding just goes on otherwise
  else if (s.phase === 'auction' && a.high && a.high.p === ki && a.stage !== 'pay') { // their bid is void: bidding starts over
    Object.assign(a, { stage:'bidding', high:null, deadline:now + BID_MS, at:now, nb:(a.nb || 0) + 1 });
    say(s, `Bidding on the ${nm(a.type)} starts over`);
  } else if (s.phase === 'trade' && tr.a === ki) { say(s, 'The koehandel is cancelled'); advance(s); }
  else if (s.phase === 'trade' && tr.b === ki) { // nobody left to answer: the other player takes the animals for free
    s.players[tr.a].animals[tr.type] += tr.count; K.animals[tr.type] -= tr.count;
    say(s, `${s.players[tr.a].name} takes ${plural(tr.count, tr.type)} for free`); advance(s);
  }
}

const waitKey = s => { const w = waiting(s); return w ? w.p + w.what : ''; };
export function apply(s, pi, x, now = Date.now()) {
  tick(s, now);
  const before = waitKey(s);
  act(s, pi, x, now);
  if (!['kick', 'end', 'leave'].includes(x.type)) s.players[pi].strikes = 0; // they are back
  if (waitKey(s) !== before) restartClock(s, now); // the decision (and a fresh clock) moved to someone else
  return ended(s, now);
}
const ended = (s, now) => { if (s.phase === 'over' && !s.endedAt) s.endedAt = now; return s; }; // when the game finished
function act(s, pi, x, now, forced = false) { // forced: a move made for a player who timed out or was removed
  const P = s.players, me = P[pi], t = x.type, au = s.auction, tr = s.trade;
  if (t === 'start') {
    need(s.phase === 'lobby' && pi === host(s), 'Only the host can start from the lobby');
    need(P.length >= 3, 'Need at least 3 players');
    const size = clampDeck(s.deckSize);
    s.counts = size === FULL_DECK ? { ...ALL4 } : composition(size);
    s.deck = shuffle(TYPES.flatMap(k => Array(s.counts[k]).fill(k)));
    P.forEach(p => { p.money = [...START_MONEY]; });
    s.turn = Math.floor(Math.random() * P.length); s.phase = 'turn'; say(s, 'Game started');
    s.ledger = P.map(p => sum(p.money)); s.mem = P.map(() => P.map(() => 0)); s.unc = P.map(() => P.map(() => 0)); s.seed = Math.floor(Math.random() * 2 ** 31); s.step = 0;
    return s;
  }
  if (t === 'addbot') {
    need(s.phase === 'lobby', 'Bots can only join before the game starts'); need(pi === host(s), 'Only the host can add bots');
    need(isLevel(x.level), 'Pick a bot level'); need(P.length < 5, 'Table is full');
    const b = newPlayer(botName(P.map(p => p.name)), null); b.bot = x.level; P.push(b);
    say(s, `${b.name} (${x.level} bot) joined the table`); return s;
  }
  if (t === 'end') {
    need(pi === host(s), 'Host only'); need(s.phase !== 'lobby' && s.phase !== 'over', 'The game is not running');
    over(s, 'The host ended the game'); return s;
  }
  if (t === 'pause') {
    need(pi === host(s), 'Only the host can pause'); need(s.phase !== 'lobby' && s.phase !== 'over', 'The game is not running');
    need(!s.paused, 'The game is already paused');
    s.paused = { by:pi, at:now }; say(s, `${me.name} paused the game`); return s;
  }
  if (t === 'resume') {
    need(s.paused, 'The game is not paused'); need(pi === host(s), 'Only the host can resume');
    const d = Math.max(0, now - s.paused.at); delete s.paused; // every clock picks up where it was
    if (s.due) s.due += d;
    if (s.botAt) s.botAt += d;
    if (s.auction) { if (s.auction.deadline) s.auction.deadline += d; if (s.auction.at) s.auction.at += d; }
    say(s, `${me.name} resumed the game`); return s;
  }
  if (t === 'leave') {
    if (s.phase === 'lobby') { // the next person becomes host; bots do not stay at a table without people
      say(s, `${P.splice(pi, 1)[0].name} left the table`);
      if (!P.some(p => !p.bot)) P.length = 0;
      return s;
    }
    need(s.phase !== 'over' && !me.out, 'You are not in this game');
    removeFromPlay(s, pi, `${me.name} left the game`, now); return s;
  }
  if (t === 'kick') {
    const k = x.target, o = Number.isInteger(k) ? P[k] : null;
    need(o && k !== pi, 'Pick a player to kick');
    if (s.phase === 'lobby') { need(pi === host(s), 'Only the host can kick'); P.splice(k, 1); say(s, `${o.name} was removed from the table`); return s; }
    need(s.phase !== 'over' && !o.out && !me.out, 'Not allowed right now');
    need(pi === host(s) || (o.strikes || 0) >= STRIKES_TO_KICK, `Only the host can kick (anyone can kick a player who missed ${STRIKES_TO_KICK} moves in a row)`);
    removeFromPlay(s, k, `${o.name} was kicked by ${me.name}`, now);
    note(s, k, `${me.name} removed you from the game. Your money was shared out; you can keep watching.`); return s;
  }
  need(!me.out || forced, 'You are no longer in this game');
  need(!s.paused || forced, 'The game is paused');

  if (s.phase === 'turn') {
    need(pi === s.turn, 'Not your turn');
    if (t === 'auction') {
      need(s.deck.length, 'The deck is empty');
      const type = s.deck.pop();
      if (type === 'mule') {
        const amt = MULE_PAY[s.mules++];
        P.forEach((p, i) => { if (!p.out) { p.money.push(amt); ledger(s, i, amt); note(s, i, `Money mule! Everyone receives ${amt}.`, [amt]); } });
        record(s, { t:'m', amt, to:P.map((p, i) => (p.out ? -1 : i)).filter(i => i >= 0) });
        say(s, `Money mule! Everyone receives ${amt}`);
      }
      s.auction = { type, auctioneer:pi, high:null, stage:'bidding', deadline:now + OPEN_MS }; s.phase = 'auction';
      botCaps(s, now); s.auction.pred = publicLimits(s); s.auction.led = s.ledger ? s.ledger.slice() : null; // public money estimates when bidding opened
      say(s, `${me.name} auctions a ${nm(type)}`);
      return s;
    }
    if (t === 'koehandel') {
      const o = Number.isInteger(x.target) ? P[x.target] : null, n = o && Math.min(me.animals[x.animal], o.animals[x.animal]);
      need(o && targets(s, pi).some(c => c.p === x.target && c.type === x.animal), 'You cannot start a koehandel for that');
      if (o.out) { // animals in limbo: free for the taking
        me.animals[x.animal] += n; o.animals[x.animal] -= n;
        say(s, `${me.name} takes ${plural(n, x.animal)} from ${o.name}'s abandoned herd`); advance(s); return s;
      }
      s.trade = { a:pi, b:x.target, type:x.animal, count:n, bids:{} };
      (s.khs ||= []).push([pi, x.target, x.animal]); if (s.khs.length > 24) s.khs.shift(); // recent koehandels, for the bots
      s.phase = 'trade'; say(s, `${me.name} starts a koehandel with ${o.name} for ${nm(x.animal)}`);
      return s;
    }
  } else if (s.phase === 'auction') {
    if (au.stage === 'bidding') {
      if (t === 'bid') {
        need(pi !== au.auctioneer, 'The auctioneer cannot bid');
        need(!au.high || au.high.p !== pi, 'You are already the highest bidder');
        const amt = Number(x.amount);
        need(Number.isInteger(amt) && amt % 10 === 0 && amt > (au.high ? au.high.amt : 0), 'Bid higher than the current bid, in multiples of 10');
        need(amt <= sum(me.money), 'You do not have that much money');
        au.high = { p:pi, amt }; (au.mx ||= {})[pi] = amt; au.deadline = now + BID_MS; au.at = now; au.nb = (au.nb || 0) + 1;
        return s;
      }
      if (t === 'extend') {
        need(pi === au.auctioneer, 'Auctioneer only'); need(!au.extended, 'You can only add time once per auction');
        au.deadline = Math.min(Math.max(au.deadline, now) + EXTEND_MS, now + MAX_LEFT_MS); au.extended = true; return s;
      }
    } else if (au.stage === 'decide') {
      need(pi === au.auctioneer, 'The auctioneer decides');
      if (t === 'sell') { au.stage = 'pay'; au.payer = au.high.p; au.payee = pi; return s; }
      if (t === 'buy') { need(sum(me.money) >= au.high.amt, 'You cannot afford that'); au.stage = 'pay'; au.payer = pi; au.payee = au.high.p; return s; }
    } else if (au.stage === 'pay' && t === 'pay') {
      need(pi === au.payer, 'Not your payment');
      const pr = P[au.payer], pe = P[au.payee], rest = take(pr.money, x.cards);
      need(sum(x.cards) >= au.high.amt, `Pay at least ${au.high.amt} (no change is given)`);
      pr.money = rest; pe.money.push(...x.cards); pr.animals[au.type]++;
      say(s, `${pr.name} gets the ${nm(au.type)} for ${au.high.amt}`); aucDone(s, au.payer, au.high.amt, au.payer === au.auctioneer, x.cards);
      ledger(s, au.payer, -au.high.amt); ledger(s, au.payee, au.high.amt); // only the payee sees an overpayment
      know(s, au.payee, au.payer, au.high.amt - sum(x.cards)); know(s, au.payer, au.payee, sum(x.cards) - au.high.amt);
      note(s, au.payer, `You paid ${pe.name} ${sum(x.cards)} for the ${nm(au.type)}.`, [], x.cards);
      note(s, au.payee, `${pr.name} paid you ${sum(x.cards)} for the ${nm(au.type)}.`, x.cards);
      if (pe.out) shareOut(s, au.payee);
      advance(s);
      return s;
    }
  } else if (s.phase === 'trade' && (t === 'tradebid' || t === 'accept')) {
    // The player who started the koehandel offers first (face down); the other player sees how many cards were offered and counters or accepts.
    need(pi === tr.a || pi === tr.b, 'You are not in this koehandel');
    need(!(pi in tr.bids), 'You already bid');
    need(pi === tr.a || tr.a in tr.bids, `Wait for ${P[tr.a].name} to make an offer first`);
    if (t === 'accept') {
      need(pi === tr.b, `Only ${P[tr.b].name} can accept`);
      const A = P[tr.a], ca = tr.bids[tr.a];
      secretDeal(s, tr.a, pi, sum(ca), ca.length, 0, true); A.money = take(A.money, ca); me.money = me.money.concat(ca);
      A.animals[tr.type] += tr.count; me.animals[tr.type] -= tr.count;
      say(s, `${me.name} accepts ${A.name}'s offer and hands over ${plural(tr.count, tr.type)}`); khDone(s, tr, ca, null, tr.a);
      note(s, pi, `You accepted ${A.name}'s offer and got ${sum(ca)}.`, ca);
      note(s, tr.a, `${me.name} accepted your offer: you get the ${nm(tr.type)} for ${sum(ca)}.`, [], ca);
      advance(s); return s;
    }
    take(me.money, x.cards); tr.bids[pi] = x.cards;
    if (tr.a in tr.bids && tr.b in tr.bids) resolveTrade(s);
    return s;
  }
  throw new Error('Not allowed right now');
}

// What a given player (index, or -1 for spectator) may see: no other hands, no tokens, no hidden bids.
export function view(s, pi) {
  const tr = s.trade;
  return {
    now:Date.now(), name:s.name, public:s.public, phase:s.phase, deckSize:clampDeck(s.deckSize),
    counts:clampDeck(s.deckSize) === FULL_DECK || s.phase === 'over' ? countsOf(s) : null, // a smaller deck stays a secret until the end
    paused:s.paused ? { by:s.paused.by, name:s.players[s.paused.by]?.name ?? '?', at:s.paused.at } : null,
    endedAt:s.endedAt || null, timeout:s.timeout || 30, due:s.due || null, waiting:waiting(s), me:pi, turn:s.turn, deck:s.deck.length, mules:s.mules, next:s.botAt || null, host:host(s),
    auction:s.auction && (({ caps, opens, at, nb, pred, mx, led, ...a }) => a)(s.auction), // not what the bots are willing to pay
    showLog:s.showLog !== false, log:s.log.slice(0, s.showLog === false ? 1 : 8), // log off: only "what just happened", no history
    trade:tr && { a:tr.a, b:tr.b, type:tr.type, count:tr.count, submitted:Object.keys(tr.bids).map(Number), offer:tr.a in tr.bids ? tr.bids[tr.a].length : null, ties:tr.ties || 0 },
    note:pi >= 0 && s.notes?.[pi] || null,
    players:s.players.map((p, i) => ({ name:p.name, bot:p.bot || null, animals:p.animals, cards:p.money.length, out:!!p.out, strikes:p.strikes || 0, money:i === pi ? [...p.money].sort((a, b) => a - b) : null, ...(s.phase === 'over' ? score(p, countsOf(s)) : {}) })),
    targets:s.phase === 'turn' && pi === s.turn ? targets(s, pi) : [],
  };
}
