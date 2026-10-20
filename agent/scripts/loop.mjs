import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { smart } from '../../lib/bots/policies.js';
import { DEFAULTS } from '../../lib/bots/brain.js';
import { apply } from '../../lib/engine.js';
const A = [0,1,2,3].map(() => smart(DEFAULTS));
for (let g = 0; g < 40; g++) {
  const r = rng(g + 1), s = newSimGame(4, 40, r);
  const logs = []; const orig = s.log;
  playOut(s, A, r, 1500);
  if (s.phase !== 'over') {
    console.log('game', g, 'deck', s.deck.length);
    s.players.forEach(p => console.log(p.name, JSON.stringify(Object.fromEntries(Object.entries(p.animals).filter(([,v])=>v))), p.money.reduce((a,b)=>a+b,0)));
    console.log(s.log.slice(0, 12).join('\n')); break;
  }
}
