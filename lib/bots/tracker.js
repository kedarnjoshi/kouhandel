// Card tracking (Insane, th.track; see agent/README.md). Which money cards might each other player hold? A few hundred guesses ("particles"), each a full
// set of hands for the other players, replayed through everything that happened: start money, mule payouts, auction
// payments (how many cards changed hands is public, the amount at least the price), bids (a bidder had at least
// that much), koehandels (how many cards each side put down and who won; the exact cards for the two players in
// it). Guesses that fit what happened badly lose weight and are replaced by copies of better ones. This is how a
// card counter at the table would reason, done carefully.
import { START_MONEY } from '../rules.js';

// The tracker's settings (scripts may change them for experiments): guesses, how much high offers are discounted and
// the least weight any offer keeps, and whether a set of cards counts by the number of card choices that make it.
// BOLD, BOLDH, BOLDN, BOLDAT: how likely a player is to put down most of what they could, before seeing any of their
// offers (BOLDH for people: everyone at the table sees who is a bot, and people offered 79% of their money on average
// in the logged games, the bots 39%), how many offers that guess counts as, and the share of their money that makes
// an offer they were seen to make a bold one. sums: every total a side could put down counts once, however many sets
// of cards make it (a player picks an amount, then cards for it), instead of every distinct set of cards counting once.
export const TRACKER = { K: 400, TILT: 1.5, FLOOR: 0.05, choices: false, BOLD: 0, BOLDH: 0.7, BOLDN: 2, BOLDAT: 0.6, sums: true };
const total = h => { let t = 0; for (const c of h) t += c; return t; };
// Remove cards from a guessed hand; a card the guess does not have is replaced by its closest one (the guess was
// wrong there, the caller lowers its weight), so the number of cards always stays right.
const take = (h, cards) => {
  let ok = true;
  for (const c of cards) {
    let x = h.indexOf(c);
    if (x < 0) { ok = false; let bd = Infinity; h.forEach((v, y) => { const d = Math.abs(v - c); if (d < bd) { bd = d; x = y; } }); }
    if (x >= 0) h.splice(x, 1);
  }
  return ok;
};
function mulberry(seed) { return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// m random cards of a hand (indices), as a new array of values
function pick(h, m, rand) {
  const idx = h.map((_, x) => x);
  for (let x = 0; x < m; x++) { const y = x + Math.floor(rand() * (idx.length - x)); [idx[x], idx[y]] = [idx[y], idx[x]]; }
  return idx.slice(0, m).map(x => h[x]);
}
// Every distinct way to take m cards from a hand: [cards, number of card choices that give them].
function subsets(h, m) {
  const vals = [], cnt = [];
  for (const c of [...h].sort((x, y) => x - y)) { if (vals.length && vals[vals.length - 1] === c) cnt[cnt.length - 1]++; else { vals.push(c); cnt.push(1); } }
  const out = [], cur = [];
  const choose = (n, r) => { let x = 1; for (let t = 0; t < r; t++) x = x * (n - t) / (t + 1); return x; };
  const rec = (v, left, mult) => {
    if (v === vals.length) { if (!left) out.push([cur.slice(), mult]); return; }
    for (let t = 0; t <= Math.min(cnt[v], left); t++) { for (let u = 0; u < t; u++) cur.push(vals[v]); rec(v + 1, left - t, mult * choose(cnt[v], t)); cur.length -= t; }
  };
  rec(0, m, 1);
  return out;
}
// The same sets grouped by their total, ascending: { s, sets: [[cards, weight]], W } (weight 1 each, or the number of
// card choices with TRACKER.choices).
function bySum(h, m) {
  const g = new Map();
  for (const [x, c] of subsets(h, m)) {
    const s = total(x), u = TRACKER.choices ? c : 1;
    let e = g.get(s); if (!e) g.set(s, (e = { s, sets: [], W: 0 }));
    e.sets.push([x, u]); e.W += u;
  }
  const out = [...g.values()].sort((x, y) => x.s - y.s);
  for (const e of out) e.Q = TRACKER.sums ? 1 : e.W; // the group's weight as an offer
  return out;
}
// one set of a group, by weight
function pickSet(e, rand) { let r = rand() * e.W; for (const [x, u] of e.sets) { r -= u; if (r <= 0) return x; } return e.sets[e.sets.length - 1][0]; }
// The m cards a payer most likely used for a price: covering it with as little overpayment as possible.
function payWith(h, m, p) {
  if (m >= h.length) return h.slice();
  const s = [...h].sort((a, b) => a - b);
  let best = null;
  const rec = (start, left, acc, cur) => {
    if (!left) { if (acc >= p && (!best || acc < best.sum)) best = { sum: acc, cards: cur.slice() }; return; }
    for (let x = start; x <= s.length - left; x++) { if (x > start && s[x] === s[x - 1]) continue; cur.push(s[x]); rec(x + 1, left - 1, acc + s[x], cur); cur.pop(); if (best && best.sum === p) return; }
  };
  if (m <= 6 && s.length <= 22) rec(0, m, 0, []);
  if (!best) { // too many combinations to look at: greedy from the largest
    const d = s.slice().reverse(); return d.slice(0, m);
  }
  return best.cards;
}

const cache = new WeakMap();
// Who is a person: at a live table the bots are marked and everyone else is a person; simulated games mark nobody
// (s.people may say it outright, as a replay of a logged game does).
export const people = s => s.people || (s.players.some(p => p.bot) ? s.players.map(p => !p.bot) : s.players.map(() => false));
// Replays the history for viewer i. Returns null when exact tracking is not possible (someone left, history cut).
export function track(s, o) {
  const i = o.me, hist = o.hist || [], n = o.n;
  const K = TRACKER.K;
  if (s.histCut || hist.some(e => e.t === 'x') || !s.ledger) return null;
  let byViewer = cache.get(s); if (!byViewer) cache.set(s, (byViewer = new Map()));
  let st = byViewer.get(i);
  if (!st || st.len > hist.length) {
    const rand = mulberry(((s.seed | 0) ^ (i * 0x9e3779b1)) >>> 0);
    st = { len: 0, rand, w: new Float64Array(K).fill(1), seen: new Array(n).fill(0), bold: new Array(n).fill(0), person: people(s), P: Array.from({ length: K }, () => Array.from({ length: n }, (_, j) => (j === i ? null : [...START_MONEY]))) };
    byViewer.set(i, st);
  }
  for (; st.len < hist.length; st.len++) step(st, hist[st.len], i, n);
  if (st.lost) return null; // fall back on the ledger rather than trust a certainty that is wrong
  // the guesses must agree with the card counts everyone can see
  let W = 0;
  for (let k = 0; k < K; k++) { for (let j = 0; j < n; j++) if (j !== i && st.P[k][j].length !== o.cards[j]) st.w[k] = 0; W += st.w[k]; }
  if (!(W > 0)) { byViewer.delete(i); return null; }
  const mean = new Array(n).fill(0), sd = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    let m = 0, m2 = 0;
    for (let k = 0; k < K; k++) { const t = total(st.P[k][j]), w = st.w[k] / W; m += w * t; m2 += w * t * t; }
    mean[j] = m; sd[j] = Math.sqrt(Math.max(0, m2 - m * m));
  }
  return {
    mean, sd,
    // count hands of player j drawn from the guesses (by weight), each { hand, w }
    hands(j, count, rand) {
      const out = [];
      for (let c = 0; c < count; c++) { let r = rand() * W, k = 0; for (; k < K - 1; k++) { r -= st.w[k]; if (r <= 0) break; } out.push({ hand: st.P[k][j].slice(), w: 1 / count }); }
      return out;
    },
  };
}

