// A logged game replayed move by move on the engine, asking a bot at every point where a bot seat decided what it
// would do now (and, with WHY=1, how its options compare): node agent/scripts/rebuild.mjs <games/file.json> [bot spec]
// The bot seats keep their seat, the table's seed (so their personality) and the full history, as they had live.
// WHY=1: the values behind turn choices and buy-backs (and, after a sale, what a koehandel for that animal would be
// worth), and what attackers believed about the defender's money. AUC=<n>: how the bidders valued the n-th auction
// (from 0). OFFER=<animal>: the value of every offer the attacker considered in koehandels for that animal.
// COUNTER=<animal>: what a defending bot believed the offer was in koehandels for that animal, and its answers.
// SNAP=<n> and a third argument: save the table at the n-th auction's buy-back decision to that file.
import fs from 'node:fs';
import { newGame, newPlayer, apply, tick } from '../../lib/engine.js';
import { START_MONEY, sum } from '../../lib/rules.js';
import { rng } from '../../lib/bots/sim.js';
import { sums } from '../../lib/bots/brain.js';
import { look, mkModel, forDeck, bidPlan, auctionValue, koehandelOptions } from '../../lib/bots/expert.js';
import { LEVELS } from '../../lib/bots/index.js';
import { agentFor } from './registry.mjs';
import { TRACKER } from '../../lib/bots/tracker.js';
// TRK=FLOOR=0.2,TILT=1: the card tracker's settings for this replay (lib/bots/tracker.js)
for (const kv of (process.env.TRK || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); TRACKER[k] = k === 'choices' ? v === '1' : +v; }

