import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
import { readFileSync } from 'node:fs';
const th = JSON.parse(readFileSync('agent/runs/stageA.params.json'));
const A = [0, 1, 2, 3].map(() => makeAgent({ kind: 'smart', th }));
for (let g = 0; g < 300; g++) {
  const r = rng(g + 1), s = newSimGame(4, 40, r);
  playOut(s, A, r, 1500);
  if (s.phase !== 'over') {
    console.log('game', g, 'deck', s.deck.length);
    s.players.forEach(p => console.log(p.name, JSON.stringify(Object.fromEntries(Object.entries(p.animals).filter(([, v]) => v))), p.money.reduce((a, b) => a + b, 0), JSON.stringify(p.money)));
    console.log(s.log.slice(0, 16).join('\n')); break;
  }
}
