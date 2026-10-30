// Rebuild a logged game (games/<room>-<game>.json) move by move on the real engine and show what every bot thought
// at each decision: its auction limit and opening bid, buy-back choice, turn choice, koehandel offer and counter.
// node agent/scripts/explain.mjs <file.json> [event numbers to explain in depth, e.g. 3,5]   (EXTRA='{...}': other Insane settings;
// MONEY=150: after every event, each bot's money estimates that are off by more than 150, with the estimate's sd)
// The bots' own random numbers depend on a move counter the log does not keep, so a decision that uses chance
// (koehandel offers) can come out a little differently here; auction limits are exact (they only use the seed).
import fs from 'node:fs';
import { newGame, newPlayer, apply, tick } from '../../lib/engine.js';
import { TYPES, sum } from '../../lib/rules.js';
import { botRand, botMove, INSANE, LEVELS } from '../../lib/bots/index.js';
import { DEFAULTS } from '../../lib/bots/brain.js';
import { look, mkModel, bidPlan, buyBack, auctionValue, koehandelOptions, plainLimit, asSeenBy, forDeck, styleOf, keenness } from '../../lib/bots/expert.js';
import { people } from '../../lib/bots/tracker.js';

const [file, deep = ''] = process.argv.slice(2);
// EXTRA='{"mDecP":1}': try other Insane settings (what-if; the logged moves are replayed regardless)
if (process.env.EXTRA) Object.assign(INSANE, JSON.parse(process.env.EXTRA));
const L = JSON.parse(fs.readFileSync(file, 'utf8')), DEEP = new Set(deep.split(',').filter(Boolean).map(Number));
const s = newGame({ name: L.name, deckSize: L.deckSize });
L.players.forEach((p, j) => { const q = newPlayer(p.name, p.bot ? null : 't' + j); if (p.bot) q.bot = p.bot; s.players.push(q); });
let now = 1000;
const quiet = () => { s.botAt = null; s.due = null; };
apply(s, s.players.findIndex(p => !p.bot), { type: 'start' }, now++);
const order = L.hist.filter(e => e.t === 'a').map(e => e.k);
s.deck = order.slice().reverse(); s.turn = L.hist.find(e => e.t === 'a').A; s.seed = L.seed; s.log = []; quiet();
const N = j => s.players[j].name, U = x => (100 * x).toFixed(1) + '%';
// the settings a bot plays with at its seat (as expertAgent's seat())
const thOf = j => {
  const spec = LEVELS[s.players[j].bot].spec, th1 = forDeck({ ...DEFAULTS, ...spec.th }, s.deckSize || 40), y = styleOf(s, j, th1.style || 0);
  return y ? { ...th1, shade: (th1.shade ?? 1) * y.keen, mDec: (th1.mDec || 0) + y.mDec } : th1;
};
const money = () => s.players.map((p, j) => `${N(j)} ${sum(p.money)}`).join(', ');
const herds = () => s.players.map((p, j) => `${N(j)}: ${TYPES.filter(t => p.animals[t]).map(t => t + p.animals[t]).join(' ')}`).join(' | ');
const rnd = (j, salt) => botRand(s, j, salt);

