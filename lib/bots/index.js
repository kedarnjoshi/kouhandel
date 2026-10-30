// Bots at a real table: which levels exist, how long they "think", how they bid, and their moves.
import { makeAgent } from './levels.js';
import { sum } from '../rules.js';
import { EXPERT, publicLimit } from './expert.js';
import { DEFAULTS } from './brain.js';

// spec: how the bot plays. think: [mean, spread] of its thinking time as a share of the table's time per move
// (the spread shrinks as the bots get better; the confusing bot is all over the place). react: [mean, spread]
// in ms before it answers a bid.
// Easy, Medium and Hard play with the second-generation judgement (lib/bots/expert.js); Insane adds the koehandel
// solver (lib/bots/solver.js). Easy was calibrated to a beginner stand-in, Medium to halfway between Easy and Hard
// (agent/README.md). Every seat also gets a small personality of its own (style: how strongly).
const easyTh = { ...EXPERT, naive: 1, shade: 0.8, mDec: 0.1, khBias: -0.03, style: 1.5 };
// Insane values money less than the others (delta 0.6, bids 15% over the model's limit): recalibrated against a mixed
// field at 3 players, see agent/README.md. muScale: the model's money offset follows the money in play (smaller decks
// have much less of it). habits: as defender it also reads an attacker's offers by how that attacker's earlier offers
// to it looked. open: opens high where a bid of 10 would let the auctioneer buy back for nothing. sharp: guesses
// hands that fit what is known about everyone's money. padCost, allIn: no padding with zeros for nothing, and
// everything in when money can no longer matter. openHist: how likely an auctioneer is to buy back (which makes a high
// opening bid pay) also goes by how often that player actually did so far. small: the settings for a 20-card deck
// (every set a pair), tuned there against a mixed field; between 20 and 30 cards blended with the full-deck ones
// (forDeck in lib/bots/expert.js). With 20 cards money also counts for more as the deck runs out (muEnd, deltaEnd),
// the card tracker (lib/bots/tracker.js) informs the money estimates and the other side's possible hands (track,
// trackHands) and the turn choice solves each possible koehandel more carefully (roughK, roughIt): first tuned for 20
// cards, with the full deck since the eighth round. Also only with 20 cards (they cost a little with the full deck):
// own, a player who can hardly win plays for its own score rather than for who of the others wins; mDecP, a cheap
// buy-back needs less of a margin than a dear one (see the sixth round in agent/README.md). The 20-card values were retuned in the seventh round with a counter-strategy
// and tables of one player against two Insanes in the field: two Insanes drove each other's prices up for the third
// player, so they now bid about at their model's limit (shade 0.95) and start koehandels a little less readily.
// net, netMix (eighth round): with 20 cards the chances to win are half the formula's, half a network's that learned
// them from simulated games (lib/bots/value.js, agent/value). With the full deck a fifth a network's (net 2, flattened by
// netT 2.17), with its own decision settings tuned for it (agent/runs/t9: koehandels only when clearly better than an
// auction, khBias -0.6; t9's shadeK -1, bidding above the limit when the others bid low, was a leak against
// hoarders such as x9 and is off). habitsA,
// habitsAll: as attacker it offers less to a player who keeps accepting offers (from everyone's koehandels with them).
// khBiasP: the koehandel restraint against a person: none with 20 cards; with the full deck as against bots, since
// with no restraint a player who answers koehandels well takes the money (eighth round in agent/README.md).
// softCap, capSure (tenth round, from a person's game): the auctioneer's buy-back counts as a chance in the bid limit
// too (with a yes/no guess the limit search stopped at near-ties: a cow worth 200 to the bot got a limit of 20), and
// a counter never goes above what surely beats the attacker's whole money (estimate + 3 sds): more cannot change the
// result and only hands the attacker money (a beaten bot countered 1410 where 500 was sure, and decided the game).
export const INSANE = {
  ...EXPERT, delta: 0.6, shade: 1.04, muScale: 1, solve: 1, solveK: 13, solveIt: 80, solveEps: 0.04, habits: 0.3, style: 0.3, open: 1, openHist: 2, sharp: 1, padCost: 0.5, allIn: 1,
  muEnd: 1, deltaEnd: 0.6, roughK: 9, roughIt: 45, track: 1, trackHands: 1, own: 0, mDecP: 0, khBias: -0.6, mDec: 0.104, net: 2, netMix: 0.2, netT: 2.17, shadeK: 0, habitsA: 1, habitsAll: 1, khBiasP: -0.6, softCap: 1, capSure: 3,
  small: { delta: 0.986, deltaEnd: 1.16, muEnd: 0.746, shade: 0.953, mu: 620, gamma: 1.27, rho: 0.756, tau: 2.2, tau1: 142, mDec: 0.0641, khBias: -0.186, roughK: 9, roughIt: 45, track: 1, trackHands: 1, own: 1, mDecP: 1, net: 3, netMix: 0.5, netT: 1, shadeK: 0, khBiasP: 0 },
};
export const LEVELS = {
  easy: { spec: { kind: 'expert', th: easyTh, noise: 0.4, slip: 0.2 }, think: [0.25, 0.12], react: [2600, 1100] },
  medium: { spec: { kind: 'expert', th: { ...EXPERT, style: 1 }, noise: 0.2, slip: 0.06 }, think: [0.25, 0.09], react: [2200, 800] },
  hard: { spec: { kind: 'expert', th: { ...EXPERT, style: 0.6 } }, think: [0.25, 0.06], react: [1800, 550] },
  insane: { spec: { kind: 'expert', th: INSANE }, think: 1000, react: [500, 0], bidGap: 0 }, // a second per move, half a second per bid: just easy to follow
  random: { spec: { kind: 'random' }, think: [0.2, 0.1], react: [2400, 1400] },
  confusing: { spec: { kind: 'confusing', th: { ...EXPERT } }, think: [0.25, 0.22], react: [2000, 1700] },
};
export const isLevel = l => Object.prototype.hasOwnProperty.call(LEVELS, l);
const agents = {};
const agent = l => (agents[l] ||= makeAgent(LEVELS[l].spec));

