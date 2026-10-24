// Money-estimate error with and without the bid floors, by stage of the game: node agent/scripts/esterr.mjs <lineup> [games] [deck size]
// VIEW=0,1: only these seats' estimates (default all)
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { look } from '../../lib/bots/expert.js';
import { track, TRACKER } from './tracker.mjs';
// TRK=K=160,FLOOR=0,choices=1: the tracker's settings for this run (lib/bots/tracker.js)
for (const kv of (process.env.TRK || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); TRACKER[k] = k === 'choices' ? v === '1' : +v; }
import { agentFor } from './registry.mjs';
const [lineup = 'v2,v2,v2', games = 10, size = 40] = process.argv.slice(2);
const views = process.env.VIEW ? process.env.VIEW.split(',').map(Number) : null;
const names = lineup.split(lineup.includes(';') ? ';' : ','), agents = names.map(agentFor);
const E = { with: [0, 0, 0], without: [0, 0, 0], tracker: [0, 0, 0], blend: [0, 0, 0] }, N = [0, 0, 0]; let fails = 0, ms = 0; const bias = [0, 0, 0];
for (let g = 0; g < +games; g++) {
  const r = rng(800 + g), s = newSimGame(names.length, +size, r);
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    if (w.what === 'turn') {
      const ph = s.deck.length > size / 2 ? 0 : s.deck.length > 0 ? 1 : 2;
      for (let i = 0; i < names.length; i++) {
        if (views && !views.includes(i)) continue;
        const a = look(s, i), h = s.hist; s.hist = []; const b = look(s, i); s.hist = h;
        const t0 = performance.now(), tr = track(s, a); ms += performance.now() - t0; if (!tr) fails++;
        for (let j = 0; j < names.length; j++) if (j !== i) { const real = sum(s.players[j].money); E.with[ph] += Math.abs(a.money[j] - real); bias[ph] += a.money[j] - real; E.without[ph] += Math.abs(b.money[j] - real); E.tracker[ph] += Math.abs((tr ? tr.mean[j] : a.money[j]) - real); E.blend[ph] += Math.abs((tr ? (tr.mean[j] + a.money[j]) / 2 : a.money[j]) - real); N[ph]++; }
      }
    }
    try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
console.log('tracker failures', fails, 'ms total', ms.toFixed(0), 'bias of the estimate (est - real) by stage', bias.map((b, k) => (b / N[k]).toFixed(0)).join(' '));
for (const k of ['without', 'with', 'tracker', 'blend']) console.log(k.padEnd(8), 'mean abs error  early', (E[k][0] / N[0]).toFixed(0), ' late deck', (E[k][1] / N[1]).toFixed(0), ' deck empty', (E[k][2] / N[2]).toFixed(0));
