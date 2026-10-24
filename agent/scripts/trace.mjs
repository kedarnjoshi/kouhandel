// Readable log of one simulated game, for studying how the bots play: node agent/scripts/trace.mjs [seed] [levels] [size]
// e.g. node agent/scripts/trace.mjs 7 hard,hard,insane,hard
import { newSimGame, rng, bidOf } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
import { LEVELS } from '../../lib/bots/index.js';
import { apply, waiting, tick, score, countsOf } from '../../lib/engine.js';
import { sum } from '../../lib/rules.js';
import { agentFor } from './registry.mjs';
import { look } from '../../lib/bots/expert.js';

const [seed = 1, levelsArg = 'hard,hard,hard,hard', size = 40] = process.argv.slice(2);
const levels = levelsArg.split(levelsArg.includes(';') ? ';' : ','), agents = levels.map(agentFor);
const r = rng(+seed), s = newSimGame(levels.length, +size, r);
const short = { horse: 'HOR', cow: 'COW', pig: 'PIG', mule: 'MUL', goat: 'GOA', sheep: 'SHE', dog: 'DOG', cat: 'CAT', duck: 'DUC', chicken: 'CHI' };
const herd = p => Object.entries(p.animals).filter(([, v]) => v).map(([k, v]) => short[k] + v).join(' ');
const table = () => s.players.map((p, j) => `  P${j} ${levels[j].padEnd(7)} $${String(sum(p.money)).padStart(4)} [${[...p.money].sort((a, b) => a - b).join(',')}]  ${herd(p)}`).join('\n');
console.log(table());
for (let step = 0; s.phase !== 'over' && step < 2000; step++) {
  if (s.phase === 'auction' && s.auction.stage === 'bidding') {
    const a = s.auction, bs = s.players.map((p, j) => (j === a.auctioneer || p.out ? null : bidOf(agents[j], s, j, r)));
    const caps = bs.map((b, j) => (b ? Math.min(b.cap, sum(s.players[j].money)) : '-'));
    const bids = caps.map((c, j) => [c, j]).filter(([c]) => c !== '-' && c >= 10).sort((x, y) => y[0] - x[0]);
    if (bids.length) apply(s, bids[0][1], { type: 'bid', amount: Math.max(bids[1] ? Math.min(bids[0][0], bids[1][0] + 10) : 10, Math.min(bids[0][0], bs[bids[0][1]].open || 0)) }, s.clock);
    s.clock = s.auction.deadline; tick(s, s.clock); s.clock++;
    console.log(`#${String(s.deck.length).padStart(2)} P${a.auctioneer} auctions ${a.type.toUpperCase()}  caps ${caps.map((c, j) => (bs[j] && bs[j].open ? `${c}(open ${bs[j].open})` : c)).join(' / ')}  -> ${a.high ? `P${a.high.p} high ${a.high.amt}` : 'no bids'}`);
    continue;
  }
  const w = waiting(s);
  if (!w) break;
  if (process.env.LOOK && (w.what === 'offer' || w.what === 'respond')) { // LOOK=1: what the deciding player believes about everyone's money
    const o = look(s, w.p); console.log(`   (P${w.p} thinks: ${o.money.map((m, j) => `P${j} ${m}${j === w.p ? '' : `±${Math.round(o.sdS[j])}`} (really ${sum(s.players[j].money)})`).join(', ')})`);
  }
  const before = JSON.stringify(s.trade), act = agents[w.p].act(s, w.p, w.what, r);
  const tr = s.trade;
  try { apply(s, w.p, act, s.clock++); } catch (e) { console.log('   refused', JSON.stringify(act), e.message); s.due = s.clock; tick(s, s.clock); }
  if (w.what === 'turn' && act.type === 'koehandel') console.log(`   P${w.p} KOEHANDEL vs P${act.target} for ${act.animal}`);
  if (w.what === 'decide') console.log(`   P${w.p} ${act.type}s`);
  if (w.what === 'offer') console.log(`   P${w.p} offers ${sum(act.cards)} in ${act.cards.length} cards (P${tr.b} has ${sum(s.players[tr.b].money)})`);
  if (w.what === 'respond') console.log(`   P${w.p} ${act.type === 'accept' ? 'accepts' : `counters ${sum(act.cards)}`}  => ${s.log[0]}`);
  if (w.what === 'pay' || (w.what === 'respond') || (w.what === 'turn' && act.type === 'auction' && s.phase !== 'auction')) console.log(table());
  void before;
}
console.log(s.log[0]);
console.log(s.players.map((p, j) => `P${j} ${levels[j]} score ${score(p, countsOf(s)).score}`).join('  '));
