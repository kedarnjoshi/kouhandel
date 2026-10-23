// Experiment (not used by the bots; see agent/README.md): endgame lookahead. Once the deck is empty the game is a short run of koehandels, and the position model misses
// what decides it: who attacks a contested set first, and that money left over at the end is worth nothing. So the
// koehandel to start is chosen by playing the rest of the game out many times from each option: the other players'
// money cards are guessed (consistent with the card counts and the money estimates), everyone plays a fast policy
// (the first-generation judgement of lib/bots/brain.js), and the real scoring decides. Every option is played on the
// same guesses with the same luck, so the comparison between options is much sharper than each value on its own.
import { apply, score, countsOf, waiting, tick } from '../../lib/engine.js';
import { TYPES, sum } from '../../lib/rules.js';
import { smart } from '../../lib/bots/policies.js';
import { DEFAULTS } from '../../lib/bots/brain.js';

// the fast policy for the playouts (first-generation tuned parameters)
let fast = null;
const FAST_TH = ({ ...DEFAULTS, rho: 1.289, gamma: 1.106, delta: 0.8568, mu: 508.3, tau: 1.432, tau1: 68.93, eps: 0.02007, mBid: -0.02469, shade: 1.149, mDec: 0.02409, aucM: 0.8172, khBias: -0.009984, pc: 1, gap: 11.54, pad: 0.4521, phi: 0.9213, mResp: -0.5469 });
const policy = () => (fast ||= smart(FAST_TH));
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// Guesses of everyone else's money cards: the cards I cannot see, dealt out with the right counts, kept in
// proportion to how well their totals fit the money estimates.
function guesses(s, o, count, rand) {
  const others = o.active.filter(j => j !== o.me), cand = [];
  for (let t = 0; t < count * 4; t++) {
    const pool = o.unseen.slice();
    for (let x = pool.length - 1; x > 0; x--) { const y = Math.floor(rand() * (x + 1)); [pool[x], pool[y]] = [pool[y], pool[x]]; }
    const hands = {}; let at = 0, lw = 0;
    for (const j of others) {
      const h = pool.slice(at, at + o.cards[j]); at += o.cards[j]; hands[j] = h;
      const d = (sum(h) - o.money[j]) / (o.sd[j] + 30); lw -= d * d / 2;
    }
    cand.push({ hands, lw });
  }
  const mx = Math.max(...cand.map(c => c.lw)), out = [];
  let W = 0; for (const c of cand) { c.w = Math.exp(c.lw - mx); W += c.w; }
  for (let k = 0; k < count; k++) { // resample by weight
    let r = rand() * W, x = 0; for (; x < cand.length - 1; x++) { r -= cand[x].w; if (r <= 0) break; }
    out.push(cand[x].hands);
  }
  return out;
}

// Play the game to the end from s (deck empty), everyone with the fast policy; the win share of `me`.
function playout(s, me, rand, maxSteps = 400) {
  for (let step = 0; s.phase !== 'over' && step < maxSteps; step++) {
    const w = waiting(s);
    if (!w) break;
    const t = s.clock++;
    let mv; try { mv = policy().act(s, w.p, w.what, rand); } catch { mv = null; }
    try { apply(s, w.p, mv, t); } catch { s.due = t; tick(s, t); }
  }
  const sc = s.players.map((p, j) => (p.out ? -1 : score(p, countsOf(s)).score)), best = Math.max(...sc);
  const n = sc.filter(x => x === best).length;
  return sc[me] === best ? 1 / n : 0;
}

// The koehandel to start (from `opts`: [{p, k}], the model's favourite first), or null to keep the model's choice.
export function endgameChoice(s, o, opts, { rollouts = 32, seed = 1 } = {}) {
  if (s.deck.length || opts.length < 2) return null;
  const rand = rng(seed), worlds = guesses(s, o, rollouts, rand), me = o.me;
  // the copies leave out what the fast policy never reads (history, log, notes), which is most of the state
  const { hist, log, notes, peekForTests, ...rest } = s, base = structuredClone(rest);
  base.log = []; base.notes = {}; base.hist = [];
  for (const p of base.players) delete p.bot; // no bot timers in the copies
  base.clock = 1; base.due = null;
  const vals = opts.map(() => 0);
  worlds.forEach((hands, wi) => {
    opts.forEach((t, x) => {
      const c = structuredClone(base);
      for (const j in hands) c.players[j].money = hands[j].slice();
      try { apply(c, me, { type: 'koehandel', target: t.p, animal: TYPES[t.k] }, c.clock++); } catch { vals[x] -= 1e9; return; }
      vals[x] += playout(c, me, rng(seed * 7919 + wi * 104729));
    });
  });
  let bi = 0; vals.forEach((v, x) => { if (v > vals[bi] + 1e-9) bi = x; });
  return { pick: opts[bi], vals: vals.map(v => v / rollouts) };
}