export const NAMES = ['Bessie', 'Clover', 'Daisy', 'Hamlet', 'Mabel', 'Wilbur', 'Dolly', 'Pippin', 'Rosie', 'Barnaby', 'Truffle', 'Buttercup', 'Gus', 'Hazel'];
export const botName = (taken, rand = Math.random) => {
  const free = NAMES.filter(n => !taken.some(t => t.toLowerCase() === n.toLowerCase()));
  return free.length ? free[Math.floor(rand() * free.length)] : 'Bot ' + (taken.length + 1);
};

// Deterministic randomness per table, player and moment, so whoever triggers a bot move gets the same move.
export function botRand(s, i, salt) {
  let h = (s.seed | 0) ^ 0x9e3779b9;
  for (const c of `${i}|${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 0x85ebca6b) ^ (h >>> 13);
  let seed = h >>> 0;
  return () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const gauss = rand => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

// How long the bot takes for a decision: on average a quarter of the time per move (at most 10s, so long time
// limits do not drag), and just a moment when there is only one move (only: see onlyMove in lib/engine.js). Never
// close to the limit. A level whose think is a number (Insane) takes just that long for every move: it does not act
// out thinking, the wait is only there so people can follow.
export function thinkMs(level, what, limitMs, rand, only = false) {
  if (typeof LEVELS[level].think === 'number') return LEVELS[level].think;
  if (only) return 600 + Math.round(900 * rand()); // nothing to think about: just a moment
  const [mean, spread] = LEVELS[level].think, base = Math.min(mean * limitMs, 10000), frac = base / limitMs;
  const f = Math.min(0.8, Math.max(0.04, frac + spread * (base / (mean * limitMs)) * gauss(rand)));
  return Math.max(700, Math.round(f * limitMs * (what === 'pay' ? 0.5 : 1)));
}
// Delay before answering a bid, and the next bid itself (small steps, bigger when far below its limit).
export function reactMs(level, rand) { const [m, sd] = LEVELS[level].react; return Math.max(500, Math.round(m + sd * gauss(rand))); }
export function nextBid(level, cur, cap, rand, open = 0) {
  if (open > cur + 10 && open <= cap) return open;
  const gap = cap - cur;
  if (gap <= 10) return cur + 10;
  const wild = level === 'random' || level === 'confusing';
  const step = wild ? 10 * (1 + Math.floor(rand() * 5)) : cur < 60 || rand() < 0.5 ? 10 : Math.max(10, Math.min(100, Math.floor(gap * (0.1 + 0.2 * rand()) / 10) * 10));
  return Math.min(cap, cur + step);
}

// The most the bot will bid on the auction that just opened, and its move for a decision.
// The limit and the opening bid (0: none, just top the highest bid).
export function botBid(s, i, rand) {
  const A = agent(s.players[i].bot), m = sum(s.players[i].money);
  const b = A.bid ? A.bid(s, i, rand) : { cap: A.cap(s, i, rand), open: 0 };
  return { cap: Math.min(m, b.cap), open: Math.min(m, b.cap, b.open || 0) };
}
export function botMove(s, i, what, rand) { return agent(s.players[i].bot).act(s, i, what, rand); }

// What a plain bidder in each seat would pay for the animal just put up, from public information only (kept with
// the auction, so the bots can later see how keen each player bids compared to that).
const PLAIN = { ...DEFAULTS, ...EXPERT };
export function publicLimits(s) { try { return publicLimit(s, PLAIN); } catch { return {}; } }
