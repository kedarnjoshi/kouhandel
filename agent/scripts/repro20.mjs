// The two situations from a 20-card test game (agent/README.md): an offer to a player known to hold two zeros, and
// the turn choice when a koehandel for the duck pair costs a known 50.
import { newSimGame, rng } from '../../lib/bots/sim.js';
import { apply } from '../../lib/engine.js';
import { agentFor } from './registry.mjs';
import { sum } from '../../lib/rules.js';
const specs = process.argv.slice(2).length ? process.argv.slice(2) : ['insane', 'insane:sharp=1,padCost=0.5'];
const setup = () => {
  const r = rng(5), s = newSimGame(3, 20, r);
  s.deck = s.deck.filter(t => t !== 'duck' && t !== 'goat').slice(0, 10);
  for (const p of s.players) for (const t in p.animals) p.animals[t] = 0;
  return s;
};
for (const spec of specs) {
  const A = agentFor(spec);
  // 1: Buttercup (1) against Dolly (2) for a goat; Dolly holds [0,0]
  let cards = [];
  for (let g = 0; g < 8; g++) {
    const s = setup(); s.turn = 1;
    s.players[1].animals.goat = 1; s.players[2].animals.goat = 1;
    s.players[0].money = [0, 0, 10, 10, 50, 100, 10]; s.players[1].money = [0, 0, 10, 10, 10, 10, 50, 50]; s.players[2].money = [0, 0];
    s.ledger = s.players.map(p => sum(p.money));
    apply(s, 1, { type: 'koehandel', target: 2, animal: 'goat' }, s.clock++);
    const mv = A.act(s, 1, 'offer', rng(g)); cards.push(`[${mv.cards.join(',')}]`);
  }
  // 2: Buttercup's turn, ducks 1-1 with Goober (0) who holds exactly 40, deck still has animals
  let picks = {};
  for (let g = 0; g < 8; g++) {
    const s = setup(); s.turn = 1;
    s.players[0].animals.duck = 1; s.players[1].animals.duck = 1;
    s.players[0].money = [0, 0, 10, 10, 10, 10]; s.players[1].money = [0, 0, 10, 10, 10, 10, 50]; s.players[2].money = [0, 0, 10, 10, 10, 10, 50, 50];
    s.ledger = s.players.map(p => sum(p.money));
    const mv = A.act(s, 1, 'turn', rng(g)), key = mv.type === 'auction' ? 'auction' : `${mv.type} ${mv.target} ${mv.animal}`;
    picks[key] = (picks[key] || 0) + 1;
  }
  // 3: deck empty, Dolly (2) against Goober (0) for her last contested animal (a cat); money cannot matter after it
  let last = [];
  for (let g = 0; g < 4; g++) {
    const s = setup(); s.deck = []; s.turn = 2;
    Object.assign(s.players[0].animals, { cow: 2, mule: 1, cat: 1, chicken: 2 });
    Object.assign(s.players[1].animals, { horse: 2, mule: 1, goat: 2, dog: 2, duck: 2 });
    Object.assign(s.players[2].animals, { pig: 2, sheep: 2, cat: 1 });
    s.players[0].money = [0, 0, 100, 50, 50, 50, 50, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]; s.players[1].money = [50, 10, 100, 10]; s.players[2].money = [0, 0, 0, 0, 50, 100];
    s.ledger = s.players.map(p => sum(p.money));
    apply(s, 2, { type: 'koehandel', target: 0, animal: 'cat' }, s.clock++);
    last.push(`[${A.act(s, 2, 'offer', rng(g)).cards.join(',')}]`);
  }
  console.log(spec.padEnd(28), 'last cat:', last.join(' '));
  console.log(spec.padEnd(28), 'offers to broke Dolly:', cards.join(' '), ' | turn:', JSON.stringify(picks));
}
