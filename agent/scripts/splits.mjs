// Split pairs: once every card of a type is out and two players hold one each, how often does each side end up
// with the pair, against what the position model gives it (seat 0's model, everyone's true money)?
// node agent/scripts/splits.mjs <lineup> [games] [deck size]
// Prints, by money ratio (richer / poorer, at the first moment the pair is split with no more to come), the model's
// chance for the richer side against how often it actually got the pair, and how the attacker did.
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum, TYPES } from '../../lib/rules.js';
import { look, forDeck, mkModel } from '../../lib/bots/expert.js';
import { INSANE } from '../../lib/bots/index.js';
import { NT } from '../../lib/bots/brain.js';
import { agentFor } from './registry.mjs';
const [lineup, games = 60, size = 20] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), n = names.length;
const th = { ...forDeck(INSANE, +size), own: 0 }, obs = [];
for (let g = 0; g < +games; g++) for (let rot = 0; rot < n; rot++) {
  const r = rng(7000 + g), s = newSimGame(n, +size, r), ag = names.map((_, x) => agents[(x - rot + n) % n]), seen = new Map();
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, ag, r); continue; }
    const w = waiting(s); if (!w) break;
    if (w.what === 'turn') {
      const o = look(s, 0, th), left = {}; for (const t of s.deck) left[t] = (left[t] || 0) + 1;
      for (let k = 0; k < NT; k++) {
        const t = TYPES[k], hold = s.players.map((p, j) => [j, p.animals[t] || 0]).filter(([, c]) => c > 0);
        if (left[t] || s.auction?.animal === t || hold.length !== 2 || hold.some(([, c]) => c !== 1) || seen.has(t)) continue;
        const [a, b] = hold.map(([j]) => j), ma = sum(s.players[a].money), mb = sum(s.players[b].money);
        o.money = s.players.map(p => sum(p.money)); const M = mkModel(o, th);
        const pa = M.mfOf(ma) / (M.mfOf(ma) + M.mfOf(mb));
        seen.set(t, { a, b, ma, mb, pa, deck: s.deck.length / +size });
      }
    }
    let a; try { a = ag[w.p].act(s, w.p, w.what, r); } catch { a = null; }
    try { apply(s, w.p, a, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  for (const [t, x] of seen) {
    const ca = s.players[x.a].animals[t] || 0, cb = s.players[x.b].animals[t] || 0, w = ca > cb ? 1 : cb > ca ? 0 : 0.5;
    const rich = x.ma >= x.mb, ratio = (Math.max(x.ma, x.mb) + 10) / (Math.min(x.ma, x.mb) + 10);
    obs.push({ ratio, pModel: rich ? x.pa : 1 - x.pa, won: rich ? w : 1 - w, deck: x.deck });
  }
}
const bins = [[1, 1.25], [1.25, 1.6], [1.6, 2.2], [2.2, 3.5], [3.5, 1e9]];
for (const [lo, hi] of bins) {
  const xs = obs.filter(x => x.ratio >= lo && x.ratio < hi); if (!xs.length) continue;
  const m = f => xs.reduce((t, x) => t + f(x), 0) / xs.length;
  console.log(`money ratio ${lo}-${hi === 1e9 ? 'up' : hi} (${xs.length}): model gives the richer ${m(x => x.pModel).toFixed(2)}, it got the pair ${m(x => x.won).toFixed(2)} (deck left at the split ${m(x => x.deck).toFixed(2)})`);
}
