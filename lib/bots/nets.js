// The learned position models (lib/bots/value.js) by id, as th.net picks them; each is for 3 players and one deck
// size: 1 and 2, 40 cards (2: more games, with the network bot and more other kinds of players among them); 3, 20 cards;
// 4, 40 cards, also reading how each player has played so far (styleOf).
import { loadNet } from './value.js';
import net1 from './net1.js';
import net2 from './net2.js';
import net3 from './net3.js';
import net4 from './net4.js';
const entry = j => ({ ...loadNet(j), json: j });
export const NETS = { 1: entry(net1), 2: entry(net2), 3: entry(net3), 4: entry(net4) };
