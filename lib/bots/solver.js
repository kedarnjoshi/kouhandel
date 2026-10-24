// Koehandel as a game of hidden hands, solved approximately. The attacker's possible hands ("types") and the
// defender's possible hands are sampled; fictitious play then finds strategies where each side answers the other
// well: for every attacker hand a mix of offers (amount and number of cards), for every defender hand and number of
// cards seen a mix of answers (accept or a counter). A defender that answers this way cannot be milked by a pile of
// zeros, and an attacker that offers this way gives little away by the number of cards it puts down.
const NEG = -1;

// For a hand: which (amount, number of cards) pairs it can put down. reach[v] = bitmask of card counts that make v*10.
function reachable(hand) {
  const tot = hand.reduce((a, b) => a + b, 0) / 10, reach = new Uint32Array(tot + 1); reach[0] = 1;
  for (const c of hand) {
    const d = c / 10;
    for (let v = tot; v >= d; v--) if (reach[v - d]) reach[v] |= (reach[v - d] << 1) >>> 0;
  }
  return reach;
}
// The cards that make exactly v*10 with n cards (or null).
export function cardsFor(hand, x, n) {
  const h = [...hand].sort((a, b) => b - a), V = x / 10;
  // dp over cards: can[i][v][c] whether the first i cards can make v with c cards; reconstruct backwards
  const C = h.length, key = (v, c) => v * (C + 1) + c, can = [new Uint8Array((V + 1) * (C + 1))];
  can[0][key(0, 0)] = 1;
  for (let i = 0; i < C; i++) {
    const prev = can[i], cur = prev.slice(), d = h[i] / 10;
    for (let v = V; v >= d; v--) for (let c = 1; c <= i + 1; c++) if (prev[key(v - d, c - 1)]) cur[key(v, c)] = 1;
    can.push(cur);
  }
  if (!can[C][key(V, n)]) return null;
  const out = []; let v = V, c = n;
  for (let i = C; i > 0; i--) {
    if (can[i - 1][key(v, c)]) continue;
    out.push(h[i - 1]); v -= h[i - 1] / 10; c--;
  }
  return out;
}
// Amounts worth considering, in units of 10: every step up to `fine`, then about `ratio` apart, and the maximum.
function grid(vals, fine = 20, ratio = 1.1) {
  const out = [];
  for (const v of vals) if (v <= fine || !out.length || v >= out[out.length - 1] * ratio || v === vals[vals.length - 1]) out.push(v);
  return out;
}

