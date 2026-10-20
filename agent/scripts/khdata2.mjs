// Koehandel deals with everything onlookers can see at the time, and the real net transfer, for fitting a better
// guess of secret amounts: node agent/scripts/khdata2.mjs <lineup a;b;c> <games> <out.json> [seed]
import { newSimGame, rng, settleAuction } from '../../lib/bots/sim.js';
import { apply, waiting, tick } from '../../lib/engine.js';
import { sum, ANIMALS } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
import fs from 'node:fs';
const [lineup = 'insane;insane;insane', games = 10, out = 'kh.json', seed = 300] = process.argv.slice(2);
const names = lineup.split(';'), agents = names.map(agentFor), rows = [];
for (let g = 0; g < +games; g++) {
  const r = rng(+seed + g), s = newSimGame(names.length, 40, r);
  for (let step = 0; s.phase !== 'over' && step < 2500; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
    const w = waiting(s); if (!w) break;
    let act; try { act = agents[w.p].act(s, w.p, w.what, r); } catch { act = null; }
    if (w.what === 'respond' && act) {
      const tr = s.trade, A = s.players[tr.a], B = s.players[tr.b], x = sum(tr.bids[tr.a]), na = tr.bids[tr.a].length;
      let tot = 0, n = 0; for (const p of s.players) { tot += sum(p.money); n += p.money.length; }
      const y = act.type === 'accept' ? null : sum(act.cards), nb = act.type === 'accept' ? 0 : act.cards.length;
      const hA = A.animals[tr.type] || 0, hB = B.animals[tr.type] || 0;
      rows.push({ na, nb, x, y, avg: tot / n, ledA: s.ledger[tr.a], ledB: s.ledger[tr.b], cA: A.money.length, cB: B.money.length,
        realA: sum(A.money), realB: sum(B.money), val: ANIMALS[tr.type], cnt: tr.count, hA, hB, deck: s.deck.length, n: s.players.length, tie: tr.tieAt != null ? 1 : 0 });
    }
    try { apply(s, w.p, act, s.clock++); } catch { s.due = s.clock; tick(s, s.clock); }
  }
}
fs.writeFileSync(out, JSON.stringify(rows)); console.log(rows.length, 'deals');
