// Pure game engine. A bot is just a player that calls apply(state, playerIndex, action).
export const ANIMALS = { horse:1000, cow:800, pig:650, donkey:500, sheep:400, goat:250, dog:160, cat:90, rooster:50, duck:10 };
const DONKEY_PAY = [50, 100, 200, 500], BID_MS = 20000, EXTEND_MS = 5000; // bidding closes 20s after the auction opens or after the latest bid
// Seconds a player gets for every decision (turn, sell/buy, paying, trade offer/answer); set per table.
export const clampTimeout = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(300, Math.max(30, n)) : 60; };
const limitMs = s => (s.timeout || 60) * 1000;
const sum = a => a.reduce((x, y) => x + y, 0);
const need = (c, m) => { if (!c) throw new Error(m); };
const say = (s, m) => { s.log.unshift(m); s.log.length = Math.min(s.log.length, 30); };
// Private message for one player about money that just changed hands (only they see it).
const note = (s, i, text, got = [], gave = []) => { s.seq = (s.seq || 0) + 1; (s.notes ||= {})[i] = { id:s.seq, text, got, gave }; };

export const newGame = (o = {}) => ({ name:o.name || 'Table', public:!!o.public, code:o.code || '', showLog:o.showLog !== false, timeout:clampTimeout(o.timeout), due:null, seq:o.seq || 0, notes:{}, phase:'lobby', players:[], deck:[], donkeys:0, turn:0, auction:null, trade:null, log:[] });
export const newPlayer = (name, token) => ({ name, token, money:[], animals:Object.fromEntries(Object.keys(ANIMALS).map(k => [k, 0])) });

