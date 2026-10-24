// Regret audit: which kind of decision costs Insane the most? Games are played with a lineup; at the decisions of
// seat 0 (buy-backs, and turn choices: auction or one of the best koehandels) every option is played out ROLL times
// from the real position by the same agents, with the rest of the deck shuffled and the same luck for every option,
// and the share of wins for seat 0 is compared with what it chose.
//   node agent/scripts/audit.mjs <lineup> <first game> <games> <deck size> <out.jsonl>   (ROLL=n, default 40)
// Run several in parallel on different game ranges, then: node agent/scripts/audit.mjs --sum <files...>
import fs from 'node:fs';
import { newSimGame, rng, settleAuction, playOut, wins, shuffle } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { TYPES } from '../../lib/rules.js';
import { look, forDeck, mkModel, koehandelOptions, auctionValue } from '../../lib/bots/expert.js';
import { INSANE } from '../../lib/bots/index.js';
import { agentFor } from './registry.mjs';

if (process.argv[2] === '--sum') {
  const rows = process.argv.slice(3).flatMap(f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const groups = {};
  for (const r of rows) { const key = `${r.what} ${r.stage}`; (groups[key] ||= []).push(r); }
  for (const key of Object.keys(groups).sort()) {
    const g = groups[key], reg = g.map(r => Math.max(...r.vals) - r.vals[r.pick]), sig = g.filter(r => Math.max(...r.vals) - r.vals[r.pick] > 2 * r.se);
    console.log(`${key.padEnd(18)} ${String(g.length).padStart(4)} decisions: mean regret ${(reg.reduce((a, b) => a + b, 0) / g.length).toFixed(4)} | clearly wrong ${sig.length} (${(100 * sig.length / g.length).toFixed(0)}%), costing ${(sig.reduce((a, r) => a + Math.max(...r.vals) - r.vals[r.pick], 0) / g.length).toFixed(4)} per decision`);
    const kinds = {}; for (const r of sig) { const k = `${r.opts[r.pick]} -> ${r.opts[r.vals.indexOf(Math.max(...r.vals))]}`; kinds[k] = (kinds[k] || 0) + 1; }
    if (sig.length) console.log('    ' + Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `${k}: ${c}`).join(' | '));
  }
  process.exit(0);
}

const [lineup, first = 0, games = 4, size = 20, out = 'audit.jsonl'] = process.argv.slice(2);
const ROLL = +(process.env.ROLL || 40), names = lineup.split(';'), agents = names.map(agentFor), n = names.length;
const th = forDeck(INSANE, +size);
const stageOf = s => (s.deck.length === 0 ? 'empty' : s.deck.length <= +size / 4 ? 'late' : s.deck.length <= +size / 2 ? 'mid' : 'early');
// play option `act` (a list of moves for seat `me`, applied in order) from s, ROLL times; win share of me
function rollouts(s, me, acts, seed) {
  const vals = acts.map(() => []);
  for (let r = 0; r < ROLL; r++) {
    const rs = seed * 7919 + r * 104729;
    acts.forEach((moves, x) => {
      const c = structuredClone(s), rand = rng(rs);
      shuffle(c.deck, rng(rs + 1));
      try { for (const m of moves) apply(c, me, m, c.clock++); } catch { vals[x].push(NaN); return; }
      vals[x].push(wins(playOut(c, agents, rand))[me]);
    });
  }
  const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
  // standard error of the difference between the best two options (paired)
  const m = vals.map(mean), order = m.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const d = vals[order[0][1]].map((v, r) => v - vals[order[1]?.[1] ?? order[0][1]][r]), md = mean(d);
  const se = Math.sqrt(d.reduce((a, b) => a + (b - md) ** 2, 0) / Math.max(1, d.length - 1) / d.length);
  return { vals: m, se };
}
for (let g = +first; g < +first + +games; g++) {
  const r = rng(5000 + g), s = newSimGame(n, +size, r), me = 0;
  for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    let mv; try { mv = agents[w.p].act(s, w.p, w.what, r); } catch { mv = null; }
    if (w.p === me && (w.what === 'decide' || w.what === 'turn')) {
      let opts, acts, pick;
      if (w.what === 'decide') {
        if (s.players[me].money.reduce((a, b) => a + b, 0) < s.auction.high.amt) opts = null;
        else { opts = ['buy', 'sell']; acts = [[{ type: 'buy' }], [{ type: 'sell' }]]; pick = mv && mv.type === 'buy' ? 0 : 1; }
      } else {
        const o = look(s, me, th), M = mkModel(o, th), ko = koehandelOptions(o, th, M, rng(g * 31 + step)).sort((a, b) => b.ev - a.ev).slice(0, 3);
        opts = []; acts = [];
        if (s.deck.length) { opts.push('auction'); acts.push([{ type: 'auction' }]); }
        for (const t of ko) { opts.push(`kh ${TYPES[t.k]}`); acts.push([{ type: 'koehandel', target: t.p, animal: TYPES[t.k] }]); }
        pick = mv && mv.type === 'koehandel' ? opts.indexOf(`kh ${mv.animal}`) : opts.indexOf('auction');
        if (pick < 0) { opts.push(mv.type === 'koehandel' ? `kh ${mv.animal}` : 'auction'); acts.push([mv]); pick = opts.length - 1; }
        if (opts.length < 2) opts = null;
      }
      if (opts) {
        const { vals, se } = rollouts(s, me, acts, g * 1000 + step);
        fs.appendFileSync(out, JSON.stringify({ g, what: w.what, stage: stageOf(s), opts, pick, vals, se, price: w.what === 'decide' ? s.auction.high.amt : undefined, animal: s.auction?.type }) + '\n');
      }
    }
    try { apply(s, w.p, mv, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
