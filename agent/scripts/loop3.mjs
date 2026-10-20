import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
const hard = makeAgent({ kind: 'smart' });
for (let g = 0; g < 40; g++) {
  const r = rng(g + 1), s = newSimGame(3 + g % 3, g % 2 ? 40 : 24, r);
  playOut(s, s.players.map(() => hard), r, 3000);
  if (s.phase !== 'over') {
    console.log('game', g, 'size', g % 2 ? 40 : 24, 'deck', s.deck.length, 'counts', JSON.stringify(s.counts), 'khs', JSON.stringify(s.khs.slice(-6)));
    s.players.forEach(p => console.log(p.name, JSON.stringify(Object.fromEntries(Object.entries(p.animals).filter(([, v]) => v))), JSON.stringify(p.money)));
    console.log(s.log.slice(0, 10).join('\n'));
  }
}