function step(st, e, i, n) {
  const { P, w, rand } = st, K = P.length;
  if (e.t === 'm') { for (const j of e.to) if (j !== i) for (const h of P) h[j].push(e.amt); return; }
  if (e.t === 'a') {
    // bidders had at least their highest bid
    for (const js in e.mx || {}) { const j = +js; if (j === i) continue; for (let k = 0; k < K; k++) if (total(P[k][j]) < e.mx[js]) w[k] *= 0.02; }
    if (e.m == null) return;
    const { P: payer, Q: payee, m, p } = e;
    for (let k = 0; k < K; k++) {
      const h = P[k];
      if (payer === i) { if (payee !== i) h[payee].push(...e.cs); }
      else if (payee === i) { if (!take(h[payer], e.cs)) w[k] *= 0.02; }
      else { const cs = payWith(h[payer], m, p); if (total(cs) < p) w[k] *= 0.02; take(h[payer], cs); h[payee].push(...cs); }
    }
    resample(st);
    return;
  }
  if (e.t === 'k') {
    const { a, b, na, nb, win } = e;
    const tie = nb != null && e.x != null && e.x === e.y, memo = new Map(), mine = a === i || b === i;
    let kept = 0; // guesses that agree with the cards I saw change hands in my own deal
    if (mine) { // an offer I saw: was it bold (most of that player's money, as my guesses have it)?
      const j = a === i ? b : a, x = a === i ? (nb == null ? null : e.y) : e.x;
      if (x != null) { let m = 0, W = 0; for (let k = 0; k < K; k++) { m += w[k] * total(P[k][j]); W += w[k]; } st.seen[j]++; if (x >= TRACKER.BOLDAT * Math.max(10, m / W)) st.bold[j]++; }
    }
    const boldness = j => ((st.person[j] ? TRACKER.BOLDH : TRACKER.BOLD) * TRACKER.BOLDN + st.bold[j]) / (TRACKER.BOLDN + st.seen[j]);
    for (let k = 0; k < K; k++) {
      const h = P[k];
      if (a === i || b === i) { // my own deal: the other side's cards are known
        const other = a === i ? b : a, theirs = a === i ? e.cb : e.ca, mine = a === i ? e.ca : e.cb;
        if (nb == null) { if (a === i) { h[b].push(...e.ca); kept++; } else if (!take(h[a], e.ca)) w[k] *= 0.02; else kept++; continue; }
        if (tie) { kept++; continue; }
        if (!take(h[other], theirs)) w[k] *= 0.02; else kept++;
        h[other].push(...mine);
        continue;
      }
      // someone else's deal: every distinct set of cards each side could have put down (players pick an amount and the
      // cards that make it, not random cards, so each set counts once), kept where it fits who won. A pair of sets is
      // weighted down by how high its offers come (TILT), but never below FLOOR, so an all-in offer always stays
      // possible; for a bold player (boldness) partly by how close it comes to the most they could put down instead.
      // The weight only depends on the two totals, so the sets are grouped by total and the pairs that fit
      // (b's total at most a's when a won, above it when b won) are summed per group of a: linear rather than every pair.
      const key = h[a].join(',') + '|' + h[b].join(',');
      let ways = memo.get(key);
      if (!ways) ways = kWays(h[a], h[b], na, nb, win === a, boldness(a), nb == null ? 0 : boldness(b)), memo.set(key, ways);
      if (!ways.any) { w[k] *= 0.01; continue; }
      w[k] *= Math.max(0.03, ways.fit / ways.all);
      const { A, B, gw, eb, lo, hi } = ways;
      let r = rand() * ways.fit, g = ways.last;
      for (let x = 0; x < A.length; x++) { if (!(gw[x] > 0)) continue; r -= gw[x]; if (r <= 0) { g = x; break; } }
      let t = -1;
      if (B) {
        const ea = ways.ea[g]; let tw = 0;
        for (let y = lo[g]; y < hi[g]; y++) tw += B[y].Q * (TRACKER.FLOOR + ea * eb[y]);
        let r2 = rand() * tw; t = hi[g] - 1;
        for (let y = lo[g]; y < hi[g]; y++) { r2 -= B[y].Q * (TRACKER.FLOOR + ea * eb[y]); if (r2 <= 0) { t = y; break; } }
      }
      const xa = pickSet(A[g], rand);
      if (!B) { take(h[a], xa); h[b].push(...xa); }
      else { const xb = pickSet(B[t], rand); if (A[g].s !== B[t].s) { take(h[a], xa); take(h[b], xb); h[a].push(...xb); h[b].push(...xa); } }
    }
    if (mine && !kept) st.lost = true; // every guess contradicts a deal I saw: the tracker has lost the truth
    resample(st);
  }
}
// The possible offers in someone else's koehandel for one pair of guessed hands (see step): the groups of a's and b's
// sets by total, each group of a's weight over the b groups that fit (lo..hi), and in all. ba, bb: their boldness.
const offerW = (sets, s, scale, bold) => (1 - bold) * Math.exp(-TRACKER.TILT * s / scale) + bold * Math.exp(-TRACKER.TILT * (sets[sets.length - 1].s - s) / scale);
function kWays(ha, hb, na, nb, aWon, ba, bb) {
  const la = Math.min(na, ha.length), avgA = total(ha) / Math.max(1, ha.length), A = bySum(ha, la);
  const ea = A.map(e => offerW(A, e.s, avgA * la + 10, ba)), gw = new Array(A.length).fill(0);
  const lo = new Array(A.length).fill(0), hi = new Array(A.length).fill(0);
  let B = null, eb = null, WA = 0, fit = 0, any = false, last = 0;
  for (const e of A) WA += e.Q;
  if (nb == null) {
    for (let x = 0; x < A.length; x++) { gw[x] = A[x].Q * (TRACKER.FLOOR + ea[x]); fit += gw[x]; last = x; }
    return { A, B, ea, eb, gw, lo, hi, fit, all: WA, any: A.length > 0, last };
  }
  const lb = Math.min(nb, hb.length), avgB = total(hb) / Math.max(1, hb.length);
  B = bySum(hb, lb); eb = B.map(e => offerW(B, e.s, avgB * lb + 10, bb));
  const PW = [0], PE = [0]; // prefix sums over b's groups: sets, and sets weighted by their offer
  for (let y = 0; y < B.length; y++) { PW.push(PW[y] + B[y].Q); PE.push(PE[y] + B[y].Q * eb[y]); }
  const nB = B.length; let c = 0;
  for (let x = 0; x < A.length; x++) {
    while (c < nB && B[c].s <= A[x].s) c++; // b's groups with a total at most a's
    lo[x] = aWon ? 0 : c; hi[x] = aWon ? c : nB;
    const fw = PW[hi[x]] - PW[lo[x]], fe = PE[hi[x]] - PE[lo[x]];
    gw[x] = A[x].Q * (TRACKER.FLOOR * fw + ea[x] * fe); fit += gw[x];
    if (fw > 0) any = true, last = x;
  }
  return { A, B, ea, eb, gw, lo, hi, fit, all: WA * PW[nB], any, last };
}
// When a few guesses carry most of the weight, replace the rest by copies of the good ones.
function resample(st) {
  const { w, rand } = st, K = w.length;
  let W = 0, W2 = 0; for (const x of w) { W += x; W2 += x * x; }
  if (!(W > 0)) return;
  if (W * W / W2 > K / 2) return;
  const P = st.P, out = [], u0 = rand() / K;
  let acc = w[0] / W, k = 0;
  for (let c = 0; c < K; c++) { const u = u0 + c / K; while (u > acc && k < K - 1) { k++; acc += w[k] / W; } out.push(P[k].map(h => (h ? h.slice() : h))); }
  st.P = out; w.fill(1);
}
