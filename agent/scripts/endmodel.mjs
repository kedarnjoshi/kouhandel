// Experiment (not used by the bots, see agent/README.md): the endgame, played out. Once the deck is empty the game is a series of compulsory koehandels over the animal
// types that are still split, and the position model (brain.js) describes that badly: it gives every holder a share
// of the set that grows smoothly with money, while in fact the koehandels go to whoever can pay more, the winner
// pays the loser (so losing one makes you richer for the next), and the order matters. This model plays the rest
// of the game out instead, on the money estimates: every koehandel is won by the richer side (softly, by how sure
// that is), the winner pays the loser a part of its money, the turn goes round as in the game, and the
// result is the real score. Same interface as the position model: util(me, animal changes, money changes).
// In the registry: <level>:endModel=1 (this model once the deck is empty, the position model before).
import { NT, VAL, Model } from '../../lib/bots/brain.js';

const DEPTH = 6; // koehandels played out in full; after that each split type simply goes to its richest holder
export class EndModel {
  constructor(o, th) {
    this.o = o; this.th = th; this.n = o.n;
    this.alive = o.out.map(x => !x);
    this.herd = new Int8Array(o.n * NT); this.money = new Float64Array(o.n); this.sd = new Float64Array(o.n);
    for (let j = 0; j < o.n; j++) {
      this.money[j] = Math.max(0, o.money[j]); this.sd[j] = j === o.me ? 0 : (o.sdS ? o.sdS[j] : 20);
      if (this.alive[j]) for (let k = 0; k < NT; k++) this.herd[j * NT + k] = o.herd[j][k];
    }
    this.first = o.trade ? o.trade.a : o.turn; // the koehandel being decided (or chosen) is this player's turn
    // what the winner pays the loser: measured in bot endgames (agent/scripts/endkh.mjs) it goes with the winner's own
    // money and the money in play, hardly with the loser's
    let tot = 0, cnt = 0; for (let j = 0; j < o.n; j++) if (this.alive[j]) { tot += this.money[j]; cnt++; }
    this.avg = tot / Math.max(1, cnt); this.payW = th.endPayW ?? 0.2; this.payL = th.endPayL ?? 0; this.payC = th.endPayC ?? 0.3;
    this.choose = th.endChoose ?? 0;
    this.memo = new Map();
  }
  util(me, dh, dm) {
    const h = this.herd.slice(), m = this.money.slice();
    for (const [j, k, d] of dh) h[j * NT + k] = Math.max(0, h[j * NT + k] + d);
    for (const [j, d] of dm) m[j] = Math.min(1e5, Math.max(0, m[j] + d)); // (a payment the cards cannot make comes as Infinity)
    return this.value(h, m, this.next(h, this.first), 0)[me];
  }
  // the next player after t (in seat order) who can still start a koehandel; -1 if nobody can
  next(h, t) {
    for (let s = 1; s <= this.n; s++) { const j = (t + s) % this.n; if (this.alive[j] && this.targets(h, j).length) return j; }
    return -1;
  }
  targets(h, a) {
    const out = [];
    for (let b = 0; b < this.n; b++) if (b !== a && this.alive[b]) for (let k = 0; k < NT; k++) if (h[a * NT + k] && h[b * NT + k]) out.push([b, k]);
    return out;
  }
  // chance that a beats b in a koehandel, from the money estimates (spread by how unsure they are)
  beats(m, a, b) {
    const w = 15 + 0.1 * (m[a] + m[b]) + Math.hypot(this.sd[a], this.sd[b]);
    return 1 / (1 + Math.exp(-(m[a] - m[b]) / w));
  }
  // win chances of everyone from here (h, m), player t to start a koehandel, d koehandels played out so far
  value(h, m, t, d) {
    if (t < 0) return this.final(h);
    if (d >= DEPTH) return this.final(this.richest(h, m));
    const key = t + '|' + h.join('') + '|' + Array.from(m, x => Math.round(x / 10)).join(',');
    const hit = this.memo.get(key); if (hit) return hit;
    // the player to move picks the koehandel that is best for it: in the first endChoose koehandels by playing each
    // option out, further on by a rule of thumb (the most valuable animals it is likely to win)
    const opts = this.targets(h, t).map(([b, k]) => [b, k, Math.min(h[t * NT + k], h[b * NT + k]), this.beats(m, t, b)]);
    let out = null;
    if (d < this.choose && opts.length > 1) {
      for (const op of opts) { const v = this.play(h, m, t, d, op); if (!out || v[t] > out[t]) out = v; }
    } else {
      let best = null, bv = -1;
      for (const op of opts) {
        const [b, k, c, p] = op, v = p * VAL[k] * c + (1 - p) * 0.2 * Math.min(m[b], m[t] + 10);
        if (v > bv) { bv = v; best = op; }
      }
      out = this.play(h, m, t, d, best);
    }
    this.memo.set(key, out); return out;
  }
  // the koehandel of t against b for c animals of type k, t winning with chance p: both outcomes played on
  play(h, m, t, d, [b, k, c, p]) {
    const out = new Float64Array(this.n);
    for (const [win, lose, q] of [[t, b, p], [b, t, 1 - p]]) {
      if (q < 1e-4) continue;
      const h2 = h.slice(), m2 = m.slice(), pay = Math.min(m2[win], this.payW * m2[win] + this.payL * m2[lose] + this.payC * this.avg);
      h2[win * NT + k] += c; h2[lose * NT + k] -= c; m2[win] -= pay; m2[lose] += pay;
      const v = this.value(h2, m2, this.next(h2, t), d + 1);
      for (let j = 0; j < this.n; j++) out[j] += q * v[j];
    }
    return out;
  }
  // every type still split goes to whichever holder has the most money
  richest(h, m) {
    const h2 = h.slice();
    for (let k = 0; k < NT; k++) {
      let best = -1, tot = 0;
      for (let j = 0; j < this.n; j++) if (this.alive[j] && h[j * NT + k]) { tot += h[j * NT + k]; if (best < 0 || m[j] > m[best]) best = j; }
      if (best >= 0) for (let j = 0; j < this.n; j++) h2[j * NT + k] = j === best ? tot : 0;
    }
    return h2;
  }
  // the real scoring: complete sets (no one else holds that type any more), their value times their number; ties
  // share the win
  final(h) {
    const val = new Float64Array(this.n), sets = new Float64Array(this.n);
    for (let k = 0; k < NT; k++) {
      let holder = -1, cnt = 0;
      for (let j = 0; j < this.n; j++) if (this.alive[j] && h[j * NT + k]) { holder = j; cnt++; }
      if (cnt === 1) { val[holder] += VAL[k]; sets[holder]++; }
    }
    let top = -1, w = 0; const out = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) if (this.alive[j]) top = Math.max(top, val[j] * sets[j]);
    for (let j = 0; j < this.n; j++) if (this.alive[j] && val[j] * sets[j] === top) w++;
    for (let j = 0; j < this.n; j++) if (this.alive[j] && val[j] * sets[j] === top) out[j] = 1 / w;
    return out;
  }
}

export const endModelOr = (o, th) => (o.deckLeft ? new Model(o, th) : new EndModel(o, th));
