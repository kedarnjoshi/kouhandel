// The bots' judgement: a fast model of "how likely am I to win from here", and every decision as a comparison
// of that model before and after. See agent/README.md for how it was built and tuned.
import { ANIMALS, TYPES, MULE_PAY, sum, cheapest } from '../rules.js';

export const NT = TYPES.length;
export const VAL = TYPES.map(t => ANIMALS[t]);
export const IDX = Object.fromEntries(TYPES.map((t, k) => [t, k]));

// ---------------------------------------------------------------------------------------------------------------
// What a bot may know about the table: its own cards, everyone's animals and card counts, public money estimates
// (plus what it saw in its own deals), the deck size and which animals came up. Never other hands or the deck.
export function observe(s, i) {
  const P = s.players, a = s.auction, tr = s.trade;
  const herd = P.map(p => TYPES.map(t => p.animals[t] || 0));
  const seen = TYPES.map((t, k) => { let n = a && a.type === t ? 1 : 0; for (const h of herd) n += h[k]; return n; });
  const hand = [...P[i].money], mine = sum(hand);
  let pool = 0; for (const p of P) pool += sum(p.money); // the total is public: start money plus mule payouts
  const money = P.map((p, j) => {
    if (j === i) return mine;
    if (p.out || !p.money.length) return 0;
    const e = (s.ledger ? s.ledger[j] : 90) + (s.mem ? s.mem[i][j] : 0);
    return Math.min(Math.max(e, 0), pool - mine);
  });
  const size = s.deckSize || 40, deckLeft = s.deck.length;
  let remain;
  if (size >= 40) remain = seen.map(x => Math.max(0, 4 - x));
  else if (!deckLeft) remain = seen.map(() => 0);
  else remain = expectedRemaining(size, seen);
  const active = []; P.forEach((p, j) => { if (!p.out) active.push(j); });
  return {
    me:i, n:P.length, active, out:P.map(p => !!p.out), herd, seen, remain, hand, money, pool,
    cards:P.map(p => p.money.length), deckLeft, deckSize:size, hidden:size < 40, mules:s.mules || 0,
    auction:a && { k:IDX[a.type], auctioneer:a.auctioneer, high:a.high, stage:a.stage },
    trade:tr && { a:tr.a, b:tr.b, k:IDX[tr.type], count:tr.count, offer:tr.a in tr.bids ? tr.bids[tr.a].length : null, ties:tr.ties || 0, tieAt:tr.tieAt ?? null },
    turn:s.turn, khs:(s.khs || []).map(([x, y, t]) => [x, y, IDX[t]]),
    // what happened so far; koehandel amounts only for deals this player was in
    hist:(s.hist || []).map(e => (e.t === 'k' && e.a !== i && e.b !== i ? { ...e, x:null, y:null, ca:null, cb:null } : e.t === 'a' && e.cs && e.P !== i && e.Q !== i ? { ...e, cs:null } : e)),
  };
}

// Smaller decks: which compositions (2-4 of each type, adding up to the deck size) fit what has been drawn so far.
// Every composition is equally likely up front; drawing s of a type that has c copies has weight c!/(c-s)!.
const comps = new Map(), post = new Map();
function compositions(size) {
  if (comps.has(size)) return comps.get(size);
  const out = [], cur = new Array(NT);
  const rec = (k, left) => {
    if (k === NT) { if (!left) out.push([...cur]); return; }
    for (let c = 2; c <= 4; c++) if (left - c >= 2 * (NT - k - 1) && left - c <= 4 * (NT - k - 1)) { cur[k] = c; rec(k + 1, left - c); }
  };
  rec(0, size); comps.set(size, out); return out;
}
export function expectedRemaining(size, seen) {
  const key = size + ':' + seen.join(',');
  if (post.has(key)) return post.get(key);
  const r = new Array(NT).fill(0); let W = 0;
  for (const c of compositions(size)) {
    let w = 1;
    for (let k = 0; k < NT && w; k++) { if (seen[k] > c[k]) w = 0; else for (let x = 0; x < seen[k]; x++) w *= c[k] - x; }
    if (!w) continue;
    W += w; for (let k = 0; k < NT; k++) r[k] += w * (c[k] - seen[k]);
  }
  const res = W ? r.map(x => x / W) : seen.map(() => 0);
  if (post.size > 2000) post.clear();
  post.set(key, res); return res;
}
// A random composition consistent with what was drawn (used to imagine the rest of a smaller deck).
export function sampleComposition(size, seen, rand) {
  const list = compositions(size), w = new Float64Array(list.length); let W = 0;
  list.forEach((c, i) => {
    let x = 1;
    for (let k = 0; k < NT && x; k++) { if (seen[k] > c[k]) x = 0; else for (let y = 0; y < seen[k]; y++) x *= c[k] - y; }
    w[i] = x; W += x;
  });
  let r = rand() * W;
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r < 0) return list[i]; }
  return list[list.length - 1];
}

