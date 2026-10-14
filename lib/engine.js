// Pure game engine. A bot is just a player that calls apply(state, playerIndex, action).
export const ANIMALS = { horse:1000, cow:800, pig:650, donkey:500, sheep:400, goat:250, dog:160, cat:90, rooster:50, duck:10 };
const DONKEY_PAY = [50, 100, 200, 500], BID_MS = 10000;
const sum = a => a.reduce((x, y) => x + y, 0);
const need = (c, m) => { if (!c) throw new Error(m); };
const say = (s, m) => { s.log.unshift(m); s.log.length = Math.min(s.log.length, 30); };

export const newGame = (o = {}) => ({ name:o.name || 'Table', public:!!o.public, code:o.code || '', phase:'lobby', players:[], deck:[], donkeys:0, turn:0, auction:null, trade:null, log:[] });
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
export function tick(s, now) {
  if (s.phase === 'auction' && s.auction.stage === 'bidding' && now >= s.auction.deadline) closeBidding(s);
}
function resolveTrade(s) {
  const tr = s.trade, A = s.players[tr.a], B = s.players[tr.b], ca = tr.bids[tr.a], cb = tr.bids[tr.b], sa = sum(ca), sb = sum(cb);
  if (sa === sb) { tr.bids = {}; say(s, `Tie at ${sa}! ${A.name} and ${B.name} bid again`); return; }
  const [w, l, cw, cl, sw, sl] = sa > sb ? [A, B, ca, cb, sa, sb] : [B, A, cb, ca, sb, sa];
  w.money = take(w.money, cw).concat(cl); l.money = take(l.money, cl).concat(cw); // bids are swapped
  w.animals[tr.type] += tr.count; l.animals[tr.type] -= tr.count;
  say(s, `${w.name} wins ${tr.count} ${tr.type} from ${l.name} (${sw} vs ${sl})`);
  advance(s);
}

export function apply(s, pi, x, now = Date.now()) {
  tick(s, now);
  const P = s.players, me = P[pi], t = x.type, au = s.auction, tr = s.trade;
  if (t === 'start') {
    need(s.phase === 'lobby' && pi === 0, 'Only the host can start from the lobby');
    need(P.length >= 3, 'Need at least 3 players');
    s.deck = shuffle(Object.keys(ANIMALS).flatMap(k => [k, k, k, k]));
    P.forEach(p => { p.money = [0, 0, 10, 10, 10, 10, 50]; });
    s.turn = Math.floor(Math.random() * P.length); s.phase = 'turn'; say(s, 'Game started');
    return s;
  }
  if (t === 'end') { need(pi === 0, 'Host only'); s.phase = 'over'; return s; }

  if (s.phase === 'turn') {
    need(pi === s.turn, 'Not your turn');
    if (t === 'auction') {
      need(s.deck.length, 'The deck is empty');
      const type = s.deck.pop();
      if (type === 'donkey') { const amt = DONKEY_PAY[s.donkeys++]; P.forEach(p => p.money.push(amt)); say(s, `Donkey! Everyone receives ${amt}`); }
      s.auction = { type, auctioneer:pi, high:null, stage:'bidding', deadline:now + BID_MS }; s.phase = 'auction';
      say(s, `${me.name} auctions a ${type}`);
      return s;
    }
    if (t === 'challenge') {
      const o = P[x.target];
      need(o && targets(s, pi).some(c => c.p === x.target && c.type === x.animal), 'You cannot challenge for that');
      s.trade = { a:pi, b:x.target, type:x.animal, count:Math.min(me.animals[x.animal], o.animals[x.animal]), bids:{} };
      s.phase = 'trade'; say(s, `${me.name} challenges ${o.name} for ${x.animal}`);
      return s;
    }
  } else if (s.phase === 'auction') {
    if (au.stage === 'bidding') {
      if (t === 'bid') {
        need(pi !== au.auctioneer, 'The auctioneer cannot bid');
        const amt = Number(x.amount);
        need(Number.isInteger(amt) && amt % 10 === 0 && amt > (au.high ? au.high.amt : 0), 'Bid higher than the current bid, in multiples of 10');
        need(amt <= sum(me.money), 'You do not have that much money');
        au.high = { p:pi, amt }; au.deadline = now + BID_MS;
        return s;
      }
      if (t === 'extend') { need(pi === au.auctioneer, 'Auctioneer only'); au.deadline = Math.max(au.deadline, now) + BID_MS; return s; }
      if (t === 'close') { need(pi === au.auctioneer, 'Auctioneer only'); closeBidding(s); return s; }
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
      advance(s);
      return s;
    }
  } else if (s.phase === 'trade' && t === 'tradebid') {
    need(pi === tr.a || pi === tr.b, 'You are not in this trade');
    need(!(pi in tr.bids), 'You already bid');
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
    now:Date.now(), name:s.name, public:s.public, phase:s.phase, me:pi, turn:s.turn, deck:s.deck.length, donkeys:s.donkeys, log:s.log.slice(0, 8), auction:s.auction,
    trade:tr && { a:tr.a, b:tr.b, type:tr.type, count:tr.count, submitted:Object.keys(tr.bids).map(Number) },
    players:s.players.map((p, i) => ({ name:p.name, animals:p.animals, cards:p.money.length, money:i === pi ? [...p.money].sort((a, b) => a - b) : null, ...(s.phase === 'over' ? score(p) : {}) })),
    targets:s.phase === 'turn' && pi === s.turn ? targets(s, pi) : [],
  };
}