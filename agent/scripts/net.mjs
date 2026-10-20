// Experiment (not used by the bots, see agent/README.md): a learned value function with the same interface as the hand-made Model in brain.js: util(me, dh, dm) is the
// chance that player `me` wins after the given changes in animals and money. The network was trained on self-play
// positions (agent/scripts/value_train.py); every player is described from the observer's side and scored by the
// same small network, a softmax over the players gives the win chances.
const silu = x => x / (1 + Math.exp(-x));
export function loadNet(sd) {
  const L = (w, b) => ({ W: Float32Array.from(sd[w].flat()), b: Float32Array.from(sd[b]), o: sd[b].length, i: sd[w][0].length });
  return { e1: L('enc.0.weight', 'enc.0.bias'), e2: L('enc.2.weight', 'enc.2.bias'), mx: L('mix.0.weight', 'mix.0.bias'), win: L('win.weight', 'win.bias') };
}
function dense(l, x, out, act) {
  const { W, b, o, i } = l;
  for (let r = 0; r < o; r++) { let s = b[r]; const off = r * i; for (let c = 0; c < i; c++) s += W[off + c] * x[c]; out[r] = act ? silu(s) : s; }
  return out;
}
const NF = 57, NT = 10;
export class NetModel {
  constructor(o, th, net) {
    this.o = o; this.th = th; this.net = net; this.n = o.n;
    const n = o.n;
    this.herd = o.herd.map(h => h.slice()); this.money = o.money.map(m => Math.max(0, m));
    this.order = Array.from({ length: n }, (_, d) => (o.me + d) % n);
    this.X = Array.from({ length: n }, () => new Float32Array(NF));
    this.h1 = new Float32Array(net.e1.o); this.H = Array.from({ length: n }, () => new Float32Array(net.e2.o));
    this.cat = new Float32Array(2 * net.e2.o); this.z = new Float32Array(net.mx.o); this.lg = new Float64Array(n);
    this.memo = new Map();
  }
  util(me, dh, dm) {
    const o = this.o, n = this.n, herd = this.herd, money = this.money;
    for (const [j, k, d] of dh) herd[j][k] += d;
    for (const [j, d] of dm) money[j] += d;
    const r = this.eval(me);
    for (const [j, k, d] of dh) herd[j][k] -= d;
    for (const [j, d] of dm) money[j] -= d;
    return r;
  }
  eval(me) {
    const o = this.o, n = this.n, herd = this.herd, money = this.money, net = this.net;
    let tot = 0; for (let j = 0; j < n; j++) tot += Math.max(0, money[j]);
    const glob = [o.deckLeft / 40, o.mules / 4, o.pool / 2000, (o.future || 0) / 1000, n === 3 ? 1 : 0, n === 4 ? 1 : 0, n === 5 ? 1 : 0];
    for (let slot = 0; slot < n; slot++) {
      const j = this.order[slot], x = this.X[slot], m = Math.max(0, money[j]);
      let held = 0, mo = 0;
      for (let k = 0; k < NT; k++) {
        let mx = 0, sm = 0;
        for (let q = 0; q < n; q++) if (q !== j) { const h = herd[q][k]; if (h > mx) mx = h; sm += h; }
        x[k] = herd[j][k] / 4; x[10 + k] = mx / 4; x[20 + k] = sm / 4; x[30 + k] = o.remain[k] / 4;
        if (herd[j][k] > 0) held++;
      }
      for (let q = 0; q < n; q++) if (q !== j) mo = Math.max(mo, Math.max(0, money[q]));
      x[40] = m / 500; x[41] = Math.log1p(m / 50); x[42] = o.cards[j] / 10; x[43] = (o.sd ? o.sd[j] : 0) / 200; x[44] = j === o.me ? 1 : 0; x[45] = (((j - o.turn) % n) + n) % n / n;
      for (let g = 0; g < 7; g++) x[46 + g] = glob[g];
      x[53] = m / Math.max(1, tot); x[54] = held / 10; x[55] = Math.max(0, m - mo) / 500; x[56] = Math.min(m, 2000) / 2000;
      dense(net.e1, x, this.h1, true); dense(net.e2, this.h1, this.H[slot], true);
    }
    const e = net.e2.o, c = this.cat;
    let alive = 0; for (let slot = 0; slot < n; slot++) if (!o.out[this.order[slot]]) alive++;
    for (let t = 0; t < e; t++) { let s = 0; for (let slot = 0; slot < n; slot++) if (!o.out[this.order[slot]]) s += this.H[slot][t]; c[e + t] = s / Math.max(1, alive); }
    let mx = -Infinity;
    for (let slot = 0; slot < n; slot++) {
      if (o.out[this.order[slot]]) { this.lg[slot] = -Infinity; continue; }
      c.set(this.H[slot], 0); dense(net.mx, c, this.z, true);
      let s = net.win.b[0]; for (let t = 0; t < net.win.i; t++) s += net.win.W[t] * this.z[t];
      this.lg[slot] = s; if (s > mx) mx = s;
    }
    let z = 0, mine = 0;
    for (let slot = 0; slot < n; slot++) { const v = Math.exp(this.lg[slot] - mx); z += v; if (this.order[slot] === me) mine = v; }
    return mine / z;
  }
}