const [file, spec] = process.argv.slice(2), WHY = !!process.env.WHY;
const raw = fs.readFileSync(file, 'utf8'), L = JSON.parse(raw.slice(raw[0] === '{' ? 0 : raw.indexOf('|') + 1));
const N = L.players.length, nm = j => L.players[j].name, isBot = j => !!L.players[j].bot;
const agent = j => agentFor(spec || L.players[j].bot), thOf = j => forDeck((LEVELS[L.players[j].bot] || LEVELS.insane).spec.th, L.deckSize || 40);
const s = newGame({ deckSize: L.deckSize, timeout: L.timeout });
for (const p of L.players) s.players.push(newPlayer(p.name, 't' + p.name));
s.people = L.players.map(p => !p.bot); // for the card trackers (the seats here are not marked as bots)
apply(s, 0, { type: 'start' }, 1);
const aucs = L.hist.filter(e => e.t === 'a').map(e => e.k);
s.counts = L.counts; s.deck = aucs.slice().reverse(); s.seed = L.seed; s.turn = L.hist.find(e => e.t === 'a').A;
s.players.forEach(p => { p.money = [...START_MONEY]; for (const t in p.animals) p.animals[t] = 0; });
let clock = 10;
// no move ever times out here (the log has every move), except a turn someone let run out (not in the history):
// skipTo times out turns until it is that player's
const go = (j, x, t) => { s.due = null; s.botAt = null; apply(s, j, x, t); if (process.env.TRACK === 'all') traceAll(); else if (process.env.TRACK) traceTrack(); };
const skipTo = j => { for (let g = 0; g < N && s.phase !== 'over' && s.turn !== j; g++) { console.log(`  (${nm(s.turn)} let the turn run out)`); s.botAt = null; s.due = ++clock; tick(s, ++clock); } };
// TRACK=<viewer>,<target> (names): after every move, whether the viewer's card tracker still has the target's real
// hand among its guesses, and what it believes (printed when it changes). TRACK=all: every bot on every person,
// summed up at the end (moves where the real hand was among the guesses, mean error).
let lastTrack = '';
const tsum = { moves: 0, has: 0, err: 0, lost: 0 };
function traceAll() {
  if (!s.hist || s.phase === 'over') return;
  L.players.forEach((_, v) => {
    if (!isBot(v)) return;
    const o = look(s, v, thOf(v));
    L.players.forEach((__, t) => {
      if (t === v || isBot(t)) return;
      tsum.moves++;
      if (!o.track) { tsum.lost++; return; }
      const key = h => h.slice().sort((x, y) => x - y).join(','), real = key(s.players[t].money), hs = o.track.hands(t, 60, rng(1));
      if (hs.some(h => key(h.hand) === real)) tsum.has++;
      tsum.err += Math.abs(o.track.mean[t] - sum(s.players[t].money));
    });
  });
}
function traceTrack() {
  const [v, t] = process.env.TRACK.split(',').map(x => L.players.findIndex(p => p.name === x));
  if (!s.hist || s.phase === 'over' || !isBot(v)) return;
  const o = look(s, v, thOf(v)); if (!o.track) return;
  const key = h => h.slice().sort((x, y) => x - y).join(','), real = key(s.players[t].money), hs = o.track.hands(t, 60, rng(1));
  const has = hs.filter(h => key(h.hand) === real).length, line = `  [track ${nm(v)} on ${nm(t)}: real ${sum(s.players[t].money)} [${real}], tracker mean ${o.track.mean[t].toFixed(0)} sd ${o.track.sd[t].toFixed(0)}, real hand in ${has}/60 draws]`;
  if (line !== lastTrack) { console.log(line + `  after ${s.hist.length ? JSON.stringify(s.hist[s.hist.length - 1]).slice(0, 90) : '-'}`); lastTrack = line; }
}
const r = () => rng(clock * 7 + 3);
const money = () => s.players.map((p, j) => `${nm(j)} ${sum(p.money)}`).join(', ');
const hand = j => `[${[...s.players[j].money].sort((a, b) => a - b).join(',')}]`;
const herd = j => Object.entries(s.players[j].animals).filter(([, c]) => c).map(([t, c]) => `${t}${c}`).join(' ');
const turnLine = j => {
  const A = agent(j), mv = A.act(s, j, 'turn', r());
  let why = '';
  if (WHY) {
    const th = thOf(j), o = look(s, j, th), M = mkModel(o, th), u0 = M.util(j, [], []);
    const opts = koehandelOptions(o, th, M, r()).map(t => `kh ${nm(t.p)} ${['horse', 'cow', 'pig', 'mule', 'goat', 'sheep', 'dog', 'cat', 'duck', 'chicken'][t.k]} ${(t.ev / u0).toFixed(3)}`);
    why = `   [auction ${o.deckLeft ? (auctionValue(o, th) / u0).toFixed(3) : '-'}; ${opts.join('; ')}] (relative to now)`;
  }
  return `${mv.type === 'auction' ? 'auction' : `koehandel vs ${nm(mv.target)} for ${mv.animal}`}${why}`;
};
for (const e of L.hist) {
  clock += 100000;
  if (e.t === 'm') continue; // the mule's payout happens when it is auctioned
  if (e.t === 'a') {
    const A = e.A;
    console.log(`\n${money()}   | ${s.players.map((_, j) => `${nm(j)}: ${herd(j)}`).join(' | ')}`);
    if (isBot(A)) console.log(`  ${nm(A)}'s turn: did auction, would now: ${turnLine(A)}`);
    skipTo(A); go(A, { type: 'auction' }, clock);
    const a = s.auction; a.caps = {}; a.opens = {};
    const bots = s.players.map((_, j) => j).filter(j => j !== A && isBot(j));
    if (process.env.AUC && L.hist.filter(x => x.t === 'a').indexOf(e) === +process.env.AUC) for (const j of bots) {
      const th = thOf(j), o = look(s, j, th), M = mkModel(o, th), k = o.auction.k, rv = o.active.filter(x => x !== j && x !== A);
      console.log(`  ${nm(j)} sees money ${o.money.map(Math.round).join('/')}, mu ${M.mu.toFixed(0)}, delta ${M.delta.toFixed(2)}; utils (relative to A keeping it free):`);
      const u0 = M.util(j, [[A, k, 1]], []);
      for (const q of [10, 20, 30, 50, 80, 120]) console.log(`    q=${q}: I win+sold ${(M.util(j, [[j, k, 1]], [[j, -q], [A, q]]) / u0).toFixed(3)}  I win+bought back ${(M.util(j, [[A, k, 1]], [[A, -q], [j, q]]) / u0).toFixed(3)}  ` + rv.map(w => `${nm(w)} wins+sold ${(M.util(j, [[w, k, 1]], [[w, -q], [A, q]]) / u0).toFixed(3)}`).join(' '));
    }
    const plan = bots.map(j => { const b = agent(j).bid(s, j, r()); return `${nm(j)} cap ${b.cap}${b.open ? ' open ' + b.open : ''}`; });
    console.log(`${nm(A)} auctions ${e.k}${e.k === 'mule' ? '' : ''}: bids ${Object.entries(e.mx || {}).map(([j, b]) => `${nm(j)} ${b}`).join(', ') || '-'}   | now: ${plan.join(', ') || '-'}`);
    const bids = Object.entries(e.mx || {}).map(([j, b]) => [+j, b]).sort((x, y) => x[1] - y[1]);
    for (const [j, b] of bids) go(j, { type: 'bid', amount: b }, ++clock);
    clock = a.deadline + 1; s.due = null; tick(s, clock);
    if (a.stage === 'decide') {
      let now = '';
      if (isBot(A)) {
        const d = agent(A).act(s, A, 'decide', r());
        now = ` | ${nm(A)} would now: ${d.type}`;
        if (WHY) {
          const th = thOf(A), o = look(s, A, th), M = mkModel(o, th), k = o.auction.k, b = a.high.p, p = a.high.amt;
          now += ` (keep ${M.util(A, [[A, k, 1]], [[A, -p], [b, p]]).toFixed(4)} vs sell ${M.util(A, [[b, k, 1]], [[b, -p], [A, p]]).toFixed(4)}, mDec ${th.mDec.toFixed(3)})`;
          // and if sold: what a koehandel against the buyer for this type would be worth to me right after
          const c = structuredClone(s); c.due = null; apply(c, A, { type: 'sell' }, clock + 1); c.due = null;
          apply(c, b, { type: 'pay', cards: e.cs || [] }, clock + 2);
          const oc = look(c, A, th), Mc = mkModel(oc, th), kh = koehandelOptions(oc, th, Mc, r()).find(t => t.p === b && t.k === k);
          if (kh) now += ` [after the sale: koehandel for it worth ${kh.ev.toFixed(4)}]`;
        }
      }
      console.log(`  ${nm(A)} ${e.buy ? 'bought back' : 'sold'} at ${e.p} to ${nm(a.high.p)}${now}`);
      // SNAP=<n> <file>: save the table as it was at the n-th auction's buy-back decision (for tests)
      if (process.env.SNAP && L.hist.filter(x => x.t === 'a').indexOf(e) === +process.env.SNAP) fs.writeFileSync(process.argv[4], JSON.stringify(s));
      go(A, { type: e.buy ? 'buy' : 'sell' }, ++clock);
      go(s.auction.payer, { type: 'pay', cards: e.cs }, ++clock);
    }
    continue;
  }
  if (e.t === 'k') {
    console.log(`\n${money()}   | ${s.players.map((_, j) => `${nm(j)}: ${herd(j)}`).join(' | ')}`);
    if (isBot(e.a)) console.log(`  ${nm(e.a)}'s turn: did koehandel vs ${nm(e.b)} for ${e.k}, would now: ${turnLine(e.a)}`);
    skipTo(e.a); go(e.a, { type: 'koehandel', target: e.b, animal: e.k }, ++clock);
    const off = isBot(e.a) ? ` | would now offer ${sum(agent(e.a).act(s, e.a, 'offer', r()).cards)}` + (WHY ? (() => { const o = look(s, e.a, thOf(e.a)); return ` (thinks ${nm(e.b)} has ${Math.round(o.money[e.b])} ±${Math.round(o.sdS ? o.sdS[e.b] : o.sd[e.b])} in ${o.cards[e.b]} cards)`; })() : '') : '';
    console.log(`${nm(e.a)} koehandel vs ${nm(e.b)} (${hand(e.b)}) for ${e.c} ${e.k}: offered ${e.x} in ${e.na} ${hand(e.a)}${off}`);
    if (process.env.OFFER && e.k === process.env.OFFER && isBot(e.a)) {
      globalThis.DBG_OFFER = (acts, vals, mx) => { const b = Math.max(...vals); console.log('  offers (amount/cards: value relative to best, mix):', acts.map(([x, n], i) => `${x * 10}/${n}: ${(vals[i] / b).toFixed(4)}${mx[i] > 0.01 ? ' mix ' + mx[i].toFixed(2) : ''}`).filter((_, i) => vals[i] / b > 0.97).join('  ')); };
      agent(e.a).act(s, e.a, 'offer', r()); delete globalThis.DBG_OFFER;
      { const th = thOf(e.a), o = look(s, e.a, th), M0 = mkModel(o, { ...th, own: 0 }), M1 = mkModel(o, { ...th, own: 1 }), k = o.trade.k;
        for (const x of [0, 110, 160, 250]) { const dh = [[e.a, k, e.c], [e.b, k, -e.c]], dm = [[e.a, -x], [e.b, x]], w = M0.util(e.a, dh, dm); console.log(`    pay ${x}: win chance ${w.toExponential(3)}, share of expected scores ${(M1.util(e.a, dh, dm) - w).toFixed(4)}`); } }
      const o = look(s, e.a, thOf(e.a)), hs = o.track ? o.track.hands(e.b, 40, r()) : [], cnt = {};
      for (const h of hs) { const k = `[${h.hand.slice().sort((x, y) => x - y).join(',')}]`; cnt[k] = (cnt[k] || 0) + 1; }
      console.log(`  ${nm(e.a)}'s card tracker on ${nm(e.b)}: mean ${o.track ? o.track.mean[e.b].toFixed(0) : '-'} sd ${o.track ? o.track.sd[e.b].toFixed(0) : '-'}; hands drawn:`, JSON.stringify(cnt), '| ledger sd', o.sdS && o.sdS[e.b], o.sd[e.b]);
    }
    go(e.a, { type: 'tradebid', cards: e.ca }, ++clock);
    if (process.env.COUNTER && e.k === process.env.COUNTER && isBot(e.b)) {
      globalThis.DBG_COUNTER = (g, hand, n) => {
        const post = g.posterior(n), ys = [-1, ...sums(hand).filter(v => v > 0).map(v => v / 10)], val = y => post.reduce((t, [x, p]) => t + p * g.vB(x, y), 0), b = Math.max(...ys.map(val));
        console.log(`  ${nm(e.b)} believed ${n} cards held:`, post.filter(([, p]) => p > 0.01).map(([x, p]) => `${x * 10}: ${p.toFixed(2)}`).join('  '));
        console.log('  answers (value relative to best):', ys.map(y => `${y < 0 ? 'accept' : y * 10}: ${(val(y) / b).toFixed(4)}`).join('  '));
      };
      agent(e.b).act(s, e.b, 'respond', r()); delete globalThis.DBG_COUNTER;
    }
    const resp = isBot(e.b) ? (() => { const m = agent(e.b).act(s, e.b, 'respond', r()); return ` | would now ${m.type === 'accept' ? 'accept' : 'counter ' + sum(m.cards)}`; })() : '';
    console.log(`  ${nm(e.b)} ${e.nb == null ? 'accepted' : `countered ${e.y}`}${resp}`);
    if (e.nb == null) go(e.b, { type: 'accept' }, ++clock);
    else {
      go(e.b, { type: 'tradebid', cards: e.cb }, ++clock);
      if (s.trade && s.trade.ties) { go(e.a, { type: 'tradebid', cards: e.ca }, ++clock); go(e.b, { type: 'tradebid', cards: e.cb }, ++clock); }
    }
  }
}
console.log(`\nend: ${money()}`);
if (process.env.TRACK === 'all') console.log(`trackers on people: real hand among the guesses after ${tsum.has} of ${tsum.moves} moves, mean error ${(tsum.err / Math.max(1, tsum.moves - tsum.lost)).toFixed(0)}, no tracker ${tsum.lost}`);