function take(hand, cards) { // returns hand minus cards, or throws
  need(Array.isArray(cards), 'Invalid cards');
  const h = [...hand];
  for (const c of cards) { const i = h.indexOf(c); need(i >= 0, 'You do not have those cards'); h.splice(i, 1); }
  return h;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// Valid cow-trade challenges for player i: any other player sharing an incomplete animal type.
export function targets(s, i) {
  const me = s.players[i], out = [];
  s.players.forEach((o, j) => {
    if (j === i) return;
    for (const t in ANIMALS) if (me.animals[t] && o.animals[t] && me.animals[t] < 4 && o.animals[t] < 4) out.push({ p:j, type:t });
  });
  return out;
}
export const score = p => {
  const full = Object.keys(ANIMALS).filter(k => p.animals[k] === 4);
  return { sets: full.length, score: sum(full.map(k => ANIMALS[k])) * full.length };
};

function advance(s) {
  s.auction = s.trade = null;
  s.turn = (s.turn + 1) % s.players.length; s.phase = 'turn';
  if (!s.deck.length) {
    if (!s.players.some((_, i) => targets(s, i).length)) { s.phase = 'over'; say(s, 'Game over'); return; }
    while (!targets(s, s.turn).length) s.turn = (s.turn + 1) % s.players.length; // skip players who cannot trade
  }
}
function closeBidding(s) {
  const a = s.auction, au = s.players[a.auctioneer];
  if (!a.high) { au.animals[a.type]++; say(s, `No bids: ${au.name} keeps the ${a.type}`); advance(s); }
  else a.stage = 'decide';
}
// Who has to act right now and on what, or null (lobby, game over, and auction bidding, which has its own timer).
export function waiting(s) {
  const a = s.auction, tr = s.trade;
  if (s.phase === 'turn') return { p:s.turn, what:'turn' };
  if (s.phase === 'auction' && a.stage === 'decide') return { p:a.auctioneer, what:'decide' };
  if (s.phase === 'auction' && a.stage === 'pay') return { p:a.payer, what:'pay' };
  if (s.phase === 'trade') return tr.a in tr.bids ? { p:tr.b, what:'respond' } : { p:tr.a, what:'offer' };
  return null;
}
const restartClock = (s, now) => { s.due = waiting(s) ? now + limitMs(s) : null; };
// Cards worth at least amt with the least overpayment (then the fewest cards).
export function cheapest(hand, amt) {
  const best = new Map([[0, []]]);
  for (const c of hand) for (const [v, cs] of [...best]) { const cur = best.get(v + c); if (!cur || cur.length > cs.length + 1) best.set(v + c, [...cs, c]); }
  let pick = null;
  for (const [v, cs] of best) if (v >= amt && (!pick || v < pick[0] || (v === pick[0] && cs.length < pick[1].length))) pick = [v, cs];
  return pick ? pick[1] : [...hand];
}
function timedOut(s, now) { // the default move for whoever let the clock run out
  const w = waiting(s), name = s.players[w.p].name;
  if (w.what === 'turn' && !s.deck.length) { say(s, `${name} ran out of time and skips the turn`); advance(s); return; }
  say(s, `${name} ran out of time`);
  if (w.what === 'turn') act(s, w.p, { type:'auction' }, now);
  else if (w.what === 'decide') act(s, w.p, { type:'sell' }, now);
  else if (w.what === 'pay') act(s, w.p, { type:'pay', cards:cheapest(s.players[w.p].money, s.auction.high.amt) }, now);
  else if (w.what === 'offer') act(s, w.p, { type:'tradebid', cards:[] }, now);
  else act(s, w.p, { type:'accept' }, now);
}
// Timers are enforced lazily: whoever looks at the table after a deadline triggers what should have happened.
export function tick(s, now) {
  for (let i = 0; i < 5; i++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { if (now < s.auction.deadline) return; closeBidding(s); }
    else if (s.due && now >= s.due && waiting(s)) timedOut(s, now);
    else return;
    restartClock(s, now);
  }
}
function resolveTrade(s) {
  const tr = s.trade, A = s.players[tr.a], B = s.players[tr.b], ca = tr.bids[tr.a], cb = tr.bids[tr.b], sa = sum(ca), sb = sum(cb);
  if (sa === sb) {
    if (!tr.ties) {
      tr.ties = 1; tr.bids = {}; say(s, `Tie! ${A.name} and ${B.name} bid again`);
      note(s, tr.a, `Tie: you both offered ${sa}. ${A.name} offers again first.`); note(s, tr.b, `Tie: you both offered ${sa}. ${A.name} offers again first.`);
      return;
    }
    // Official rule: a second tie gives the challenger the animals for free (also stops broke players tying forever).
    A.animals[tr.type] += tr.count; B.animals[tr.type] -= tr.count;
    say(s, `Tie again! ${A.name} takes ${tr.count} ${tr.type} from ${B.name} for free`);
    note(s, tr.a, `Tie again at ${sa}: you take the ${tr.type} for free. No money changes hands.`);
    note(s, tr.b, `Tie again at ${sa}: ${A.name} takes the ${tr.type} for free. No money changes hands.`);
    advance(s); return;
  }
  const [wi, li, cw, cl] = sa > sb ? [tr.a, tr.b, ca, cb] : [tr.b, tr.a, cb, ca], w = s.players[wi], l = s.players[li];
  w.money = take(w.money, cw).concat(cl); l.money = take(l.money, cl).concat(cw); // bids are swapped
  w.animals[tr.type] += tr.count; l.animals[tr.type] -= tr.count;
  say(s, `${w.name} wins ${tr.count} ${tr.type} from ${l.name}`); // amounts stay secret, as in the real game
  note(s, wi, `You win the ${tr.type}! You gave ${l.name} ${sum(cw)} and got ${sum(cl)} back.`, cl, cw);
  note(s, li, `${w.name} wins the ${tr.type}. You got ${sum(cw)} from ${w.name} and gave ${sum(cl)}.`, cw, cl);
  advance(s);
}

export function apply(s, pi, x, now = Date.now()) {
  tick(s, now);
  act(s, pi, x, now);
  restartClock(s, now); // every successful move hands the decision (and a fresh clock) to the next player
  return s;
}
function act(s, pi, x, now) {
  const P = s.players, me = P[pi], t = x.type, au = s.auction, tr = s.trade;
  if (t === 'start') {
    need(s.phase === 'lobby' && pi === 0, 'Only the host can start from the lobby');
    need(P.length >= 3, 'Need at least 3 players');
    s.deck = shuffle(Object.keys(ANIMALS).flatMap(k => [k, k, k, k]));
    P.forEach(p => { p.money = [0, 0, 10, 10, 10, 10, 50]; });
    s.turn = Math.floor(Math.random() * P.length); s.phase = 'turn'; say(s, 'Game started');
    return s;
  }
  if (t === 'end') {
    need(pi === 0, 'Host only'); need(s.phase !== 'lobby' && s.phase !== 'over', 'The game is not running');
    s.auction = s.trade = null; s.phase = 'over'; say(s, 'The host ended the game'); return s;
  }
  if (t === 'leave') { // give up your seat before the game starts (the next player becomes host)
    need(s.phase === 'lobby', 'You can only leave your seat in the lobby');
    say(s, `${P.splice(pi, 1)[0].name} left the table`); return s;
  }

  if (s.phase === 'turn') {
    need(pi === s.turn, 'Not your turn');
    if (t === 'auction') {
      need(s.deck.length, 'The deck is empty');
      const type = s.deck.pop();
      if (type === 'donkey') {
        const amt = DONKEY_PAY[s.donkeys++]; P.forEach((p, i) => { p.money.push(amt); note(s, i, `Donkey! Everyone receives ${amt}.`, [amt]); });
        say(s, `Donkey! Everyone receives ${amt}`);
      }
      s.auction = { type, auctioneer:pi, high:null, stage:'bidding', deadline:now + BID_MS }; s.phase = 'auction';
      say(s, `${me.name} auctions a ${type}`);
      return s;
    }
    if (t === 'challenge') {
      const o = Number.isInteger(x.target) ? P[x.target] : null;
      need(o && targets(s, pi).some(c => c.p === x.target && c.type === x.animal), 'You cannot challenge for that');
      s.trade = { a:pi, b:x.target, type:x.animal, count:Math.min(me.animals[x.animal], o.animals[x.animal]), bids:{} };
      s.phase = 'trade'; say(s, `${me.name} challenges ${o.name} for ${x.animal}`);
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
        au.high = { p:pi, amt }; au.deadline = now + BID_MS;
        return s;
      }
      if (t === 'extend') { // +5s for the auctioneer, but never more than 20s left on the clock
        need(pi === au.auctioneer, 'Auctioneer only');
        au.deadline = Math.min(Math.max(au.deadline, now) + EXTEND_MS, now + BID_MS); return s;
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
      say(s, `${pr.name} gets the ${au.type} for ${au.high.amt}`);
      note(s, au.payer, `You paid ${pe.name} ${sum(x.cards)} for the ${au.type}.`, [], x.cards);
      note(s, au.payee, `${pr.name} paid you ${sum(x.cards)} for the ${au.type}.`, x.cards);
      advance(s);
      return s;
    }
  } else if (s.phase === 'trade' && (t === 'tradebid' || t === 'accept')) {
    // The challenger offers first (face down); then the defender sees how many cards were offered and either counters or accepts.
    need(pi === tr.a || pi === tr.b, 'You are not in this trade');
    need(!(pi in tr.bids), 'You already bid');
    need(pi === tr.a || tr.a in tr.bids, 'Wait for the challenger to make an offer first');
    if (t === 'accept') {
      need(pi === tr.b, 'Only the defender can accept');
      const A = P[tr.a], ca = tr.bids[tr.a];
      A.money = take(A.money, ca); me.money = me.money.concat(ca);
      A.animals[tr.type] += tr.count; me.animals[tr.type] -= tr.count;
      say(s, `${me.name} accepts ${A.name}'s offer and hands over ${tr.count} ${tr.type}`);
      note(s, pi, `You accepted ${A.name}'s offer and got ${sum(ca)}.`, ca);
      note(s, tr.a, `${me.name} accepted your offer: you get the ${tr.type} for ${sum(ca)}.`, [], ca);
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
    now:Date.now(), name:s.name, public:s.public, phase:s.phase, timeout:s.timeout || 60, due:s.due || null, waiting:waiting(s), me:pi, turn:s.turn, deck:s.deck.length, donkeys:s.donkeys, auction:s.auction,
    showLog:s.showLog !== false, log:s.log.slice(0, s.showLog === false ? 1 : 8), // log off: only "what just happened", no history
    trade:tr && { a:tr.a, b:tr.b, type:tr.type, count:tr.count, submitted:Object.keys(tr.bids).map(Number), offer:tr.a in tr.bids ? tr.bids[tr.a].length : null, ties:tr.ties || 0 },
    note:pi >= 0 && s.notes?.[pi] || null,
    players:s.players.map((p, i) => ({ name:p.name, animals:p.animals, cards:p.money.length, money:i === pi ? [...p.money].sort((a, b) => a - b) : null, ...(s.phase === 'over' ? score(p) : {}) })),
    targets:s.phase === 'turn' && pi === s.turn ? targets(s, pi) : [],
  };
}