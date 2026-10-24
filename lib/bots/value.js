// A learned position model (agent/value; th.net): the same question as Model in brain.js, "how likely is each player
// to win from here", answered by a small network trained on simulated games instead of a hand-made formula. For every
// player and animal type a shared network reads that player's position in the type (its copies, the most and second
// most any other player holds, the copies still to come, the type's value); the results are summed over the types and
// a second network turns them and the money into a score; the chances are a softmax of the scores. Money only enters
// the second network, so a decision that moves money re-runs only that, and one that moves an animal only that type.
// Networks of arch c also give the type network the player's own money and the money of the other players holding
// the most and second most copies (who wins a split type depends on it); there a type is re-run when its inputs change.
import { VAL, NT } from './brain.js';

const relu = x => (x > 0 ? x : 0);
// y = W x + b for a row-major W [out][in]
function dense(W, b, x, out, act) {
  for (let r = 0; r < W.length; r++) { const w = W[r]; let s = b[r]; for (let c = 0; c < w.length; c++) s += w[c] * x[c]; out[r] = act ? relu(s) : s; }
  return out;
}
// How each player has played so far, as anyone at the table can see (th.net with a style network): its keenness (as
// expert.js keenness: its top bids against a plain bidder's limit, prior 4) and how often it bought back its own
// auctions ((buys + 1) / (sales + 4)).
export function styleOf(o) {
  const n = o.n, lg = new Float64Array(n), cnt = new Float64Array(n), buys = new Float64Array(n), sales = new Float64Array(n);
  for (const e of o.hist || []) {
    if (e.t !== 'a') continue;
    if (e.p > 0) { sales[e.A]++; if (e.buy) buys[e.A]++; }
    if (!e.pred) continue;
    for (let j = 0; j < n; j++) {
      if (!(j in e.pred)) continue;
      const pr = e.pred[j];
      if (pr < 20 || e.w === j) continue;
      const b = e.mx && e.mx[j];
      let r;
      if (b) r = b / pr; else if (e.p < pr) r = Math.max(0.3, (e.p || 10) / pr); else continue;
      lg[j] += Math.log(Math.min(3, Math.max(0.3, r))); cnt[j]++;
    }
  }
  return Array.from(lg, (x, j) => [Math.log(Math.exp(x / (cnt[j] + 4))), (buys[j] + 1) / (sales[j] + 4)]);
}
export function loadNet(json) {
  const w = json.weights, g = k => (Array.isArray(w[k][0]) ? w[k].map(r => Float64Array.from(r)) : Float64Array.from(w[k]));
  return { n: json.players, size: json.size || 0, arch: json.arch, rm: json.arch === 'c', style: !!json.style, ft: json.ft, fp: json.fp, E: g('t.2.weight').length, H: g('t.0.weight').length, H2: g('p.0.weight').length,
    t0: [g('t.0.weight'), g('t.0.bias')], t2: [g('t.2.weight'), g('t.2.bias')],
    p0: [g('p.0.weight'), g('p.0.bias')], p2: [g('p.2.weight'), g('p.2.bias')], p4: [g('p.4.weight'), g('p.4.bias')] };
}

