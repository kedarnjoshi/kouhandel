// How well does the position model's soft win chance match who actually wins, by stage of the game?
// node agent/scripts/calib.mjs <lineup> [games] [deck size]   (seat 0's model, seen from seat 0, at every turn)
// Prints per stage (share of the deck left): the model's chance against the actual win rate in bins, and the
// temperature multiplier that would fit the outcomes best (1 = as now; below 1: the chances should be sharper).
import { newSimGame, rng, settleAuction, wins } from '../../lib/bots/sim.js';
import { apply, waiting, tick, score, countsOf } from '../../lib/engine.js';
import { look, forDeck, mkModel } from '../../lib/bots/expert.js';
import { INSANE } from '../../lib/bots/index.js';
import { agentFor } from './registry.mjs';
const [lineup, games = 60, size = 20] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), n = names.length;
const th = { ...forDeck(INSANE, +size), own: 0 }, obs = [];
for (let g = 0; g < +games; g++) for (let rot = 0; rot < n; rot++) {
  const r = rng(7000 + g), s = newSimGame(n, +size, r), ag = names.map((_, x) => agents[(x - rot + n) % n]), me = rot % n, rec = [];
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, ag, r); continue; }
    const w = waiting(s); if (!w) break;
    if (w.what === 'turn') {
      const o = look(s, me, th), M = mkModel(o, th); M.util(me, [], []);
      const E = Array.from(M.E), alive = Array.from(M.alive), m = E.filter((_, j) => alive[j]);
      rec.push({ left: s.deck.length / +size, E, alive, T: th.tau * (m.reduce((a, b) => a + b, 0) / m.length + th.tau1) });
    }
    let a; try { a = ag[w.p].act(s, w.p, w.what, r); } catch { a = null; }
    try { apply(s, w.p, a, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
  const wn = wins(s.players.map(p => score(p, countsOf(s)).score));
  for (const x of rec) obs.push({ ...x, wn });
}
const chances = (x, c) => { const mx = Math.max(...x.E.filter((_, j) => x.alive[j])); const e = x.E.map((v, j) => (x.alive[j] ? Math.exp((v - mx) / (x.T * c)) : 0)); const z = e.reduce((a, b) => a + b, 0); return e.map(v => v / z); };
const stages = [[0.75, 1.01], [0.5, 0.75], [0.25, 0.5], [0, 0.25], [0, 0]];
for (const [lo, hi] of stages) {
  const xs = obs.filter(x => (hi === 0 ? x.left === 0 : x.left > lo && x.left <= hi)); if (!xs.length) continue;
  const ll = c => { let t = 0; for (const x of xs) { const p = chances(x, c); x.wn.forEach((w, j) => { if (w > 0 && x.alive[j]) t += w * Math.log(Math.max(1e-6, p[j])); }); } return t / xs.length; };
  let bc = 1, bl = ll(1); for (let c = 0.05; c <= 2; c += 0.05) { const v = ll(c); if (v > bl) { bl = v; bc = c; } }
  const bins = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.45], [0.45, 0.6], [0.6, 1]].map(([a, b]) => ({ a, b, p: 0, w: 0, c: 0 }));
  for (const x of xs) { const p = chances(x, 1); p.forEach((v, j) => { if (!x.alive[j]) return; const b = bins.find(q => v >= q.a && v < q.b) || bins[bins.length - 1]; b.p += v; b.w += x.wn[j]; b.c++; }); }
  console.log(`deck left ${hi === 0 ? 'none' : `${lo}-${Math.min(1, hi)}`} (${xs.length}): best temperature x${bc.toFixed(2)} (log-lik ${bl.toFixed(3)} vs ${ll(1).toFixed(3)})`);
  console.log('   ' + bins.filter(b => b.c).map(b => `model ${(b.p / b.c).toFixed(2)} -> won ${(b.w / b.c).toFixed(2)} (${b.c})`).join(' | '));
}
