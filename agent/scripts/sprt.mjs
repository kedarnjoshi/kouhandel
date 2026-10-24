// Is a change better? A sequential test in the manner of Stockfish's fishtest, on paired duplicate deals:
//   node agent/scripts/sprt.mjs <candidate> <reference> <field a;b;vs:x> [deck size 20] [players 3] [max deals 400]
// Candidate and reference play the same deals in every seat against the same field (vs:x: the other side, one x
// against them in every other seat), so most of the luck cancels in the difference. After every batch the log
// likelihood ratio of "the candidate is better by D" (D, in win share x players, env D, default 0.05) against "no
// better" is checked against the bounds for 5% errors either way; the test stops as soon as one is crossed.
import { pool, duplicate } from './pool.mjs';
const [cand, ref, fieldArg, size = 20, players = 3, maxDeals = 400] = process.argv.slice(2);
const n = +players, D = +(process.env.D || 0.05), BATCH = +(process.env.BATCH || 16), ALPHA = 0.05, BETA = 0.05;
const lo = Math.log(BETA / (1 - ALPHA)), hi = Math.log((1 - BETA) / ALPHA), field = fieldArg.split(';');
const plain = field.filter(f => !f.startsWith('vs:')), vs = field.filter(f => f.startsWith('vs:')).map(f => f.slice(3));
const P = pool(), t0 = Date.now(), diffs = [], per = { cand: 0, ref: 0 };
// the games of one batch for one side: per deal, every seat against the plain field and every vs: table
const gamesFor = (sp, seed0) => {
  const out = [];
  if (plain.length) for (const g of duplicate(sp, plain, { deals: BATCH, players: n, size: +size, seed0 })) out.push({ ...g, deal: g.seed });
  for (const x of vs) for (const g of duplicate(x, [sp], { deals: BATCH, players: n, size: +size, seed0 })) out.push({ ...g, deal: g.seed, vs: true });
  return out;
};
const fit = (g, r) => (g.vs ? (1 - r.wins[g.seat]) * n / (n - 1) : r.wins[g.seat] * n);
let verdict = 'undecided (max deals reached)';
for (let done = 0; done < +maxDeals; done += BATCH) {
  const seed0 = 31000 + done, gc = gamesFor(cand, seed0), gr = gamesFor(ref, seed0);
  const res = await P.play([...gc, ...gr], 3), rc = res.slice(0, gc.length), rr = res.slice(gc.length);
  const byDeal = new Map();
  gc.forEach((g, i) => { const d = byDeal.get(g.deal) || { c: 0, r: 0, m: 0 }; d.c += fit(g, rc[i]); d.r += fit(gr[i], rr[i]); d.m++; byDeal.set(g.deal, d); });
  for (const d of byDeal.values()) { diffs.push((d.c - d.r) / d.m); per.cand += d.c / d.m; per.ref += d.r / d.m; }
  const N = diffs.length, mean = diffs.reduce((a, b) => a + b, 0) / N, v = Math.max(1e-4, diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, N - 1));
  const llr = (D / v) * (mean * N - N * D / 2);
  console.log(`${N} deals: candidate ${(per.cand / N).toFixed(3)} reference ${(per.ref / N).toFixed(3)} diff ${mean >= 0 ? '+' : ''}${mean.toFixed(3)} ±${Math.sqrt(v / N).toFixed(3)}  LLR ${llr.toFixed(2)} (${lo.toFixed(2)}, ${hi.toFixed(2)})  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (llr >= hi) { verdict = `better (by about ${mean.toFixed(3)})`; break; }
  if (llr <= lo) { verdict = `not better (diff ${mean.toFixed(3)})`; break; }
}
console.log(`${cand} vs ${ref} on ${fieldArg} @${n}p/${size}: ${verdict}`);
P.close();
