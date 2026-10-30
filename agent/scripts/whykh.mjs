// Why does Insane start a koehandel mid-game? Plays sim games and, at every turn of seat 0 (the candidate) in the
// given stage of the deck, prints the auction's value against each koehandel option (with the restraint), the
// option's target, herds and money: node agent/scripts/whykh.mjs "<spec;spec;spec>" <first seed> <games> [lo hi]
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
import { look, auctionValue, koehandelOptions, mkModel, forDeck } from '../../lib/bots/expert.js';
import { LEVELS } from '../../lib/bots/index.js';
import { TYPES } from '../../lib/rules.js';
const [lineup, seed0 = 1, games = 2, lo = 0.3, hi = 0.75] = process.argv.slice(2);
const specs = lineup.split(';');
const th = forDeck(LEVELS.insane.spec.th, 40);
let picks = { auction: 0, koehandel: 0 };
for (let g = 0; g < +games; g++) {
  const r = rng(+seed0 + g), s = newSimGame(specs.length, 40, r);
  const agents = specs.map((sp, seat) => {
    const a = agentFor(sp);
    if (seat) return a;
    return { ...a, bid: a.bid, cap: a.cap, act(st, i, what, rr) {
      const mv = a.act(st, i, what, rr), frac = st.deck.length / 40;
      if (what === 'turn' && frac >= +lo && frac <= +hi && st.deck.length) {
        const o = look(st, i, th), M = mkModel(o, th), av = auctionValue(o, th);
        const opts = koehandelOptions(o, th, M, rng(7)).sort((x, y) => y.ev - x.ev).slice(0, 3);
        picks[mv.type]++;
        if (mv.type === 'koehandel') console.log(`g${+seed0 + g} deck ${st.deck.length} money ${o.money.map(Math.round).join('/')} | auction ${av.toFixed(4)} | ` +
          opts.map(t => `${TYPES[t.k]}@${t.p} x${t.count} herd ${o.herd[i][t.k]}v${o.herd[t.p][t.k]} ev ${t.ev.toFixed(4)} ×${(1 + th.khBias).toFixed(2)}=${(t.ev * (1 + th.khBias)).toFixed(4)}`).join(' ; '));
      }
      return mv;
    } };
  });
  playOut(s, agents, r);
}
console.log('picks in the stage', JSON.stringify(picks));
