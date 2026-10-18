// Pure game engine. A bot is just a player that calls apply(state, playerIndex, action).
export const ANIMALS = { horse:1000, cow:800, pig:650, mule:500, goat:350, sheep:250, dog:160, cat:90, duck:40, chicken:10 };
// Bidding: 20s when the auction opens, every bid resets the clock to 10s, the auctioneer may add 5s once (never above 20s left).
const MULE_PAY = [50, 100, 200, 500], OPEN_MS = 20000, BID_MS = 10000, EXTEND_MS = 5000, MAX_LEFT_MS = 20000;
// Seconds a player gets for every decision (turn, sell/buy, paying, koehandel offer/answer); set per table.
export const clampTimeout = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && v !== null && v !== '' ? Math.min(120, Math.max(10, n)) : 30; };
const limitMs = s => (s.timeout || 30) * 1000;
const STRIKES_TO_KICK = 2; // anyone may kick a player who let the clock run out this many times in a row
const sum = a => a.reduce((x, y) => x + y, 0);
const need = (c, m) => { if (!c) throw new Error(m); };
const say = (s, m) => { s.log.unshift(m); s.log.length = Math.min(s.log.length, 30); };
// Private message for one player about money that just changed hands (only they see it).
const note = (s, i, text, got = [], gave = []) => { s.seq = (s.seq || 0) + 1; (s.notes ||= {})[i] = { id:s.seq, text, got, gave }; };
const nm = t => (t === 'mule' ? 'money mule' : t); // how an animal is called in messages
const plural = (n, t) => (n > 1 && t !== 'sheep' ? `${n} ${nm(t)}s` : `${n > 1 ? n + ' ' : ''}${nm(t)}`);

export const newGame = (o = {}) => ({ name:o.name || 'Table', public:!!o.public, code:o.code || '', showLog:o.showLog !== false, timeout:clampTimeout(o.timeout), due:null, seq:o.seq || 0, notes:{}, phase:'lobby', players:[], deck:[], mules:0, turn:0, auction:null, trade:null, log:[] });
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
    for (const t in ANIMALS) if (me.animals[t] && o.animals[t] && me.animals[t] < 4 && o.animals[t] < 4) out.push({ p:j, type:t, count:Math.min(me.animals[t], o.animals[t]), ...(o.out ? { free:true } : {}) });
  });
  return out;
}
export const score = p => {
  const full = Object.keys(ANIMALS).filter(k => p.animals[k] === 4);
  return { sets: full.length, score: sum(full.map(k => ANIMALS[k])) * full.length };
};
const active = s => s.players.filter(p => !p.out).length;
const host = s => s.players.findIndex(p => !p.out); // the first player still in the game