// each bot's money estimates of the others that are off by more than MONEY (estimate - real, in sds)
const moneyOff = () => {
  if (!process.env.MONEY) return;
  const out = [];
  s.players.forEach((p, j) => { if (!p.bot) return; const th = thOf(j), o = look(s, j, th);
    const ol = look(s, j, { ...th, track: 0 }), sg = d => (d > 0 ? '+' : '') + Math.round(d);
    s.players.forEach((q, x) => { const d = o.money[x] - sum(q.money); if (x !== j && Math.abs(d) > +process.env.MONEY) out.push(`${N(j)}->${N(x)} ${sg(d)} (sd ${Math.round(o.sd[x])}; without the tracker ${sg(ol.money[x] - sum(q.money))}, sd ${Math.round(ol.sdS[x])})`); }); });
  if (out.length) console.log('   money estimates off: ' + out.join(', '));
};
let ev = 0;
for (const e of L.hist) {
  if (e.t === 'm' || e.t === 'x') continue;
  ev++;
  const deepNow = DEEP.has(ev);
  if (e.t === 'a') {
    const A = e.A, k = TYPES.indexOf(e.k);
    if (s.turn !== A || s.phase !== 'turn') throw new Error(`event ${ev}: expected ${N(A)}'s turn`);
    let turnNote = '';
    if (deepNow && s.players[A].bot) {
      const th = thOf(A), o = look(s, A, th), M = mkModel(o, th);
      console.log(`   ${N(A)}'s turn (before the bias): now ${U(M.util(A, [], []))}, auction ${U(auctionValue(o, th))}; koehandels: ` +
        koehandelOptions(o, th, M, rnd(A, 'x')).map(t => `${N(t.p)} ${TYPES[t.k]}x${t.count} ${U(t.ev)}`).join(', ') + `; hand [${o.hand}]`);
    }
    if (s.players[A].bot) { const m = botMove(s, A, 'turn', rnd(A, 'x')); if (m.type !== 'auction') turnNote = `  [bot here would rather ${m.type} ${m.target != null ? N(m.target) + ' ' + m.animal : ''}]`; }
    apply(s, A, { type: 'auction' }, now++); quiet();
    const a = s.auction, caps = { ...a.caps }, opens = { ...a.opens };
    console.log(`\n#${ev} deck ${s.deck.length} | ${N(A)} auctions ${e.k}${turnNote}   money: ${money()}`);
    const bids = Object.entries(e.mx).map(([j, b]) => `${N(+j)} ${b}`).join(', ') || 'none';
    console.log(`   bids: ${bids} -> ${e.w == null ? 'nobody' : e.buy ? `${N(A)} buys back for ${e.p}` : `${N(e.w)} gets it for ${e.p}`}`);
    for (const j in caps) console.log(`   ${N(+j)}: limit ${caps[j]}${opens[j] ? `, opens at ${opens[j]}` : ''}   (predicted by everyone: ${a.pred[j]}, log said ${e.pred[j]})`);
    if (deepNow) for (const js in caps) {
      const j = +js, th = thOf(j), o = look(s, j, th), M = mkModel(o, th), base = M.util(j, [], []);
      if (th.adapt) o.keen = keenness(o, th.adapt);
      console.log(`   -- ${N(j)} hand [${o.hand}]`);
      console.log(`   -- ${N(j)} in depth: estimates money ${o.money.map((m, x) => N(x) + ' ' + m).join(', ')}; win chance now ${U(base)}`);
      console.log(`      if ${N(A)} keeps it free ${U(M.util(j, [[A, k, 1]], []))}`);
      for (const q of [10, 30, 50, 60, 80, 100, 150, 200, 300].filter(q => q <= o.money[j])) {
        const others = o.active.filter(x => x !== j && x !== A).map(x => `${N(x)} gets it ${U(M.util(j, [[x, k, 1]], [[x, -q], [A, q]]))}`).join(', ');
        console.log(`      at ${q}: I get it ${U(M.util(j, [[j, k, 1]], [[j, -q], [A, q]]))}, ${N(A)} buys back ${U(M.util(j, [[A, k, 1]], [[A, -q], [j, q]]))}; ${others}`);
      }
      for (const x of o.active) if (x !== j && x !== A) { const ox = asSeenBy(o, x); console.log(`      predicted plain limit of ${N(x)}: ${plainLimit(ox, th, mkModel(ox, th))}`); }
      console.log(`      own plain limit ${plainLimit(o, th, M)}, plan ${JSON.stringify(bidPlan(o, th, M))}`);
    }
    a.caps = {};
    for (const [j, b] of Object.entries(e.mx).sort((x, y) => x[1] - y[1])) { apply(s, +j, { type: 'bid', amount: b }, now++); quiet(); }
    tick(s, (now = a.deadline + 1)); quiet(); now++;
    if (s.phase === 'auction' && s.auction.stage === 'decide') {
      if (s.players[A].bot) {
        const th = thOf(A), o = look(s, A, th), M = mkModel(o, th), w = s.auction.high.p, p = s.auction.high.amt;
        const bb = buyBack(o, th, M);
        if (deepNow) for (const q of [10, 30, 50, 60, 80, 100, 150, 200]) console.log(`      ${N(A)} at ${q}: buy back ${U(M.util(A, [[A, k, 1]], [[A, -q], [w, q]]))}, sell ${U(M.util(A, [[w, k, 1]], [[w, -q], [A, q]]))}; free for me ${U(M.util(A, [[A, k, 1]], []))}`);
        console.log(`   ${N(A)} decides: buy back ${bb ? 'YES' : 'no'}  (buy back at ${p}: ${U(M.util(A, [[A, k, 1]], [[A, -p], [w, p]]))}, sell: ${U(M.util(A, [[w, k, 1]], [[w, -p], [A, p]]))}, needs a margin of ${(100 * th.mDec).toFixed(1)}%; logged: ${e.buy ? 'bought' : 'sold'})`);
      }
      apply(s, A, { type: e.buy ? 'buy' : 'sell' }, now++); quiet();
    }
    if (s.phase === 'auction' && s.auction.stage === 'pay') { apply(s, s.auction.payer, { type: 'pay', cards: e.cs }, now++); quiet(); }
    moneyOff();
    continue;
  }
  if (e.t === 'k') {
    const a = e.a, b = e.b, k = TYPES.indexOf(e.k);
    if (s.turn !== a || s.phase !== 'turn') throw new Error(`event ${ev}: expected ${N(a)}'s turn`);
    console.log(`\n#${ev} deck ${s.deck.length} | ${N(a)} koehandel vs ${N(b)} for ${e.c} ${e.k}   money: ${money()}`);
    console.log(`   herds: ${herds()}`);
    if (s.players[a].bot) {
      const th = thOf(a), o = look(s, a, th), M = mkModel(o, th), y = styleOf(s, a, th.style || 0), ppl = people(s);
      const bias = 1 + (y ? y.kh : 0) + (th.khBias || 0), opts = koehandelOptions(o, th, M, rnd(a, 'x'));
      const av = o.deckLeft ? auctionValue(o, th) : null;
      console.log(`   ${N(a)}'s turn: now ${U(M.util(a, [], []))}${av != null ? `, auction ${U(av)}` : ''}; koehandels: ` +
        opts.map(t => `${N(t.p)} ${TYPES[t.k]}x${t.count} ${U(t.ev)}${ppl[t.p] ? '(person, bias ' + (bias - (th.khBias || 0) + th.khBiasP).toFixed(2) + ')' : '(bias ' + bias.toFixed(2) + ')'}`).join(', '));
    }
    apply(s, a, { type: 'koehandel', target: b, animal: e.k }, now++); quiet();
    if (s.players[a].bot) { const m = botMove(s, a, 'offer', rnd(a, 'x')); console.log(`   ${N(a)} would offer ${sum(m.cards)} [${m.cards}] (logged ${e.x} [${e.ca}])`); }
    console.log(`   ${N(a)} offers ${e.x} in ${e.na} cards; ${N(b)} has ${sum(s.players[b].money)}`);
    apply(s, a, { type: 'tradebid', cards: e.ca }, now++); quiet();
    if (s.players[b].bot) {
      const th = thOf(b), o = look(s, b, th);
      const m = botMove(s, b, 'respond', rnd(b, 'x'));
      console.log(`   ${N(b)} estimates ${N(a)}'s money ${o.money[a]} (really ${sum(s.players[a].money)}); would ${m.type === 'accept' ? 'accept' : 'counter ' + sum(m.cards)} (logged ${e.nb == null ? 'accept' : e.y})`);
    }
    if (e.nb == null) apply(s, b, { type: 'accept' }, now++);
    else apply(s, b, { type: 'tradebid', cards: e.cb }, now++);
    quiet();
    console.log(`   -> ${e.nb == null ? 'accepted' : `${N(b)} counters ${e.y}: ${N(e.win)} wins`}`);
    moneyOff();
  }
}
console.log('\nfinal ' + herds());