// Mule money each player can still expect: the payouts of the mules not drawn yet (as many as are expected to remain).
export function muleMoneyLeft(o) {
  const left = o.remain[3]; let f = 0;
  for (let k = 0; k < 4 - (o.mules || 0); k++) f += MULE_PAY[(o.mules || 0) + k] * Math.min(1, Math.max(0, left - k));
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// The position model. For every animal type, each player's chance to end up with the whole set grows with the
// copies they hold (plus a share of the copies still to come) and with their money:
//   strength = (held + rho * remaining / players) ^ gamma * (money + mu) ^ delta,   chance = strength / total
// From those chances follows each player's expected score (sets x total value, as the real scoring), and a
// soft "probability to win" compares the expected scores: exp(E_i / tau) / sum_j exp(E_j / tau).
export class Model {
  constructor(o, th) {
    this.o = o; this.th = th;
    const n = o.n, m = Math.max(1, o.active.length);
    this.n = n; this.gamma = th.gamma; this.delta = th.delta; this.mu = th.mu + (th.kappa || 0) * (o.future || 0); // kappa: money still to come from mules counts too
    // muScale: the money offset in proportion to the money each player will have by the end (start money plus all
    // mule payouts), against the 940 of the full deck; smaller decks have fewer mules and much less money
    if (th.muScale) this.mu *= (o.pool / m + muleMoneyLeft(o)) / 940;
    this.alive = new Uint8Array(n); this.money = new Float64Array(n); this.herd = new Float64Array(n * NT);
    this.share = new Float64Array(NT);
    for (let j = 0; j < n; j++) { this.alive[j] = o.out[j] ? 0 : 1; this.money[j] = Math.max(0, o.money[j]); }
    for (let k = 0; k < NT; k++) {
      let limbo = 0; for (let j = 0; j < n; j++) if (o.out[j]) limbo += o.herd[j][k];
      this.share[k] = th.rho * (o.remain[k] + limbo) / m; // animals of players who left are free for anyone who owns that type
    }
    this.powTab = new Float64Array(NT * 6); // (held + share)^gamma for held = 0..5
    for (let k = 0; k < NT; k++) for (let h = 0; h < 6; h++) { const b = h + this.share[k]; this.powTab[k * 6 + h] = b > 0 ? Math.pow(b, th.gamma) : 0; }
    this.mfTab = new Float64Array(Math.ceil(o.pool / 10) + 2).fill(-1); // (money + mu)^delta per 10 of money
    this.bp = new Float64Array(n * NT); this.mf0 = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      if (!this.alive[j]) continue;
      for (let k = 0; k < NT; k++) { this.herd[j * NT + k] = o.herd[j][k]; this.bp[j * NT + k] = this.pow(o.herd[j][k], k); }
      this.mf0[j] = this.mfOf(this.money[j]);
    }
    this.mf = new Float64Array(n); this.E = new Float64Array(n); this.A = new Float64Array(n); this.B = new Float64Array(n); this.C = new Float64Array(n);
    this.sv = new Float64Array(8);
  }
  pow(h, k) { return this.powTab[k * 6 + (h > 5 ? 5 : h)]; }
  mfOf(m) {
    const i = m > 0 ? Math.round(m / 10) : 0, t = this.mfTab;
    if (i >= t.length) return Math.pow(i * 10 + this.mu, this.delta);
    return t[i] >= 0 ? t[i] : (t[i] = Math.pow(i * 10 + this.mu, this.delta));
  }
  // Utility (soft win chance) of player `me` after animal changes dh = [[player, type, +/-n], ...] (distinct
  // player/type pairs) and money changes dm = [[player, +/-amount], ...].
  util(me, dh, dm) {
    const n = this.n, bp = this.bp, mf = this.mf, alive = this.alive, E = this.E, A = this.A, B = this.B, C = this.C, sv = this.sv;
    for (let j = 0; j < n; j++) mf[j] = this.mf0[j];
    for (let i = 0; i < dm.length; i++) {
      const j = dm[i][0]; if (!alive[j]) continue;
      let m = this.money[j]; for (let x = 0; x < dm.length; x++) if (dm[x][0] === j) m += dm[x][1];
      mf[j] = this.mfOf(m);
    }
    for (let i = 0; i < dh.length; i++) {
      const j = dh[i][0], k = dh[i][1], h = this.herd[j * NT + k] + dh[i][2];
      sv[i] = bp[j * NT + k];
      bp[j * NT + k] = alive[j] ? this.pow(h > 0 ? h : 0, k) : 0;
    }
    for (let j = 0; j < n; j++) { A[j] = 0; B[j] = 0; C[j] = 0; }
    for (let k = 0; k < NT; k++) {
      let tot = 0; for (let j = 0; j < n; j++) tot += bp[j * NT + k] * mf[j];
      if (tot <= 0) continue;
      const v = VAL[k], inv = 1 / tot;
      for (let j = 0; j < n; j++) { const p = bp[j * NT + k] * mf[j] * inv; A[j] += p * v; B[j] += p; C[j] += p * p * v; }
    }
    for (let i = dh.length - 1; i >= 0; i--) bp[dh[i][0] * NT + dh[i][1]] = sv[i];
    let mean = 0, cnt = 0, mx = -Infinity;
    for (let j = 0; j < n; j++) if (alive[j]) { const e = A[j] * B[j] - C[j] + A[j]; E[j] = e; mean += e; cnt++; if (e > mx) mx = e; }
    const itau = 1 / (this.th.tau * (mean / (cnt || 1) + this.th.tau1));
    let z = 0, mine = 0;
    for (let j = 0; j < n; j++) if (alive[j]) { const e = Math.exp((E[j] - mx) * itau); z += e; if (j === me) mine = e; }
    return mine / z;
  }
}

