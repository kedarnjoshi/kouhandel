// How good are the money estimates? Mean absolute error of each bot's estimate of the others' money, by phase.
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { observe } from '../../lib/bots/brain.js';
import { look } from '../../lib/bots/expert.js';
import { agentFor } from './registry.mjs';
const [lineup = 'v2,v2,v2,v2', games = 20] = process.argv.slice(2);
const names = lineup.split(','), agents = names.map(agentFor);
const err = { old: [0, 0, 0], new: [0, 0, 0], raw: [0, 0, 0] }, cnt = [0, 0, 0];
for (let g = 0; g < +games; g++) {
  const r = rng(900 + g), s = newSimGame(names.length, 40, r), cum = s.players.map(() => s.players.map(() => 0));
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') {
      const a = s.auction, caps = s.players.map((p, j) => (j === a.auctioneer || p.out ? -1 : Math.min(agents[j].cap(s, j, r), sum(p.money))));
      const bids = caps.map((c, j) => [c, j]).filter(([c]) => c >= 10).sort((x, y) => y[0] - x[0]);
      if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10 }, s.clock);
      s.clock = s.auction.deadline; tick(s, s.clock); s.clock++; continue;
    }
    const w = waiting(s); if (!w) break;
    if (w.what === 'turn') {
      const ph = s.deck.length > 25 ? 0 : s.deck.length ? 1 : 2;
      const o0 = observe(s, w.p), o1 = look(s, w.p);
      s.players.forEach((p, j) => { if (j !== w.p && !p.out) { err.old[ph] += Math.abs(o0.money[j] - sum(p.money)); err.raw[ph] += Math.abs(s.ledger[j] + s.mem[w.p][j] - cum[w.p][j] - sum(p.money)); err.new[ph] += Math.abs(o1.money[j] - sum(p.money)); cnt[ph]++; } });
    }
    const act0 = agents[w.p].act(s, w.p, w.what, r);
    if (w.what === 'respond') { // the guess the engine books, to undo it for the no-guess estimate
      const tr = s.trade, na = tr.bids[tr.a].length, nb = act0.type === 'accept' ? 0 : act0.cards.length, x = sum(tr.bids[tr.a]), y = nb ? sum(act0.cards) : 0;
      let tot = 0, cnt2 = 0; for (const p of s.players) { tot += sum(p.money); cnt2 += p.money.length; }
      const avg = tot / cnt2, own = Math.min(3 * avg, Math.max(0, s.ledger[tr.a]) / Math.max(1, s.players[tr.a].money.length));
      const g = !nb ? 0.3 * na * avg + 0.15 * na * own : x > y ? 0.39 * na * avg + 0.09 * nb * avg : -(0.26 * na * avg + 0.3 * nb * avg);
      s.players.forEach((p, i) => { if (i !== tr.a && i !== tr.b) { cum[i][tr.a] -= g; cum[i][tr.b] += g; } });
    }
    try { apply(s, w.p, act0, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
    continue;
    try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
console.log('mean abs error early/mid/endgame  no guess:', err.raw.map((e, k) => (e / cnt[k]).toFixed(0)).join(' / '), ' ledger+guess:', err.old.map((e, k) => (e / cnt[k]).toFixed(0)).join(' / '), '  new:', err.new.map((e, k) => (e / cnt[k]).toFixed(0)).join(' / '));
