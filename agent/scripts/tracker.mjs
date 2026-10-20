// Experiment (not used by the bots, see agent/README.md): card tracking. Which money cards might each other player hold? A few hundred guesses ("particles"), each a full
// set of hands for the other players, replayed through everything that happened: start money, mule payouts, auction
// payments (how many cards changed hands is public, the amount at least the price), bids (a bidder had at least
// that much), koehandels (how many cards each side put down and who won; the exact cards for the two players in
// it). Guesses that fit what happened badly lose weight and are replaced by copies of better ones. This is how a
// card counter at the table would reason, done carefully.
import { START_MONEY } from '../../lib/rules.js';

const K = 160, TILT = +(process.env.TILT ?? 1.5);
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
// Replays the history for viewer i. Returns null when exact tracking is not possible (someone left, history cut).
export function track(s, o) {
  const i = o.me, hist = o.hist || [], n = o.n;
  if (s.histCut || hist.some(e => e.t === 'x') || !s.ledger) return null;
  let byViewer = cache.get(s); if (!byViewer) cache.set(s, (byViewer = new Map()));
  let st = byViewer.get(i);
  if (!st || st.len > hist.length) {
    const rand = mulberry(((s.seed | 0) ^ (i * 0x9e3779b1)) >>> 0);
    st = { len: 0, rand, w: new Float64Array(K).fill(1), P: Array.from({ length: K }, () => Array.from({ length: n }, (_, j) => (j === i ? null : [...START_MONEY]))) };
    byViewer.set(i, st);
  }
  for (; st.len < hist.length; st.len++) step(st, hist[st.len], i, n);
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
  const { P, w, rand } = st;
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
    const tie = nb != null && e.x != null && e.x === e.y;
    for (let k = 0; k < K; k++) {
      const h = P[k];
      if (a === i || b === i) { // my own deal: the other side's cards are known
        const other = a === i ? b : a, theirs = a === i ? e.cb : e.ca, mine = a === i ? e.ca : e.cb;
        if (nb == null) { if (a === i) h[b].push(...e.ca); else if (!take(h[a], e.ca)) w[k] *= 0.02; continue; }
        if (tie) continue;
        if (!take(h[other], theirs)) w[k] *= 0.02;
        h[other].push(...mine);
        continue;
      }
      // someone else's deal: guess the offers, keep guesses that fit who won
      // offers are not random: attackers mostly aim near what the defender can pay, so a guess is weighted by how
      // close its offer comes to that
      let found = null, acc = 0, tries = 0;
      const avgA = total(h[a]) / Math.max(1, h[a].length), avgB = total(h[b]) / Math.max(1, h[b].length);
      for (let t = 0; t < 16; t++) {
        const xa = pick(h[a], Math.min(na, h[a].length), rand), xb = nb == null ? null : pick(h[b], Math.min(nb, h[b].length), rand);
        const sa = total(xa), sb = xb ? total(xb) : -1;
        tries++;
        const fits = nb == null || (win === a ? sa >= sb : sb > sa);
        if (!fits) continue;
        const q = Math.exp(-TILT * sa / (avgA * xa.length + 10) - (xb ? TILT * sb / (avgB * xb.length + 10) : 0));
        acc += q; if (rand() < q / acc) found = [xa, xb, sa === sb];
      }
      if (!found) { w[k] *= 0.01; continue; }
      w[k] *= Math.max(0.03, acc / tries);
      const [xa, xb, eq] = found;
      if (nb == null) { take(h[a], xa); h[b].push(...xa); }
      else if (!eq) { take(h[a], xa); take(h[b], xb); h[a].push(...xb); h[b].push(...xa); }
    }
    resample(st);
  }
}
// When a few guesses carry most of the weight, replace the rest by copies of the good ones.
function resample(st) {
  const { w, rand } = st;
  let W = 0, W2 = 0; for (const x of w) { W += x; W2 += x * x; }
  if (!(W > 0)) return;
  if (W * W / W2 > K / 2) return;
  const P = st.P, out = [], u0 = rand() / K;
  let acc = w[0] / W, k = 0;
  for (let c = 0; c < K; c++) { const u = u0 + c / K; while (u > acc && k < K - 1) { k++; acc += w[k] / W; } out.push(P[k].map(h => (h ? h.slice() : h))); }
  st.P = out; w.fill(1);
}
