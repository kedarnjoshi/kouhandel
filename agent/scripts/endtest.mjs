// Speed and choices of the endgame lookahead in a few games: node agent/scripts/endtest.mjs <cand> <field> [games]
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
const [cand = 'insane:endRoll=32', field = 'hard0', G = 3] = process.argv.slice(2);
const A = agentFor(cand), F = agentFor(field); let n = 0, ms = 0, mx = 0;
for (let g = 0; g < +G; g++) {
  const rand = rng(900 + g), s = newSimGame(3, 40, rand);
  const timed = { cap: A.cap, bid: A.bid, act: (s, i, what, r) => { const t = performance.now(), v = A.act(s, i, what, r); if (what === 'turn' && !s.deck.length) { const d = performance.now() - t; n++; ms += d; mx = Math.max(mx, d); } return v; } };
  const sc = playOut(s, [timed, F, F], rand); console.log('game', g, sc.join(' '), s.errors ? 'errors ' + s.errors + ' ' + s.lastError : '');
}
console.log(`${n} endgame turns, mean ${(ms / n).toFixed(0)} ms, max ${mx.toFixed(0)} ms`);