function over(s, why) { s.auction = s.trade = null; s.phase = 'over'; say(s, why); }
function advance(s) {
  s.auction = s.trade = null; s.phase = 'turn';
  const P = s.players;
  if (active(s) < 2) return over(s, 'Game over: not enough players left');
  if (!s.deck.length && !P.some((_, i) => targets(s, i).length)) return over(s, 'Game over');
  do s.turn = (s.turn + 1) % P.length; // skip players who left, and (once the deck is empty) players who cannot koehandel
  while (P[s.turn].out || (!s.deck.length && !targets(s, s.turn).length));
}
function closeBidding(s) {
  const a = s.auction, au = s.players[a.auctioneer];
  if (!a.high) { au.animals[a.type]++; say(s, `No bids: ${au.name} keeps the ${nm(a.type)}`); advance(s); }
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
const restartClock = (s, now) => { s.due = waiting(s) ? now + limitMs(s) : null; };
// Cards worth at least amt with the least overpayment (then the fewest cards).
export function cheapest(hand, amt) {
  const best = new Map([[0, []]]);
  for (const c of hand) for (const [v, cs] of [...best]) { const cur = best.get(v + c); if (!cur || cur.length > cs.length + 1) best.set(v + c, [...cs, c]); }
  let pick = null;
  for (const [v, cs] of best) if (v >= amt && (!pick || v < pick[0] || (v === pick[0] && cs.length < pick[1].length))) pick = [v, cs];
  return pick ? pick[1] : [...hand];
}
function timedOut(s, now) { // a turn is skipped; inside an action the obvious choice is made
  const w = waiting(s), p = s.players[w.p];
  p.strikes = (p.strikes || 0) + 1;
  say(s, `${p.name} ran out of time${w.what === 'turn' ? ' and skips the turn' : ''}`);
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
  say(s, `${pr.name} cannot pay: ${s.players[a.auctioneer].name} keeps the ${nm(a.type)}`); advance(s);
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
    // Official rule: a second tie gives the player who started the koehandel the animals for free.
    A.animals[tr.type] += tr.count; B.animals[tr.type] -= tr.count;
    say(s, `Tie again! ${A.name} takes ${plural(tr.count, tr.type)} from ${B.name} for free`);
    note(s, tr.a, `Tie again at ${sa}: you take the ${nm(tr.type)} for free. No money changes hands.`);
    note(s, tr.b, `Tie again at ${sa}: ${A.name} takes the ${nm(tr.type)} for free. No money changes hands.`);
    advance(s); return;
  }
  const [wi, li, cw, cl] = sa > sb ? [tr.a, tr.b, ca, cb] : [tr.b, tr.a, cb, ca], w = s.players[wi], l = s.players[li];
  w.money = take(w.money, cw).concat(cl); l.money = take(l.money, cl).concat(cw); // bids are swapped
  w.animals[tr.type] += tr.count; l.animals[tr.type] -= tr.count;
  say(s, `${w.name} wins ${plural(tr.count, tr.type)} from ${l.name}`); // amounts stay secret, as in the real game
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
  K.out = true; shareOut(s, ki);
  if (active(s) < 2) return over(s, 'Game over: not enough players left');
  const a = s.auction, tr = s.trade;
  if (s.phase === 'turn' && s.turn === ki) advance(s);
  else if (s.phase === 'auction' && a.auctioneer === ki && a.stage === 'decide') sellToHighest(s); // bidding just goes on otherwise
  else if (s.phase === 'auction' && a.high && a.high.p === ki && a.stage !== 'pay') { // their bid is void: bidding starts over
    Object.assign(a, { stage:'bidding', high:null, deadline:now + BID_MS });
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
  return s;
}
function act(s, pi, x, now, forced = false) { // forced: a move made for a player who timed out or was removed
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
    need(pi === host(s), 'Host only'); need(s.phase !== 'lobby' && s.phase !== 'over', 'The game is not running');
    over(s, 'The host ended the game'); return s;
  }
  if (t === 'leave') {
    if (s.phase === 'lobby') { say(s, `${P.splice(pi, 1)[0].name} left the table`); return s; } // the next player becomes host
    need(s.phase !== 'over' && !me.out, 'You are not in this game');
    removeFromPlay(s, pi, `${me.name} left the game`, now); return s;
  }
  if (t === 'kick') {
    const k = x.target, o = Number.isInteger(k) ? P[k] : null;
    need(o && k !== pi, 'Pick a player to kick');
    if (s.phase === 'lobby') { need(pi === 0, 'Only the host can kick'); P.splice(k, 1); say(s, `${o.name} was removed from the table`); return s; }
    need(s.phase !== 'over' && !o.out && !me.out, 'Not allowed right now');
    need(pi === host(s) || (o.strikes || 0) >= STRIKES_TO_KICK, `Only the host can kick (anyone can kick a player who missed ${STRIKES_TO_KICK} moves in a row)`);
    removeFromPlay(s, k, `${o.name} was kicked by ${me.name}`, now);
    note(s, k, `${me.name} removed you from the game. Your money was shared out; you can keep watching.`); return s;
  }
  need(!me.out || forced, 'You are no longer in this game');

  if (s.phase === 'turn') {
    need(pi === s.turn, 'Not your turn');
    if (t === 'auction') {
      need(s.deck.length, 'The deck is empty');
      const type = s.deck.pop();
      if (type === 'mule') {
        const amt = MULE_PAY[s.mules++];
        P.forEach((p, i) => { if (!p.out) { p.money.push(amt); note(s, i, `Money mule! Everyone receives ${amt}.`, [amt]); } });
        say(s, `Money mule! Everyone receives ${amt}`);
      }
      s.auction = { type, auctioneer:pi, high:null, stage:'bidding', deadline:now + OPEN_MS }; s.phase = 'auction';
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
        au.high = { p:pi, amt }; au.deadline = now + BID_MS;
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
      say(s, `${pr.name} gets the ${nm(au.type)} for ${au.high.amt}`);
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
      A.money = take(A.money, ca); me.money = me.money.concat(ca);
      A.animals[tr.type] += tr.count; me.animals[tr.type] -= tr.count;
      say(s, `${me.name} accepts ${A.name}'s offer and hands over ${plural(tr.count, tr.type)}`);
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
    now:Date.now(), name:s.name, public:s.public, phase:s.phase, timeout:s.timeout || 30, due:s.due || null, waiting:waiting(s), me:pi, turn:s.turn, deck:s.deck.length, mules:s.mules, auction:s.auction,
    showLog:s.showLog !== false, log:s.log.slice(0, s.showLog === false ? 1 : 8), // log off: only "what just happened", no history
    trade:tr && { a:tr.a, b:tr.b, type:tr.type, count:tr.count, submitted:Object.keys(tr.bids).map(Number), offer:tr.a in tr.bids ? tr.bids[tr.a].length : null, ties:tr.ties || 0 },
    note:pi >= 0 && s.notes?.[pi] || null,
    players:s.players.map((p, i) => ({ name:p.name, animals:p.animals, cards:p.money.length, out:!!p.out, strikes:p.strikes || 0, money:i === pi ? [...p.money].sort((a, b) => a - b) : null, ...(s.phase === 'over' ? score(p) : {}) })),
    targets:s.phase === 'turn' && pi === s.turn ? targets(s, pi) : [],
  };
}
