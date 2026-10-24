// Second-generation judgement. The position model is the brain's (lib/bots/brain.js); what is new is how the
// decisions use it: every decision predicts what the other players will do (their bid limits, whether the
// auctioneer buys back, what a koehandel opponent offers or counters) from their point of view, and picks the move
// that is best against those predictions. See agent/README.md.
import { observe, Model, NT, targetsOf, repeats, sums } from './brain.js';
import { TYPES, MULE_PAY, sum, cheapest } from '../rules.js';
import { solve, cardsFor } from './solver.js';
import { track, people } from './tracker.js';
// The position model (brain.js); experiments can swap in another one through th.makeModel (agent/scripts/net.mjs).
export const mkModel = (o, th) => (th.makeModel ? th.makeModel(o, th) : new Model(o, th));

const tens = x => Math.max(0, Math.floor(x / 10) * 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const shuffle = (a, rand) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------------------------------------------------------------------------------------------------------------
// What player i sees, plus: the money cards it cannot see (everyone else's, as one pile: the multiset of all cards
// in the game is public), money estimates kept inside what the visible card counts allow, and what each other
// player can estimate about i (the public ledger and their own deals with i).
export function look(s, i, th = null) {
  const o = observe(s, i), P = s.players;
  const unseen = []; P.forEach((p, j) => { if (j !== i) unseen.push(...p.money); });
  unseen.sort((a, b) => a - b);
  o.unseen = unseen;
  // Money estimates: the ledger (exact as long as j only did public things or deals with me) combined with what
  // j's number of cards suggests, weighted by how reliable each is; then made to add up to the known total.
  const others = o.active.filter(j => j !== i && o.cards[j]);
  const tot = sum(unseen), avg = unseen.length ? tot / unseen.length : 0;
  let v2 = 0; for (const c of unseen) v2 += (c - avg) ** 2;
  const cardVar = unseen.length ? v2 / unseen.length : 0, est = [], vr = [];
  for (const j of others) {
    const c = o.cards[j], vl = 25 + (s.unc ? s.unc[i][j] : 0), vc = c * cardVar + 25;
    est.push((o.money[j] / vl + c * avg / vc) / (1 / vl + 1 / vc)); vr.push(1 / (1 / vl + 1 / vc));
  }
  // bounds: what j's cards can add up to, and at least what j bid since j's last koehandel (adjusted by the public
  // changes since: prices, mule money); then the gap to the known total is shared out by uncertainty, within bounds
  const floors = s.ledger ? bidFloors(o.hist, s.ledger) : null;
  const LO = [], HI = [];
  others.forEach((j, x) => {
    let lo = 0, hi = 0; for (let y = 0; y < o.cards[j] && y < unseen.length; y++) { lo += unseen[y]; hi += unseen[unseen.length - 1 - y]; }
    if (floors && floors[j] > lo) lo = Math.min(hi, floors[j]);
    LO.push(lo); HI.push(hi);
  });
  for (let j = 0; j < o.n; j++) if (j !== i) o.money[j] = 0;
  let cur = est.map((e, x) => clamp(e, LO[x], HI[x]));
  for (let pass = 0; pass < 4; pass++) {
    const gap = tot - cur.reduce((a, b) => a + b, 0), free = others.map((j, x) => (gap > 0 ? cur[x] < HI[x] : cur[x] > LO[x]));
    const V = vr.reduce((a, v, x) => a + (free[x] ? v : 0), 0);
    if (Math.abs(gap) < 1 || !V) break;
    cur = cur.map((c, x) => (free[x] ? clamp(c + gap * vr[x] / V, LO[x], HI[x]) : c));
  }
  others.forEach((j, x) => { o.money[j] = Math.round(cur[x]); });
  o.sd = P.map((p, j) => (j === i ? 0 : Math.sqrt(25 + (s.unc ? s.unc[i][j] : 0))));
  o.sdBy = P.map((p, j) => (j === i ? 0 : Math.sqrt(25 + (s.unc ? s.unc[j][i] : 0)))); // how unsure j is about my money
  // for sharp guesses (th.sharp): the real doubt, without the floor of 5 but with what overpaid auction payments the
  // viewer did not handle may have hidden (no change is given; one-card payments overpay now and then)
  o.sdS = P.map((p, j) => (j === i ? 0 : Math.sqrt((s.unc ? s.unc[i][j] : 0) + overDoubt(o.hist, i, j))));
  o.sdSBy = P.map((p, j) => (j === i ? 0 : Math.sqrt((s.unc ? s.unc[j][i] : 0) + overDoubt(o.hist, j, i))));
  // th.track: the card tracker (tracker.js) follows guesses of everyone's hands through every public event; its money
  // estimates are blended with the ones above by how sure each is (2: the tracker's alone), and its guesses can stand
  // in for the other side's possible hands in a koehandel (th.trackHands)
  if (th && th.track) {
    const tr = track(s, o);
    if (tr) {
      o.track = tr;
      for (const j of others) {
        const vl = o.sdS[j] ** 2 + 100, vt = tr.sd[j] ** 2 + 100;
        const m = th.track === 2 ? tr.mean[j] : (o.money[j] / vl + tr.mean[j] / vt) / (1 / vl + 1 / vt), v = th.track === 2 ? vt - 100 : 1 / (1 / vl + 1 / vt) - 100;
        o.money[j] = Math.round(m); o.sdS[j] = Math.sqrt(Math.max(0, v)); o.sd[j] = Math.sqrt(Math.max(25, v));
      }
    }
  }
  if (s.peekForTests) { P.forEach((p, j) => { o.money[j] = sum(p.money); }); o.sd = P.map(() => 5); } // experiments only: perfect money knowledge
  // others' estimate of my money: the ledger plus what they learned in deals with me (the mirror of what I learned)
  const pub = s.ledger ? s.ledger[i] : 90;
  o.seenAs = P.map((p, j) => (j === i ? o.money[i] : Math.max(0, pub - (s.mem ? s.mem[i][j] : 0))));
  o.future = futureIncome(o);
  return o;
}
// Variance that hidden overpayments add to viewer v's idea of j's money: auction payments j made or received that
// v did not handle, by the number of cards (measured in bot games, agent/scripts/overpay.mjs).
const OVERPAY = [0, 1300, 50, 5];
function overDoubt(hist, v, j) {
  let x = 0;
  for (const e of hist) if (e.t === 'a' && e.m && (e.P === j || e.Q === j) && e.P !== v && e.Q !== v) x += OVERPAY[Math.min(e.m, 3)];
  return x;
}
// Lower bounds on money from bids: a player who bid b had at least b then; public changes since (auction prices,
// mule payouts) are in the ledger, so the bound moves with them, until the player's next koehandel (whose amounts
// are secret).
export function bidFloors(hist, ledger) {
  const out = ledger.map(() => 0), stale = ledger.map(() => false);
  for (let x = hist.length - 1; x >= 0; x--) {
    const e = hist[x];
    if (e.t === 'k') { stale[e.a] = stale[e.b] = true; continue; }
    if (e.t !== 'a' || !e.led) continue;
    for (const js in e.mx) { const j = +js; if (!stale[j]) out[j] = Math.max(out[j], e.mx[js] + ledger[j] - e.led[j]); }
  }
  return out;
}
// Mule money still to come per player: the payouts of the mules not drawn yet.
export function futureIncome(o) {
  const left = o.remain[3]; // mule index in TYPES
  let f = 0; for (let k = 0; k < 4 - o.mules; k++) f += MULE_PAY[o.mules + k] * clamp(left - k, 0, 1);
  return f;
}
// The same table from player j's side, as far as I can tell: j's money as I estimate it, mine as j estimates it.
export function asSeenBy(o, j) {
  if (j === o.me) return o;
  if (!o.hand) return { ...o, me: j }; // already someone else's view: keep its estimates
  const money = o.money.slice(); money[o.me] = o.seenAs[j];
  return { ...o, me: j, money, hand: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Auctions.

// Level-0 bid limit (what a plain value bidder would pay): the highest price at which getting the animal still
// beats letting another bidder have it at that price, and never below 10 when 10 beats the auctioneer keeping it.
export function plainLimit(o, th, M) {
  const me = o.me, a = o.auction, k = a.k, A = a.auctioneer;
  const rivals = o.active.filter(j => j !== me && j !== A);
  const mine = o.money[me];
  if (mine < 10) return 0;
  let W = 0; const w = rivals.map(j => { const x = (o.herd[j][k] + 0.3) * (o.money[j] + 10); W += x; return x; });
  const win = p => M.util(me, [[me, k, 1]], [[me, -p], [A, p]]);
  const lose = p => { let u = 0; for (let r = 0; r < rivals.length; r++) u += w[r] / W * M.util(me, [[rivals[r], k, 1]], [[rivals[r], -p], [A, p]]); return rivals.length ? u : M.util(me, [[A, k, 1]], []); };
  let lo = 0, hi = tens(mine);
  if (win(hi) >= lose(hi)) lo = hi;
  else { if (win(0) < lose(0)) hi = 0; while (hi - lo > 10) { const mid = tens((lo + hi) / 2); if (win(mid) >= lose(mid)) lo = mid; else hi = mid; } }
  if (lo < 10 && win(10) > M.util(me, [[A, k, 1]], [])) lo = 10;
  return lo;
}
// The plain limit of every bidder from public information (the ledger for everyone's money).
export function publicLimit(s, th) {
  const out = {}, a = s.auction, ledger = s.ledger || s.players.map(() => 90);
  s.players.forEach((p, j) => {
    if (p.out || j === a.auctioneer) return;
    const o = observe(s, j); o.money = s.players.map((q, x) => (q.out ? 0 : Math.max(0, Math.round(ledger[x])))); o.hand = null;
    out[j] = plainLimit(o, th, mkModel(o, th));
  });
  return out;
}
// How much better buying back has to look than selling (mDec). mDecP (0-1): that much of the margin goes with the
// price instead, against half the average money (a cheap buy-back risks little, so it needs little margin), at most
// three times mDec.
const hurdle = (o, th, q) => (th.mDec || 0) * (th.mDecP ? 1 - th.mDecP + th.mDecP * Math.min(3, q / (0.5 * o.pool / Math.max(1, o.active.length))) : 1);
// Would the auctioneer buy the animal back from bidder w at price q? (From the auctioneer's side.)
function buysBack(oA, MA, w, q, th) {
  const A = oA.me, k = oA.auction.k;
  if (oA.out[A] || oA.money[A] < q) return false;
  return MA.util(A, [[A, k, 1]], [[A, -q], [w, q]]) > MA.util(A, [[w, k, 1]], [[w, -q], [A, q]]) * (1 + hurdle(oA, th, q));
}
// How keen each player bids, from the auctions so far: their highest bid against what a plain bidder would have
// paid (from public information, kept by the engine). Players who dropped out show their limit; players who did
// not bid while the price was below the plain limit count as cool. Shrunk towards 1 while there is little to go by.
export function keenness(o, prior = 4) {
  const lg = new Float64Array(o.n), cnt = new Float64Array(o.n);
  for (const e of o.hist || []) {
    if (e.t !== 'a' || !e.pred) continue;
    for (const js in e.pred) {
      const j = +js, pr = e.pred[js];
      if (pr < 20 || e.w === j) continue;
      const b = e.mx && e.mx[js];
      let r;
      if (b) r = b / pr; else if (e.p < pr) r = Math.max(0.3, (e.p || 10) / pr); else continue;
      lg[j] += Math.log(clamp(r, 0.3, 3)); cnt[j]++;
    }
  }
  return Array.from(lg, (x, j) => Math.exp(x / (cnt[j] + prior)));
}
// Geometric mean keenness of the other players still in (1 when nothing is known yet).
function rivalKeen(o) {
  const k = keenness(o); let lg = 0, n = 0;
  for (const j of o.active) if (j !== o.me) { lg += Math.log(k[j]); n++; }
  return n ? Math.exp(lg / n) : 1;
}
// Predicted limits of the other bidders: their plain limit seen from their side, times how keen each has shown to be.
function rivalLimits(o, th) {
  const a = o.auction, out = [];
  for (const j of o.active) {
    if (j === o.me || j === a.auctioneer) continue;
    const oj = asSeenBy(o, j);
    out.push({ j, c: Math.min(o.money[j], plainLimit(oj, th, mkModel(oj, th)) * (o.keen ? o.keen[j] : 1)) });
  }
  return out;
}
// My limit, the English-auction way: going up in steps of 10, I stay in as long as being the highest bidder at
// that price beats the alternative (the bidder most likely still in gets it at that price), where either outcome
// counts that the auctioneer may buy the animal back, paying the winner. What I pay is what my cards can make (no
// change is given). Below the first step: 10 is worth bidding whenever it beats the auctioneer keeping it free.
export const payment = (all, q) => { if (!all) return q; for (const v of all) if (v >= q) return v; return Infinity; };
export function bidCap(o, th, M) { return bidPlan(o, th, M).cap; }
// The limit, and the bid to open with (or jump to): bids rise in steps of 10 from the highest bid, so a bidder nobody
// outbids would win at 10, and the auctioneer may buy it back for almost nothing. When nobody outbids me, a higher
// first bid makes buying back dearer (and pays me more if they still do), at the risk of paying more than needed.
// So: the bid that does best in the cases where the other bidders stop below it (their limits as predicted, give
// or take), against just topping them.
export function bidPlan(o, th, M) {
  const me = o.me, a = o.auction, k = a.k, A = a.auctioneer, mine = tens(o.money[me]), all = o.hand ? sums(o.hand) : null;
  if (mine < 10) return { cap: 0, open: 0 };
  const oA = asSeenBy(o, A), MA = mkModel(oA, th), rivals = rivalLimits(o, th);
  // whether the auctioneer buys back is a guess: a chance that grows with how much better buying looks to them;
  // openHist: blended with what this auctioneer actually did so far (the model's guess counting as openHist earlier
  // auctions), since a player who hardly ever buys back makes a high bid just a high price. What counts at price q: a
  // sale at q or less (they would sell at q too), a buy-back at q or more (they would buy at q too).
  const bb = th.openHist ? buyBacks(o.hist, A) : null;
  const pBuy = (w, q) => {
    if (oA.out[A] || oA.money[A] < q) return 0;
    const r = MA.util(A, [[A, k, 1]], [[A, -q], [w, q]]) / Math.max(1e-12, MA.util(A, [[w, k, 1]], [[w, -q], [A, q]])) - 1 - hurdle(oA, th, q);
    let pb = 1 / (1 + Math.exp(-r / (th.openT ?? 0.05)));
    if (bb) { let n = 0, b = 0; for (const [p, buy] of bb) if (buy ? p >= q : p <= q) { n++; if (buy) b++; } pb = (th.openHist * pb + b) / (th.openHist + n); }
    return pb;
  };
  // w ends up highest bidder at price q: my position if the auctioneer sells, buys back, or (softly) either
  const sold = (w, q) => { const pq = w === me ? payment(all, q) : q; return M.util(me, [[w, k, 1]], [[w, -pq], [A, pq]]); };
  const soft = (w, q) => { const pb = pBuy(w, q), s = sold(w, q); return pb > 0 ? pb * M.util(me, [[A, k, 1]], [[A, -q], [w, q]]) + (1 - pb) * s : s; };
  const at = th.softCap ? soft : (w, q) => (buysBack(oA, MA, w, q, th) ? M.util(me, [[A, k, 1]], [[A, -q], [w, q]]) : sold(w, q));
  const other = q => {
    if (!rivals.length) return M.util(me, [[A, k, 1]], []);
    let u = 0, W = 0;
    for (const r of rivals) { const w = (r.c >= q ? 1 : 0.1) * (o.herd[r.j][k] + 0.5); u += w * at(r.j, q); W += w; }
    return u / W;
  };
  if (!(at(me, 10) > M.util(me, [[A, k, 1]], []))) return { cap: 0, open: 0 };
  let cap = 10;
  for (let q = 20; q <= mine; q = q < 100 ? q + 10 : tens(q * 1.06) + 10) {
    if (!(at(me, q) >= other(q))) break;
    cap = q;
  }
  // shadeK: how far above (or below) the model's limit to go follows how keen the others have bid so far (their
  // geometric mean keenness to this power), so a table that overbids or underbids is answered in kind or against it
  const sk = th.shadeK ? Math.pow(rivalKeen(o), th.shadeK) : 1;
  cap = Math.min(tens(cap * (th.shade ?? 1) * sk), mine);
  if (!th.open || cap <= 10) return { cap, open: 0 };
  // where the others stop: each rival's limit times a spread, 0 for those who will not bid
  const SPREAD = [[0.55, 0.1], [0.75, 0.2], [1, 0.4], [1.3, 0.2], [1.7, 0.1]];
  const stops = rivals.map(r => SPREAD.map(([f, w]) => { const c = tens(Math.min(o.money[r.j], r.c * f)); return [c >= 10 ? c : 0, w]; }));
  const below = x => stops.reduce((p, st) => p * st.reduce((q, [c, w]) => q + (c < x ? w : 0), 0), 1); // P(all stop below x)
  const pts = [...new Set([0, ...stops.flat().map(s => s[0])])].sort((x, y) => x - y);
  const pmf = pts.map((l, x) => [l, below(l + 10) - (x ? below(pts[x - 1] + 10) : 0)]);
  const base = new Map(); for (const [l] of pmf) base.set(l, soft(me, Math.max(10, l + 10)));
  // never open where being sold the animal would be worse than the auctioneer keeping it for 10 (the usual result
  // of not opening): a hoped-for buy-back is no reason to risk paying a price I do not want to pay
  const kept = M.util(me, [[A, k, 1]], [[A, -10], [me, 10]]);
  let open = 0, bestGain = 0;
  for (let q = 20; q <= cap; q = q < 100 ? q + 10 : tens(q * 1.06) + 10) {
    const pq = payment(all, q);
    if (M.util(me, [[me, k, 1]], [[me, -pq], [A, pq]]) < kept) break;
    let g = 0; const u = soft(me, q);
    for (const [l, p] of pmf) if (l < q && p > 0) g += p * (u - base.get(l));
    if (g > bestGain) { bestGain = g; open = q; }
  }
  return { cap, open: bestGain > 1e-4 * Math.abs(M.util(me, [], [])) ? open : 0 };
}
// What player A did as auctioneer so far: [price, bought back?] for every auction of A that got a bid.
function buyBacks(hist, A) {
  const out = [];
  for (const e of hist || []) if (e.t === 'a' && e.A === A && e.p > 0) out.push([e.p, !!e.buy]);
  return out;
}
// Auctioneer: buy back?
export function buyBack(o, th, M) {
  const me = o.me, a = o.auction, k = a.k, b = a.high.p, p = a.high.amt, pay = payment(sums(o.hand), p);
  if (o.money[me] < p) return false;
  return M.util(me, [[me, k, 1]], [[me, -pay], [b, pay]]) > M.util(me, [[b, k, 1]], [[b, -p], [me, p]]) * (1 + hurdle(o, th, p));
}

// ---------------------------------------------------------------------------------------------------------------
// Turn: what is auctioning worth? For every animal that can come up: the predicted limits of the others decide
// the price and who bids highest, then I sell or buy back, whichever is better. Mules first pay everyone.
export function auctionValue(o, th) {
  const me = o.me, deck = o.deckLeft;
  if (!deck) return -Infinity;
  const tot = o.remain.reduce((a, b) => a + b, 0) || 1;
  let ev = 0;
  for (let k = 0; k < NT; k++) {
    const pk = o.remain[k] / tot;
    if (pk <= 0) continue;
    const ok = { ...o, remain: o.remain.slice(), seen: o.seen.slice(), money: o.money.slice(), seenAs: o.seenAs.slice(), auction: { k, auctioneer: me, high: null, stage: 'bidding' } };
    ok.remain[k] = Math.max(0, ok.remain[k] - 1); ok.seen[k]++;
    if (k === 3 && o.mules < 4) { const pay = MULE_PAY[o.mules]; for (const j of o.active) { ok.money[j] += pay; ok.seenAs[j] += pay; } ok.pool = o.pool + pay * o.active.length; ok.mules = o.mules + 1; ok.hand = [...o.hand, pay]; }
    const Mk = mkModel(ok, th);
    let c1 = 0, c2 = 0, w = -1;
    for (const j of o.active) {
      if (j === me) continue;
      const oj = asSeenBy(ok, j), Mj = mkModel(oj, th), c = Math.min(ok.money[j], plainLimit(oj, th, Mj) * (o.keen ? o.keen[j] : 1));
      if (c > c1) { c2 = c1; c1 = c; w = j; } else if (c > c2) c2 = c;
    }
    let u;
    if (c1 < 10) u = Mk.util(me, [[me, k, 1]], []);
    else {
      const q = Math.max(10, Math.min(c1, c2 + 10));
      const sell = Mk.util(me, [[w, k, 1]], [[w, -q], [me, q]]), pay = payment(sums(ok.hand), q);
      u = ok.money[me] >= q ? Math.max(sell, Mk.util(me, [[me, k, 1]], [[me, -pay], [w, pay]])) : sell;
    }
    ev += pk * u;
  }
  return ev;
}

// ---------------------------------------------------------------------------------------------------------------
// Koehandel. The attacker offers face down; the defender sees only the number of cards and accepts (gets the
// offer, loses the animals) or counters; the higher offer wins the animals and the two offers swap hands.

// For each amount a hand can pay exactly, the fewest cards that do it (zeros never needed). Index = amount / 10.
function fewest(hand) {
  const tot = sum(hand) / 10, f = new Int8Array(tot + 1).fill(99); f[0] = 0;
  for (const c of hand) { const d = c / 10; if (d) for (let v = tot; v >= d; v--) if (f[v - d] + 1 < f[v]) f[v] = f[v - d] + 1; }
  return f;
}
// A few plausible hands for player j (count cards out of `pool`, close to the money estimate), with weights.
// sharp: each guess aims at a total drawn around the estimate (spread sd, how unsure the estimate is) by swapping
// cards with the pool, so a money total known exactly gives hands that add up to it; otherwise random hands are
// weighted by how close they come (loosely).
function guessHands(pool, count, est, rand, K = 8, sd = 0, sharp = false) {
  const out = [];
  if (!count) return [{ hand: [], w: 1 }];
  if (sharp) {
    for (let t = 0; t < K; t++) {
      const p = shuffle(pool.slice(), rand), h = p.slice(0, count), rest = p.slice(count);
      const target = est + sd * gauss(rand);
      let m = sum(h);
      for (let step = 0; step < 2 * count + 4; step++) { // greedy swaps towards the target
        let bx = -1, by = -1, bd = Math.abs(m - target);
        for (let x = 0; x < h.length; x++) for (let y = 0; y < rest.length; y++) {
          const d = Math.abs(m - h[x] + rest[y] - target);
          if (d < bd - 1e-9) { bd = d; bx = x; by = y; }
        }
        if (bx < 0) break;
        m += rest[by] - h[bx]; [h[bx], rest[by]] = [rest[by], h[bx]];
      }
      out.push({ hand: h, w: 1 / K });
    }
    return out;
  }
  for (let t = 0; t < K * 3; t++) {
    const h = shuffle(pool.slice(), rand).slice(0, count), m = sum(h);
    out.push({ hand: h, w: Math.exp(-Math.abs(m - est) / (20 + 0.15 * est + sd)) });
  }
  out.sort((a, b) => b.w - a.w);
  const top = out.slice(0, K), W = top.reduce((a, b) => a + b.w, 0) || 1;
  for (const x of top) x.w /= W;
  return top;
}
// Sums of random n-card subsets of a hand: dp[n][amount / 10] = number of such subsets.
function subsetSums(hand) {
  const C = hand.length, V = sum(hand) / 10, dp = Array.from({ length: C + 1 }, () => new Float64Array(V + 1));
  dp[0][0] = 1; let top = 0;
  hand.forEach((c, idx) => { const d = c / 10; for (let n = idx; n >= 0; n--) { const row = dp[n], nxt = dp[n + 1]; for (let v = top; v >= 0; v--) if (row[v]) nxt[v + d] += row[v]; } top += d; });
  return dp;
}
// What a defender may believe the attacker offered, given the number of cards on the table, from the attacker's
// possible hands. Two views: "strategic" (the attacker aims for an amount, often just above what the defender can
// pay, sometimes a pure bluff, and pays it with the fewest cards plus maybe some zeros) and "any" (any n cards of
// the hand are equally likely). Per card count n: Map amount -> weight (unnormalised).
export function offerBelief(hands, defMoney, style = {}) {
  const bluff = style.bluff ?? 0.15, sharp = style.sharp ?? 0.45;
  const S = new Map(), A = new Map();
  const add = (map, n, v, w) => { let m = map.get(n); if (!m) map.set(n, (m = new Map())); m.set(v, (m.get(v) || 0) + w); };
  for (const { hand, w } of hands) {
    const f = fewest(hand), m = sum(hand), zeros = hand.filter(c => c === 0).length;
    const reach = []; for (let v = 0; v < f.length; v++) if (f[v] < 99) reach.push(v * 10);
    const T = [[0, bluff]], aim = Math.min(m, tens(defMoney) + 10);
    for (const r of [0.8, 1, 1.2]) T.push([Math.min(m, tens(aim * r)), sharp / 3]);
    const spread = 1 - bluff - sharp;
    for (let x = 1; x <= 8; x++) T.push([tens(m * x / 8), spread / 8]);
    for (const [t, wt] of T) {
      const v = reach.find(r => r >= t) ?? reach[reach.length - 1], n0 = f[v / 10];
      for (let p = 0; p <= zeros; p++) add(S, n0 + p, v, (p === 0 ? 0.5 : 0.5 / zeros) * w * wt);
    }
    const dp = subsetSums(hand);
    for (let n = 0; n < dp.length; n++) {
      let tot = 0; for (const x of dp[n]) tot += x;
      if (tot) dp[n].forEach((x, v) => { if (x) add(A, n, v * 10, w * x / tot); });
    }
  }
  return { S, A };
}
// The naive reading: n cards of someone with money m in c cards are worth about n * m / c (give or take).
const NAIVE = [[0.3, 0.15], [0.65, 0.2], [1, 0.3], [1.45, 0.2], [2.1, 0.15]];
function naiveBelief(n, m, c) {
  if (!n) return new Map([[0, 1]]);
  const mean = Math.min(m, n * m / Math.max(1, c)), out = new Map();
  for (const [r, w] of NAIVE) { const x = Math.min(m, tens(mean * r)); out.set(x, (out.get(x) || 0) + w); }
  return out;
}
// A normalised mixture of beliefs: [[Map, weight], ...] -> [[amount, weight], ...].
function mix(parts) {
  const acc = new Map();
  for (const [m, w] of parts) {
    if (!m || !w) continue;
    let tot = 0; for (const x of m.values()) tot += x;
    if (tot) for (const [v, x] of m) acc.set(v, (acc.get(v) || 0) + w * x / tot);
  }
  let tot = 0; for (const x of acc.values()) tot += x;
  return tot ? [...acc].map(([v, x]) => [v, x / tot]) : null;
}
export const BELIEF = { s: 0.45, a: 0.35, n: 0.2 }; // how a careful defender weighs the three readings
// Utility tables for the two outcomes of a koehandel, by the money the player `who` receives net (multiples of 10).
function outcomes(M, who, A, B, k, c) {
  const other = who === A ? B : A, gets = who === A ? A : B;
  const mk = (winner) => {
    const loser = winner === A ? B : A, memo = new Map();
    return d => { let u = memo.get(d); if (u === undefined) { u = M.util(who, [[winner, k, c], [loser, k, -c]], [[who, d], [other, -d]]); memo.set(d, u); } return u; };
  };
  return { win: mk(gets), lose: mk(other) };
}
// Defender's best answer to an offer believed to be `belief` ([amount, weight] list): null = accept, or the counter.
export function bestCounter(belief, amounts, U, ties) {
  let acc = 0; for (const [x, w] of belief) acc += w * U.lose(x);
  let best = null, bv = acc;
  for (const y of amounts) {
    if (y <= 0) continue;
    let v = 0;
    for (const [x, w] of belief) v += w * (y > x ? U.win(x - y) : y < x ? U.lose(x - y) : ties ? U.lose(0) : 0.5 * (U.win(0) + U.lose(0)));
    if (v > bv) { bv = v; best = y; }
  }
  return { y: best, v: bv, acc };
}
// The settling rule against endless koehandels (see brain.js): +1 win it, -1 let go, 0 normal.
const settling = (o, me, j, k) => (repeats(o, me, j, k) >= 2 ? Math.sign(o.herd[me][k] - o.herd[j][k]) : 0);

// Attacker: the cards to offer and what they are expected to bring. Predicts the defender's answer to each card
// count (from the defender's side: their likely hands and money, and what they would believe I offered).
export function planOffer(o, th, M, j, k, c, rand, rough = false) {
  const me = o.me, hand = o.hand, settle = settling(o, me, j, k);
  const amounts = sums(hand), zeros = hand.filter(x => x === 0).length;
  const U = outcomes(M, me, me, j, k, c);
  if (settle < 0) return { cards: [], ev: U.lose(0) };
  if (th.allIn && hand.length && lastStand(o, j, k, c)) return { cards: hand.slice(), ev: U.win(0) };
  // the defender's possible hands (from the cards I cannot see), and their belief about my offer
  const sh = !!th.sharp, myPool = o.unseen, defHands = guessHands(myPool, o.cards[j], o.money[j], rand, rough ? 2 : 3, sh ? o.sdS[j] : o.sd[j], sh);
  const scen = defHands.map(({ hand: hB, w }) => {
    const poolB = myPool.slice(); for (const x of hB) poolB.splice(poolB.indexOf(x), 1); poolB.push(...hand);
    const myHands = guessHands(poolB, hand.length, o.seenAs[j], rand, rough ? 4 : 6, sh ? o.sdSBy[j] : 0, sh);
    return { w, hB, belief: offerBelief(myHands, o.money[j]), amounts: sums(hB), cache: new Map() };
  });
  const UB = outcomes(M, j, me, j, k, c), ties = !!o.trade && o.trade.ties;
  // the defender's answers to n cards, [counter or null, weight]: a careful reader, a naive one, and one who
  // assumes any cards are equally likely
  const respond = (sc, n) => {
    if (sc.cache.has(n)) return sc.cache.get(n);
    const S = sc.belief.S.get(n), A = sc.belief.A.get(n), N = naiveBelief(n, o.seenAs[j], hand.length);
    const fallback = [[Math.min(o.money[me], n * 20), 1]];
    const r = (th.naive ? [[mix([[N, 1]]), 1]] : [[mix([[S, BELIEF.s], [A, BELIEF.a], [N, BELIEF.n]]), 0.6], [mix([[N, 1]]), 0.25], [mix([[A, 1]]) || mix([[N, 1]]), 0.15]])
      .map(([b, w]) => [bestCounter(b || fallback, sc.amounts, UB, ties).y, w]);
    sc.cache.set(n, r); return r;
  };
  let best = null;
  const cands = rough ? amounts.filter((v, x) => v <= 100 || x % 3 === 0 || x === amounts.length - 1) : amounts;
  for (const x of cands) {
    if (settle > 0 && x <= o.money[j] && x < o.money[me]) continue;
    const base = x ? cheapest(hand, x) : [];
    const free = zeros - base.filter(v => v === 0).length;
    for (let p = 0; p <= Math.min(free, th.naive ? 0 : rough ? 1 : 3); p++) {
      const n = base.length + p;
      let ev = 0;
      for (const sc of scen) for (const [y, w] of respond(sc, n))
        ev += sc.w * w * (y === null ? U.win(-x) : y > x ? U.lose(y - x) : y < x ? U.win(y - x) : 0.5 * (U.win(0) + U.lose(0)));
      if (!best || ev > best.ev * (1 + 1e-9) || (ev > best.ev * (1 - 2e-3) && rand() < 0.3)) best = { x, p, ev, cards: base.concat(Array(p).fill(0)) };
    }
  }
  return best;
}
// Defender: accept (null) or the counter.
export function planCounter(o, th, M, rand) {
  const me = o.me, tr = o.trade, a = tr.a, k = tr.k, c = tr.count, settle = settling(o, me, a, k);
  if (settle < 0) return null;
  if (th.allIn && sum(o.hand) > 0 && lastStand(o, a, k, c)) return sum(o.hand);
  const U = outcomes(M, me, a, me, k, c);
  const hands = guessHands(o.unseen, o.cards[a], o.money[a], rand, 10, th.sharp ? o.sdS[a] : o.sd[a], !!th.sharp);
  const belief = offerBelief(hands, o.seenAs[a]), n = tr.offer;
  let b = (th.naive ? mix([[naiveBelief(n, o.money[a], o.cards[a]), 1]]) : mix([[belief.S.get(n), BELIEF.s], [belief.A.get(n), BELIEF.a], [naiveBelief(n, o.money[a], o.cards[a]), BELIEF.n]])) || [[Math.min(o.money[a], n * 20), 1]];
  if (tr.tieAt != null) b = b.map(([x, w]) => [Math.max(x, tr.tieAt), w]);
  const amounts = sums(o.hand);
  if (settle > 0) { const top = Math.max(...b.map(x => x[0])); return amounts.find(y => y > top) ?? null; }
  return bestCounter(b, amounts, U, !!tr.ties).y;
}
// The same two decisions by solving the koehandel as a game of hidden hands (lib/bots/solver.js). Types: the
// possible hands of each side as the other side sees them; my own hand is one of my types.
function typesFor(pool, count, est, rand, K, sd, own, sharp = false) {
  const hs = guessHands(pool, count, est, rand, K, sd, sharp);
  if (!own) return hs;
  const w0 = sharp ? Math.exp(-0.5 * ((sum(own) - est) / (sd + 10)) ** 2) : Math.exp(-Math.abs(sum(own) - est) / (20 + 0.15 * est + sd)), top = hs.length ? Math.max(...hs.map(h => h.w)) : 1;
  const out = [{ hand: own, w: Math.min(1, w0 / Math.max(1e-9, top)) * (1 / Math.max(1, hs.length)) }, ...hs.map(h => ({ hand: h.hand, w: h.w }))];
  const W = out.reduce((a, b) => a + b.w, 0); for (const x of out) x.w /= W;
  return out;
}
const without = (pool, hand) => { const p = pool.slice(); for (const x of hand) { const i = p.indexOf(x); if (i >= 0) p.splice(i, 1); } return p; };
function koehandelGame(o, th, M, A, B, k, c, rand, rough) {
  const me = o.me, K = Math.round(rough ? th.roughK || 5 : th.solveK || 9), iters = Math.round(rough ? th.roughIt || 25 : th.solveIt || 45), tr = o.trade;
  const ties = !!tr && tr.ties, floor = tr && tr.tieAt != null ? tr.tieAt : 0;
  let aTypes, bTypes;
  const sh = !!th.sharp, sd = sh ? o.sdS : o.sd;
  const theirs = (j, est, s0) => (th.trackHands && o.track ? o.track.hands(j, K, rand) : guessHands(o.unseen, o.cards[j], est, rand, K, s0, sh));
  if (me === A) {
    bTypes = theirs(B, o.money[B], sd[B]);
    aTypes = typesFor(without(o.unseen.concat(o.hand), bTypes[0].hand), o.hand.length, o.seenAs[B], rand, K, sh ? o.sdSBy[B] : 0, o.hand, sh);
  } else {
    aTypes = theirs(A, o.money[A], sd[A]);
    bTypes = typesFor(without(o.unseen.concat(o.hand), aTypes[0].hand), o.hand.length, o.seenAs[A], rand, K, sh ? o.sdSBy[A] : 0, o.hand, sh);
  }
  const UA = outcomes(M, A, A, B, k, c), UB = outcomes(M, B, A, B, k, c);
  const hb = me === B && th.habits ? offerHabit(o, A) : null, ha = me === A && th.habitsA ? answerHabit(o, B, !!th.habitsAll) : null;
  return solve({ aTypes, bTypes, UA, UB, ties, floor, iters, eps: th.solveEps ?? 0.06, habit: hb && hb.at, habitW: hb ? th.habits * hb.trust : 0, answers: ha && ha.at, answersW: ha ? th.habitsA * ha.trust * ha.gate : 0, maxPad: th.solvePad || 5 });
}
// How this defender has answered my offers: how often it accepted, and its counters per card I put down. all (th.habitsAll):
// also its answers to everyone else's offers (whether it accepted is public; the size of those counters is not, so
// without counters to my own offers they are taken as a share of its money). Then it only counts for a defender who
// mostly accepts (gate: none at half the time or less, in full when always; with a prior of one accept and two
// counters, so a single accept proves nothing), as people who never counter do.
function answerHabit(o, b, all = false) {
  let acc = 0, m = 0, ys = 0, ns = 0, nc = 0;
  for (const e of o.hist || []) if (e.t === 'k' && e.b === b && e.na && (all || e.a === o.me)) {
    m++; if (e.nb == null) acc++; else if (e.a === o.me && e.y != null) { ys += e.y; ns += e.na; } else nc++;
  }
  if (!m) return null;
  const pa = (acc + 0.5) / (m + 1), r = ns ? ys / ns / 10 : 0, mb = o.money[b];
  const at = n => (ns ? [[-1, pa], ...[[0.7, 0.3], [1, 0.4], [1.4, 0.3]].map(([f, p]) => [Math.max(1, Math.round(r * Math.max(1, n) * f)), (1 - pa) * p])]
    : nc ? [[-1, pa], ...[[0.5, 0.3], [0.8, 0.4], [1, 0.3]].map(([f, p]) => [Math.max(1, Math.round(mb * f / 10)), (1 - pa) * p])] : [[-1, 1]]);
  return { trust: m / (m + 3), at, gate: all ? Math.min(1, Math.max(0, 2 * (acc + 1) / (m + 3) - 1)) : 1 };
}
// How this attacker's offers to me have looked (the amounts are known to me afterwards): value per card, as a
// belief for n cards (spread around the typical ratio), and how much to trust it (more offers, more trust).
function offerHabit(o, a) {
  let x = 0, n = 0, m = 0;
  for (const e of o.hist || []) if (e.t === 'k' && e.a === a && e.b === o.me && e.x != null && e.na) { x += e.x; n += e.na; m++; }
  if (!m) return null;
  const r = x / n / 10;
  return { trust: m / (m + 3), at: k => (k ? [[0.5, 0.25], [1, 0.5], [1.6, 0.25]].map(([f, p]) => [Math.round(r * k * f), p]) : [[0, 1]]) };
}
// My last stand: the deck is empty and, whichever way this deal goes, I end up sharing no animal type with anyone,
// so no later move can change my score and my money is worth nothing. Then only winning the animals counts, and
// putting everything in can only help.
function lastStand(o, j, k, c) {
  if (o.deckLeft) return false;
  const me = o.me;
  for (const d of [c, -c]) { // I win, I lose
    for (let t = 0; t < NT; t++) {
      const mine = o.herd[me][t] + (t === k ? d : 0);
      if (mine <= 0) continue;
      for (let x = 0; x < o.n; x++) if (x !== me && o.herd[x][t] + (t === k && x === j ? -d : 0) > 0) return false;
    }
  }
  return true;
}
export function solvedOffer(o, th, M, j, k, c, rand, rough = false) {
  const me = o.me, settle = settling(o, me, j, k), U = outcomes(M, me, me, j, k, c);
  if (settle < 0) return { cards: [], ev: U.lose(0) };
  if (th.allIn && o.hand.length && lastStand(o, j, k, c)) return { cards: o.hand.slice(), ev: U.win(0), x: sum(o.hand), n: o.hand.length };
  const g = koehandelGame(o, th, M, me, j, k, c, rand, rough), a = g.A[0], vals = g.valueOf(a);
  let bi = 0; vals.forEach((v, i) => { if (v > vals[bi]) bi = i; });
  if (settle > 0) { // must win: the cheapest offer above what they can pay, if I can
    const i = a.acts.findIndex(([x]) => x * 10 > o.money[j]);
    if (i >= 0) bi = i;
  }
  const best = vals[bi], tol = Math.abs(best) * 2e-3, mx = g.mix(a);
  if (globalThis.DBG_OFFER) globalThis.DBG_OFFER(a.acts, vals, mx); // analysis only (agent/scripts/rebuild.mjs, OFFER=)
  // play the equilibrium mix among the offers that are (nearly) as good as the best; padding with zeros costs a
  // little (zeros kept are bluffs for later, zeros given away are the other player's), so it is only played where
  // it does something
  const few = fewest(o.hand), pad = i => Math.max(0, a.acts[i][1] - (few[a.acts[i][0]] ?? 0)), adj = i => vals[i] - (th.padCost ?? 0) * tol * pad(i);
  const bestAdj = Math.max(...a.acts.map((_, i) => adj(i)));
  let W = 0; const ok = []; a.acts.forEach((_, i) => { if (adj(i) >= bestAdj - tol && vals[i] >= best - tol) { const w = mx[i] + 0.02; ok.push([i, w]); W += w; } });
  let r = rand() * W, pick = bi; if (settle <= 0) for (const [i, w] of ok) { r -= w; if (r <= 0) { pick = i; break; } }
  const [x, n] = a.acts[pick];
  return { cards: cardsFor(o.hand, x * 10, n) || cheapest(o.hand, x * 10), ev: best, x: x * 10, n };
}
export function solvedCounter(o, th, M, rand) {
  const me = o.me, tr = o.trade, a = tr.a, k = tr.k, c = tr.count, settle = settling(o, me, a, k);
  if (settle < 0) return null;
  if (th.allIn && sum(o.hand) > 0 && lastStand(o, a, k, c)) return sum(o.hand);
  const g = koehandelGame(o, th, M, a, me, k, c, rand, false);
  if (settle > 0) { const post = g.posterior(tr.offer), top = Math.max(...post.map(p => p[0])) * 10; return sums(o.hand).find(y => y > top) ?? null; }
  if (globalThis.DBG_COUNTER) globalThis.DBG_COUNTER(g, o.hand, tr.offer); // analysis only (agent/scripts/rebuild.mjs, COUNTER=)
  const y = g.answer(o.hand, tr.offer);
  return y < 0 ? null : y * 10;
}
// Koehandel options for the turn, with their value.
export function koehandelOptions(o, th, M, rand) {
  const out = [];
  for (const t of targetsOf(o)) {
    if (o.out[t.p]) { out.push({ ...t, ev: M.util(o.me, [[o.me, t.k, t.count], [t.p, t.k, -t.count]], []) * 2 }); continue; }
    const plan = th.solve ? solvedOffer(o, th, M, t.p, t.k, t.count, rand, true) : planOffer(o, th, M, t.p, t.k, t.count, rand, true);
    out.push({ ...t, ev: plan.ev * (1 - 0.1 * repeats(o, o.me, t.p, t.k)) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Personality: every bot seat gets its own small leanings, fixed for the game (from the table's seed): how keen it
// bids, two favourite animals it bids a little more for, how eager it is to start koehandels, and how readily it
// buys back. `spread` scales them (0 = none); at the top level they stay small enough to cost almost nothing.
export function styleOf(s, i, spread) {
  if (!spread) return null;
  let h = ((s.seed | 0) ^ 0x2545f491) >>> 0;
  const r = () => { h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x9e3779b9 + i * 0x632be5ab | 0; h ^= h >>> 12; return (h >>> 0) / 4294967296; };
  for (let x = 0; x < 4 + i; x++) r();
  const f1 = Math.floor(r() * 10), f2 = (f1 + 1 + Math.floor(r() * 9)) % 10;
  return { keen: 1 + spread * (r() * 2 - 1) * 0.12, fav: [f1, f2], favBy: 1 + spread * 0.12 * r(), kh: spread * (r() * 2 - 1) * 0.04, mDec: spread * (r() * 2 - 1) * 0.02 };
}
// Settings by deck size: th.small holds the values for a 20-card deck (tuned there), the rest is for the full deck
// (every setting in th.small needs a full-deck value too); from 20 to 30 cards they are blended in proportion (with 20
// cards every type comes twice, so every set is a pair: a different game from 21 cards on).
export function forDeck(th, size) {
  if (!th.small) return th;
  const f = clamp((30 - size) / 10, 0, 1), out = { ...th };
  for (const k in th.small) out[k] = th[k] + f * (th.small[k] - th[k]);
  return out;
}
// The player built on all of the above.
function gauss(rand) { return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()); }
// noise: every price it comes up with is blurred (lognormal, this sd); slip: share of careless turn choices
export function expertAgent(th0, { noise = 0, slip = 0 } = {}) {
  const blur = (x, rand) => (noise ? x * Math.exp(noise * gauss(rand) - noise * noise / 2) : x);
  const sized = new Map();
  const seat = (s, i) => {
    const size = s.deckSize || 40;
    if (!sized.has(size)) sized.set(size, forDeck(th0, size));
    let th1 = sized.get(size);
    if (th1.solo) { const p = people(s); if (s.players.every((_, j) => j === i || p[j])) th1 = { ...th1, ...th1.solo }; } // th.solo: when all the others are people
    const y = styleOf(s, i, th1.style || 0);
    return y ? { th: { ...th1, shade: (th1.shade ?? 1) * y.keen, mDec: (th1.mDec || 0) + y.mDec }, y } : { th: th1, y: null };
  };
  // the limit and the opening bid (0: just top the highest bid)
  const bid = (s, i, rand = Math.random) => {
    const { th, y } = seat(s, i), o = look(s, i, th);
    if (th.adapt) o.keen = keenness(o, th.adapt);
    const p = bidPlan(o, th, mkModel(o, th)), c0 = p.cap;
    let c = noise && c0 ? Math.max(10, Math.min(tens(o.money[i]), tens(blur(c0, rand)))) : c0;
    if (y && y.fav.includes(o.auction.k)) c = Math.min(tens(o.money[i]), tens(c * y.favBy));
    return { cap: c, open: Math.min(p.open, c) };
  };
  return {
    person: !!th0.person, // a stand-in for a person (simulations): the others treat it as one (s.people)
    bid,
    cap: (s, i, rand) => bid(s, i, rand).cap,
    act(s, i, what, rand) {
      const { th, y } = seat(s, i), o = look(s, i, th), M = mkModel(o, th);
      if (th.adapt) o.keen = keenness(o, th.adapt);
      if (what === 'pay') return { type: 'pay', cards: cheapest(o.hand, s.auction.high.amt) };
      if (what === 'decide') return { type: buyBack(o, th, M) ? 'buy' : 'sell' };
      if (what === 'turn') {
        if (slip && rand() < slip) { const ts = targetsOf(o); if (!o.deckLeft || (ts.length && rand() < 0.3)) { const t = ts[Math.floor(rand() * ts.length)]; return { type: 'koehandel', target: t.p, animal: TYPES[t.k] }; } return { type: 'auction' }; }
        let best = o.deckLeft ? { v: auctionValue(o, th), act: { type: 'auction' } } : null;
        // khBiasP: the restraint against a person instead (khBias is tuned on bots, who answer koehandels well)
        const bias = 1 + (y ? y.kh : 0) + (th.khBias || 0), opts = koehandelOptions(o, th, M, rand), ppl = th.khBiasP != null ? people(s) : null;
        for (const t of opts) {
          const b = ppl && ppl[t.p] ? bias - (th.khBias || 0) + th.khBiasP : bias;
          if (!best || t.ev * b > best.v) best = { v: t.ev * b, act: { type: 'koehandel', target: t.p, animal: TYPES[t.k] } };
        }
        if (th.endgame && !o.deckLeft && opts.length > 1) { // experiment: endgame lookahead (agent/scripts/endgame.mjs)
          const top = opts.sort((a, b) => b.ev - a.ev).slice(0, th.endTop || 4);
          const r = th.endgame(s, o, top, { rollouts: th.endRoll || 24, seed: Math.floor(rand() * 2 ** 30) });
          if (r) return { type: 'koehandel', target: r.pick.p, animal: TYPES[r.pick.k] };
        }
        return best.act;
      }
      const tr = o.trade;
      if (what === 'offer') {
        if (th.boldP && rand() < th.boldP) return { type: 'tradebid', cards: o.hand.slice() }; // a stand-in for people who offer everything (simulations)
        const pl = th.solve ? solvedOffer(o, th, M, tr.b, tr.k, tr.count, rand) : planOffer(o, th, M, tr.b, tr.k, tr.count, rand);
        if (!noise) return { type: 'tradebid', cards: pl.cards };
        const x = sums(o.hand).find(v => v >= tens(blur(sum(pl.cards), rand))) ?? 0;
        return { type: 'tradebid', cards: x ? cheapest(o.hand, x) : [] };
      }
      if (th.acceptP && rand() < th.acceptP) return { type: 'accept' }; // a stand-in for people who always accept (simulations)
      let yv = th.solve ? solvedCounter(o, th, M, rand) : planCounter(o, th, M, rand);
      if (yv !== null && noise) yv = Math.min(o.money[i], sums(o.hand).find(v => v >= Math.max(10, tens(blur(yv, rand)))) ?? yv) || null; // a counter stays a counter
      return yv === null ? { type: 'accept' } : { type: 'tradebid', cards: cheapest(o.hand, yv) };
    },
  };
}
export const EXPERT = { tau: 1.432, tau1: 68.93, rho: 1.289, gamma: 1.106, delta: 0.8568, mu: 508.3, mDec: 0.02 };