// Largest multiple of 10 in [0, cap] where ok(p) still holds (ok is assumed to get worse as p grows); -10 if none.
function largest(cap, ok) {
  cap = Math.floor(cap / 10) * 10;
  if (cap < 0 || !ok(0)) return -10;
  if (ok(cap)) return cap;
  let lo = 0, hi = cap;
  while (hi - lo > 10) { const mid = Math.floor((lo + hi) / 20) * 10; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}
// Every amount (multiple of 10) that some subset of the hand adds up to, ascending.
export function sums(hand) {
  const tot = sum(hand) / 10, can = new Uint8Array(tot + 1); can[0] = 1;
  for (const c of hand) { const d = c / 10; if (d) for (let v = tot; v >= d; v--) if (can[v - d]) can[v] = 1; }
  const out = []; for (let v = 0; v <= tot; v++) if (can[v]) out.push(v * 10);
  return out;
}
// The amounts worth considering: every step of 10 up to `fine`, then about `ratio` apart (and the whole hand).
function candidates(hand, ratio = 1.08, fine = 100) {
  const all = sums(hand), out = [];
  for (const v of all) if (v <= fine || v >= out[out.length - 1] * ratio || v === all[all.length - 1]) out.push(v);
  return out;
}
const better = (x, y, margin) => x > y * (1 + margin); // utilities are probabilities: compare relatively

// ---------------------------------------------------------------------------------------------------------------
// Decisions. `th` holds the tuned parameters (lib/bots/params.json), M is a Model of the current position.

// The most this player would pay for the animal on auction.
export function bidLimit(o, th, M = new Model(o, th)) {
  const me = o.me, a = o.auction, k = a.k, A = a.auctioneer;
  const rivals = o.active.filter(j => j !== me && j !== A);
  let W = 0; const w = rivals.map(j => { const x = (o.herd[j][k] + th.eps) * (o.money[j] + 10); W += x; return x; });
  const lose = p => {
    if (!rivals.length) return M.util(me, [[A, k, 1]], []);
    let u = 0; for (let r = 0; r < rivals.length; r++) u += w[r] / W * M.util(me, [[rivals[r], k, 1]], [[rivals[r], -p], [A, p]]);
    return u;
  };
  const cap = largest(o.money[me], p => better(M.util(me, [[me, k, 1]], [[me, -p], [A, p]]), lose(p), th.mBid));
  return Math.max(0, Math.floor(cap * th.shade / 10) * 10);
}
// Auctioneer: buy the animal back at the highest bid instead of selling?
export function wantsToBuy(o, th, M = new Model(o, th)) {
  const me = o.me, a = o.auction, k = a.k, b = a.high.p, p = a.high.amt;
  if (o.money[me] < p) return false;
  return better(M.util(me, [[me, k, 1]], [[me, -p], [b, p]]), M.util(me, [[b, k, 1]], [[b, -p], [me, p]]), th.mDec);
}
// Chance that the other player beats an offer of x: they need more money than x, and must want to.
function beaten(o, th, j, x) {
  const m = o.money[j], sd = 0.25 * m + 15;
  return th.pc * normCdf((m - x - 5) / sd);
}
function normCdf(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
// How often these two players fought over this animal lately. Once the deck is empty a koehandel is compulsory,
// and with uneven holdings (say 2 against 1) the winner of a koehandel can just reverse them, forever. Only a win
// by the bigger holder ends it, so on a repeat the bigger holder plays to win and the smaller one lets go.
export const repeats = (o, a, b, k) => o.khs.filter(([x, y, t]) => t === k && ((x === a && y === b) || (x === b && y === a))).length;
const settling = (o, me, j, k) => (repeats(o, me, j, k) >= 2 ? Math.sign(o.herd[me][k] - o.herd[j][k]) : 0); // +1 win it, -1 let go
// The best offer (as an amount) in a koehandel against j for `count` animals of type k, and how good it looks.
export function bestOffer(o, th, M, j, k, count, floor = 0, rough = false) {
  const me = o.me, settle = settling(o, me, j, k);
  let best = null;
  for (const x of rough ? candidates(o.hand, 1.3, 20) : candidates(o.hand)) {
    if (x < floor || (settle < 0 && x > 0)) continue;
    const q = beaten(o, th, j, x), g = th.gap;
    if (settle > 0 && q > 0.3 && x < o.money[me] * 0.95) continue;
    // they win: they take my animals and pay me the difference (about `gap`)
    const ev = (1 - q) * M.util(me, [[me, k, count], [j, k, -count]], [[me, -x], [j, x]]) + q * M.util(me, [[me, k, -count], [j, k, count]], [[me, g], [j, -g]]);
    if (!best || ev > best.ev) best = { x, ev };
  }
  return best;
}
// Pick the cards for an offer of x: exactly x with the fewest cards, padded with 0s to bluff about the amount.
export function offerCards(o, th, x) {
  const cards = x > 0 ? cheapest(o.hand, x) : [];
  const zeros = o.hand.filter(c => c === 0).length - cards.filter(c => c === 0).length;
  for (let z = Math.round(th.pad * zeros); z > 0; z--) cards.push(0);
  return cards;
}
// Turn: auction, or the koehandel that looks best?
export function chooseTurn(o, th, M = new Model(o, th), opts = targetsOf(o)) {
  const me = o.me;
  let best = null;
  if (o.deckLeft) best = { v:M.util(me, [], [[me, th.aucM * o.pool / Math.max(1, o.active.length) / 4]]), act:{ type:'auction' } };
  for (const t of opts) {
    let v;
    if (o.out[t.p]) v = M.util(me, [[me, t.k, t.count], [t.p, t.k, -t.count]], []) * 2; // free animals: take them
    else v = bestOffer(o, th, M, t.p, t.k, t.count, 0, true).ev * (1 + th.khBias) * (1 - 0.1 * repeats(o, me, t.p, t.k));
    if (!best || v > best.v) best = { v, act:{ type:'koehandel', target:t.p, animal:TYPES[t.k] } };
  }
  return best && best.act;
}
export function targetsOf(o) {
  const out = [], me = o.me;
  if (o.out[me]) return out;
  for (let j = 0; j < o.n; j++) if (j !== me) for (let k = 0; k < NT; k++) {
    const a = o.herd[me][k], b = o.herd[j][k];
    if (a && b) out.push({ p:j, k, count:Math.min(a, b) });
  }
  return out;
}
// What the attacker probably offered, given how many cards they put down: a few spread-out guesses.
const GUESS = [[0.3, 0.15], [0.65, 0.2], [1, 0.3], [1.45, 0.2], [2.1, 0.15]];
function offerGuesses(o, th, a, n) {
  if (!n) return [[0, 1]];
  const avg = o.money[a] / Math.max(1, o.cards[a]), mean = Math.min(o.money[a], n * avg * th.phi);
  const floor = o.trade.tieAt != null ? o.trade.tieAt : 0;
  return GUESS.map(([r, w]) => [Math.max(floor, Math.min(o.money[a], Math.round(mean * r / 10) * 10)), w]);
}
// Defender: accept the offer (return null) or the amount to counter with.
export function counterAmount(o, th, M = new Model(o, th)) {
  const me = o.me, tr = o.trade, a = tr.a, k = tr.k, c = tr.count, guesses = offerGuesses(o, th, a, tr.offer);
  let acc = 0;
  for (const [x, w] of guesses) acc += w * M.util(me, [[me, k, -c], [a, k, c]], [[me, x], [a, -x]]);
  let best = null;
  for (const y of candidates(o.hand)) {
    if (y <= 0) continue;
    let ev = 0;
    for (const [x, w] of guesses) {
      // the higher offer takes the other's animals, and the offers swap hands
      if (y > x) ev += w * M.util(me, [[me, k, c], [a, k, -c]], [[me, x - y], [a, y - x]]);
      else if (y < x) ev += w * M.util(me, [[me, k, -c], [a, k, c]], [[me, x - y], [a, y - x]]);
      else ev += w * (tr.ties ? M.util(me, [[me, k, -c], [a, k, c]], []) : 0.5 * (M.util(me, [[me, k, c], [a, k, -c]], []) + M.util(me, [[me, k, -c], [a, k, c]], [[me, x], [a, -x]])));
    }
    if (!best || ev > best.ev) best = { y, ev };
  }
  const settle = settling(o, me, a, k);
  if (settle < 0) return null;
  if (settle > 0) { const top = Math.max(...guesses.map(g => g[0])); return candidates(o.hand).find(y => y > top) ?? (best ? best.y : null); }
  return best && better(best.ev, acc, th.mResp) ? best.y : null;
}

// Default parameters (overridden by the tuned ones in params.json).
export const DEFAULTS = { rho:1, gamma:1.6, delta:0.35, mu:30, tau:0.35, tau1:50, eps:0.3, mBid:0.0, shade:1, mDec:0.0, aucM:1, khBias:0, pc:0.7, gap:20, pad:0.3, phi:1.3, mResp:0.0 };