// aTypes, bTypes: [{ hand, w }] (weights sum to 1). UA, UB: { win(d), lose(d) } utilities of the attacker and the
// defender by the money (in coins, multiples of 10) they receive net, "win" = that player gets the animals.
// ties: a tie now gives the attacker the animals (second tie); floor: the defender knows the offer is at least this.
// habit: optional (n => [[x in units of 10, p], ...]) what this attacker's past offers suggest for n cards, mixed into the
// defender's reading with weight habitW. answers: the same for this defender's past answers (n => [[y or -1, p], ...]),
// mixed into the attacker's prediction of the answer with weight answersW.
export function solve({ aTypes, bTypes, UA, UB, ties = false, floor = 0, iters = 40, eps = 0.06, maxN = 30, habit = null, habitW = 0, answers = null, answersW = 0, maxPad = 5 }) {
  let X = 0; for (const t of [...aTypes, ...bTypes]) X = Math.max(X, t.hand.reduce((a, b) => a + b, 0) / 10);
  // utility tables by net money (units of 10) for the attacker: d in [-X, X]
  // (exact for swings up to 300, interpolated in between further out: the utility is smooth in money)
  const knots = []; for (let d = 0; d <= X; d = d < 30 ? d + 1 : Math.min(X, Math.max(d + 1, Math.round(d * 1.08)))) { knots.push(d); if (d === X) break; }
  const tab = f => {
    const a = new Float64Array(2 * X + 1);
    for (const sg of [1, -1]) {
      let pd = null, pv = 0;
      for (const d of knots) {
        const v = f(sg * d * 10); a[sg * d + X] = v;
        if (pd !== null && d - pd > 1) for (let e = pd + 1; e < d; e++) a[sg * e + X] = pv + (v - pv) * (e - pd) / (d - pd);
        pd = d; pv = v;
      }
    }
    return a;
  };
  const aW = tab(UA.win), aL = tab(UA.lose), bW = tab(UB.win), bL = tab(UB.lose);
  const aTie = ties ? aW[X] : 0.5 * (aW[X] + aL[X]), bTie = ties ? bL[X] : 0.5 * (bW[X] + bL[X]);
  // value of an outcome: offer x, answer y (-1 = accept), in units of 10
  const vA = (x, y) => (y < 0 ? aW[X - x] : y > x ? aL[X + y - x] : y < x ? aW[X + y - x] : aTie);
  const vB = (x, y) => (y < 0 ? bL[X + x] : y > x ? bW[X + x - y] : y < x ? bL[X + x - y] : bTie);
  // attacker actions per type: (x, n) pairs, x on a grid (offers below the floor are not allowed after a tie)
  let N = 0;
  const A = aTypes.map(t => {
    const r = reachable(t.hand), xs = [];
    for (let v = 0; v < r.length; v++) if (r[v]) xs.push(v);
    const acts = [];
    for (const x of grid(xs)) {
      if (x * 10 < floor) continue;
      let kept = 0; // per amount, the few smallest card counts (more padding than that is rarely worth considering)
      for (let n = 0; n <= Math.min(maxN, t.hand.length) && kept < maxPad; n++) if ((r[x] >>> n) & 1) { acts.push([x, n]); kept++; if (n > N) N = n; }
    }
    if (!acts.length) { const n = Math.min(maxN, t.hand.length); acts.push([xs[xs.length - 1], n]); if (n > N) N = n; }
    return { w: t.w, acts, cnt: new Float64Array(acts.length).fill(1 / acts.length), tot: 1, anyN: anyBelief(t.hand, maxN), sumV: new Float64Array(acts.length) };
  });
  // defender answers: accept (-1) or a counter on a grid. What an answer is worth depends only on the amount, not on
  // the hand it comes from, so the answers of all defender types are worked out together over the union of their
  // amounts; each type then picks the best of the ones it can make.
  const U = [NEG], uOf = new Map([[NEG, 0]]);
  const B = bTypes.map(t => {
    const r = reachable(t.hand), ys = [];
    for (let v = 1; v < r.length; v++) if (r[v]) ys.push(v);
    const idx = [0];
    for (const y of grid(ys)) { if (!uOf.has(y)) { uOf.set(y, U.length); U.push(y); } idx.push(uOf.get(y)); }
    return { w: t.w, idx };
  });
  // the actions with n cards, per attacker type
  const byN = A.map(a => { const g = Array.from({ length: N + 1 }, () => []); a.acts.forEach(([, n], i) => g[n].push(i)); return g; });
  // the defender reasons on a grid of amounts: offers in one grid cell (exact up to 200, then about 10% apart) are
  // taken together at their average
  const G = grid(Array.from({ length: X + 1 }, (_, v) => v)), snap = new Int32Array(X + 1);
  for (let v = 0, gi = 0; v <= X; v++) { while (gi + 1 < G.length && G[gi + 1] <= v) gi++; snap[v] = gi; }
  // the fixed "any cards" part of the posterior, per n
  const anyP = Array.from({ length: N + 1 }, () => new Float64Array(G.length)), anyX = Array.from({ length: N + 1 }, () => new Float64Array(G.length));
  for (const a of A) for (let n = 0; n <= N; n++) { const any = a.anyN[n]; if (any) for (const [x, p] of any) if (x * 10 >= floor) { anyP[n][snap[x]] += a.w * eps * p; anyX[n][snap[x]] += a.w * eps * p * x; } }
  if (habit && habitW > 0) for (let n = 0; n <= N; n++) for (const [x0, p] of habit(n)) { const x = Math.min(X, Math.max(Math.ceil(floor / 10), x0)); anyP[n][snap[x]] += habitW * p; anyX[n][snap[x]] += habitW * p * x; }
  // (the loops below run thousands of times per decision: flat arrays, nothing allocated, and every sum taken in
  // the same order as the plain version, so the results stay exactly the same)
  const ax = A.map(a => Int32Array.from(a.acts, ([x]) => x)), an = A.map(a => Int32Array.from(a.acts, ([, n]) => n));
  const px = new Float64Array(G.length), pxx = new Float64Array(G.length), postX = new Float64Array(G.length), postP = new Float64Array(G.length);
  let postLen = 0;
  // posterior over the offer amount given n cards, into postX / postP (postLen entries)
  const post = n => {
    if (n <= N) { px.set(anyP[n]); pxx.set(anyX[n]); } else { px.fill(0); pxx.fill(0); }
    if (n <= N) for (let m = 0; m < A.length; m++) { const a = A[m], f = a.w * (1 - eps) / a.tot, ids = byN[m][n], xs = ax[m]; for (let q = 0; q < ids.length; q++) { const i = ids[q], x = xs[i], g = snap[x], c = f * a.cnt[i]; px[g] += c; pxx[g] += c * x; } }
    let tot = 0; for (let g = 0; g < px.length; g++) tot += px[g];
    postLen = 0;
    if (!tot) { postX[0] = Math.min(X, Math.max(floor / 10, n * 2)); postP[0] = 1; postLen = 1; return; }
    for (let g = 0; g < G.length; g++) if (px[g] > 0) { postX[postLen] = Math.round(pxx[g] / px[g]); postP[postLen++] = px[g] / tot; }
  };
  const posterior = n => { post(n); const out = []; for (let i = 0; i < postLen; i++) out.push([postX[i], postP[i]]); return out; };
  // what each answer in ys is worth to the defender against the posterior in postX / postP
  const worth = (ys, E) => { for (let u = 0; u < ys.length; u++) { const y = ys[u]; let v = 0; for (let i = 0; i < postLen; i++) v += postP[i] * vB(postX[i], y); E[u] = v; } return E; };
  const E = new Float64Array(U.length), Rt = new Float64Array(N + 1); // Rt[n]: rounds of answers to n cards so far
  const ansCache = new Map(), ans = n => { if (!ansCache.has(n)) ansCache.set(n, answers(n)); return ansCache.get(n); };
  // what each attacker action earns against the defender's average answers so far: sumV keeps the running total
  // (the answers added each round are folded in as they come, see below), divided by the number of rounds
  const value = (m, i) => {
    const a = A[m], n = an[m][i];
    let v = Rt[n] ? a.sumV[i] / Rt[n] : 0;
    if (answers && answersW > 0) { let h = 0; for (const [y, p] of ans(n)) h += p * vA(ax[m][i], y < 0 ? NEG : Math.min(X, y)); v = (1 - answersW) * v + answersW * h; }
    return v;
  };
  const valueOf = a => { const m = A.indexOf(a); return a.acts.map((_, i) => value(m, i)); };
  // fictitious play. The posterior for a number of cards no attacker type has played yet is the fixed "any cards"
  // part, so the defender's answers to it only need working out once.
  const last = Array.from({ length: N + 1 }, () => new Int32Array(B.length)), seen = new Uint8Array(N + 1), played = new Uint8Array(N + 1);
  const addU = new Int32Array(B.length), addW = new Float64Array(B.length); // this round's answers, with the weight of the types giving them
  for (let it = 1; it <= iters; it++) {
    for (let n = 0; n <= N; n++) {
      const ln = last[n];
      if (played[n] || !seen[n]) {
        post(n); worth(U, E); seen[n] = 1;
        for (let bi = 0; bi < B.length; bi++) { const idx = B[bi].idx; let best = idx[0]; for (let q = 0; q < idx.length; q++) { const u = idx[q]; if (E[u] > E[best] + 1e-12) best = u; } ln[bi] = best; }
      }
      let na = 0;
      for (let bi = 0; bi < B.length; bi++) { const u = ln[bi]; let z = 0; while (z < na && addU[z] !== u) z++; if (z === na) { addU[na] = u; addW[na++] = B[bi].w; } else addW[z] += B[bi].w; }
      Rt[n] += 1;
      for (let m = 0; m < A.length; m++) {
        const sumV = A[m].sumV, ids = byN[m][n], xs = ax[m];
        for (let q = 0; q < ids.length; q++) { const i = ids[q], x = xs[i]; let v = 0; for (let z = 0; z < na; z++) v += addW[z] * vA(x, U[addU[z]]); sumV[i] += v; }
      }
    }
    for (let m = 0; m < A.length; m++) {
      const a = A[m]; let bi = 0, bv = value(m, 0);
      for (let i = 1; i < a.acts.length; i++) { const v = value(m, i); if (v > bv) { bv = v; bi = i; } }
      a.cnt[bi]++; a.tot++; played[an[m][bi]] = 1;
    }
  }
  if (globalThis.DBG_SOLVE) globalThis.DBG_SOLVE({ X, aTypes, bTypes, aW, aL, bW, bL, ties, floor, iters, eps, maxN, maxPad, habit, habitW, answers, answersW, A }); // analysis only (agent/cpp)
  return {
    A, B, posterior, vA, vB, valueOf,
    // attacker: the share of the mix for each action of a type
    mix(a) { let t = 0; for (const c of a.cnt) t += c; return Array.from(a.cnt, c => c / t); },
    // defender: the best answer of a given hand to n cards
    answer(hand, n) {
      const r = reachable(hand), ys = [NEG]; for (let v = 1; v < r.length; v++) if (r[v]) ys.push(v);
      post(n); const Ev = worth(ys, new Float64Array(ys.length)); let best = 0;
      for (let i = 1; i < ys.length; i++) if (Ev[i] > Ev[best] + 1e-12) best = i;
      return ys[best];
    },
  };
}
// "Any n cards of this hand are equally likely": per n, [[x, p], ...] (x in units of 10).
function anyBelief(hand, maxN) {
  const C = Math.min(hand.length, maxN), V = hand.reduce((a, b) => a + b, 0) / 10;
  const dp = Array.from({ length: C + 1 }, () => new Float64Array(V + 1)); dp[0][0] = 1;
  let top = 0;
  for (const c of hand) { const d = c / 10; for (let n = C - 1; n >= 0; n--) { const row = dp[n], nxt = dp[n + 1]; for (let v = top; v >= 0; v--) if (row[v]) nxt[v + d] += row[v]; } top += d; }
  return dp.map(row => { let tot = 0; for (const x of row) tot += x; const out = []; if (tot) row.forEach((x, v) => { if (x) out.push([v, x / tot]); }); return out.length ? out : null; });
}