export class NetModel {
  constructor(o, th, net) {
    this.o = o; this.th = th; this.net = net; const n = o.n;
    this.n = n; this.alive = o.out.map(x => !x);
    this.T = th.netT || 1; // a temperature on the scores: above 1 flatter chances (more cautious), below 1 sharper
    this.c = new Float64Array(NT); this.lf = new Float64Array(NT);
    // copies of each type: those seen plus those expected to remain (exact with 20 and 40 cards)
    for (let k = 0; k < NT; k++) { this.c[k] = Math.max(1, o.seen[k] + o.remain[k]); this.lf[k] = o.remain[k] / this.c[k]; }
    this.dl = o.deckSize ? o.deckLeft / o.deckSize : 0;
    this.herd = o.herd.map(h => h.slice());
    this.hx = new Float64Array(net.H); this.ex = new Float64Array(net.E); this.fx = new Float64Array(net.ft);
    this.px = new Float64Array(net.E + net.fp); this.h1 = new Float64Array(net.H2); this.h2 = new Float64Array(net.H2); this.zo = new Float64Array(1);
    this.m0 = o.money.map(m => Math.max(0, m) / 1000);
    // every player's embedding per type (and, arch c, the inputs it came from), and their sums
    this.emb = []; this.sum = []; this.feat = [];
    for (let j = 0; j < n; j++) {
      const e = [], s = new Float64Array(net.E), fs = [];
      for (let k = 0; k < NT; k++) {
        const v = this.typeEmb(j, k, this.herd, this.m0).slice(); e.push(v); for (let x = 0; x < net.E; x++) s[x] += v[x];
        if (net.rm) fs.push(this.fx.slice());
      }
      this.emb.push(e); this.sum.push(s); this.feat.push(fs);
    }
    this.tmp = new Float64Array(net.E); this.z = new Float64Array(n);
    if (net.style) this.st = styleOf(o);
  }
  // the type network's inputs for player j and type k (into this.fx); money: everyone's money / 1000 (arch c)
  typeFeat(j, k, herd, money) {
    const n = this.n, c = this.c[k], f = this.fx; let m1 = 0, m2 = 0;
    for (let x = 0; x < n; x++) if (x !== j) { const h = herd[x][k]; if (h > m1) { m2 = m1; m1 = h; } else if (h > m2) m2 = h; }
    f[0] = herd[j][k] / c; f[1] = m1 / c; f[2] = m2 / c; f[3] = this.lf[k]; f[4] = VAL[k] / 1000; f[5] = 1; f[6] = this.dl;
    if (this.net.rm) { // the other holders in order of copies, then money (then seat): the money of the first two
      let b1 = -1, b2 = -1;
      const over = (x, y) => y < 0 || herd[x][k] > herd[y][k] || (herd[x][k] === herd[y][k] && money[x] > money[y]);
      for (let x = 0; x < n; x++) if (x !== j) { if (over(x, b1)) { b2 = b1; b1 = x; } else if (over(x, b2)) b2 = x; }
      f[7] = money[j]; f[8] = m1 > 0 ? money[b1] : 0; f[9] = m2 > 0 ? money[b2] : 0;
    }
    return f;
  }
  typeEmb(j, k, herd, money) {
    const f = this.typeFeat(j, k, herd, money);
    dense(this.net.t0[0], this.net.t0[1], f, this.hx, true);
    return dense(this.net.t2[0], this.net.t2[1], this.hx, this.ex, true);
  }
  // Win chance of player `me` after animal changes dh = [[player, type, +/-n], ...] and money changes dm = [[player,
  // +/-amount], ...] (as Model.util).
  util(me, dh, dm) {
    const n = this.n, net = this.net, o = this.o, E = net.E;
    let herd = this.herd, sums = this.sum;
    if (net.rm) return this.utilRM(me, dh, dm);
    if (dh.length) {
      herd = this.herd.map(h => h.slice());
      for (const [j, k, d] of dh) herd[j][k] = Math.max(0, herd[j][k] + d);
      sums = this.sum.map(s => s.slice());
      const done = new Set();
      for (const [, k] of dh) {
        if (done.has(k)) continue; done.add(k);
        for (let j = 0; j < n; j++) { const v = this.typeEmb(j, k, herd, this.m0), old = this.emb[j][k]; for (let x = 0; x < E; x++) sums[j][x] += v[x] - old[x]; }
      }
    }
    const money = o.money.map(m => m);
    for (const [j, d] of dm) money[j] += d;
    return this.score(me, sums, money);
  }
  // arch c: every type whose inputs changed (animals, or the money of its player or of the holders it reads) is re-run
  utilRM(me, dh, dm) {
    const n = this.n, E = this.net.E, o = this.o;
    let herd = this.herd;
    if (dh.length) { herd = this.herd.map(h => h.slice()); for (const [j, k, d] of dh) herd[j][k] = Math.max(0, herd[j][k] + d); }
    const money = o.money.map(m => m);
    for (const [j, d] of dm) money[j] += d;
    const m = money.map(x => Math.max(0, x) / 1000), sums = this.sum.map(s => s.slice());
    for (let j = 0; j < n; j++) for (let k = 0; k < NT; k++) {
      const f = this.typeFeat(j, k, herd, m), f0 = this.feat[j][k];
      let same = true; for (let x = 0; x < f.length; x++) if (f[x] !== f0[x]) { same = false; break; }
      if (same) continue;
      const v = this.typeEmb(j, k, herd, m), old = this.emb[j][k];
      for (let x = 0; x < E; x++) sums[j][x] += v[x] - old[x];
    }
    return this.score(me, sums, money);
  }
  // the player network on the summed type embeddings and the money: player me's chance to win
  score(me, sums, money) {
    const n = this.n, net = this.net, o = this.o, E = net.E;
    let mx = -Infinity;
    for (let j = 0; j < n; j++) {
      if (!this.alive[j]) continue;
      const p = this.px; for (let x = 0; x < E; x++) p[x] = sums[j][x];
      // player features: money, the others' money (largest first), money cards, deck left, mules, whose turn, deck size
      let q = E; p[q++] = Math.max(0, money[j]) / 1000;
      const om = []; for (let x = 0; x < n; x++) if (x !== j) om.push([Math.max(0, money[x]) / 1000, x]);
      om.sort((a, b) => b[0] - a[0]); for (const v of om) p[q++] = v[0];
      p[q++] = o.cards[j] / 20; p[q++] = this.dl; p[q++] = (o.mules || 0) / 4; p[q++] = o.turn === j ? 1 : 0; p[q++] = (o.deckSize || 40) / 40;
      // style networks: this player's style, then the others' in the order of their money
      if (this.st) { p[q++] = this.st[j][0]; p[q++] = this.st[j][1]; for (const v of om) { p[q++] = this.st[v[1]][0]; p[q++] = this.st[v[1]][1]; } }
      dense(net.p0[0], net.p0[1], p, this.h1, true); dense(net.p2[0], net.p2[1], this.h1, this.h2, true);
      const z = dense(net.p4[0], net.p4[1], this.h2, this.zo, false)[0];
      this.z[j] = z / this.T; if (this.z[j] > mx) mx = this.z[j];
    }
    let tot = 0, mine = 0;
    for (let j = 0; j < n; j++) if (this.alive[j]) { const e = Math.exp(this.z[j] - mx); tot += e; if (j === me) mine = e; }
    return mine / tot;
  }
}
