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
// everything in when money can no longer matter.
export const INSANE = { ...EXPERT, delta: 0.6, shade: 1.15, muScale: 1, solve: 1, solveK: 13, solveIt: 80, solveEps: 0.04, habits: 0.3, style: 0.3, open: 1, sharp: 1, padCost: 0.5, allIn: 1 };
export const LEVELS = {
  easy: { spec: { kind: 'expert', th: easyTh, noise: 0.4, slip: 0.2 }, think: [0.25, 0.12], react: [2600, 1100] },
  medium: { spec: { kind: 'expert', th: { ...EXPERT, style: 1 }, noise: 0.2, slip: 0.06 }, think: [0.25, 0.09], react: [2200, 800] },
  hard: { spec: { kind: 'expert', th: { ...EXPERT, style: 0.6 } }, think: [0.25, 0.06], react: [1800, 550] },
  insane: { spec: { kind: 'expert', th: INSANE }, think: [0.25, 0.04], react: [1500, 350] },
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
// limits do not drag), quicker for paying. Never close to the limit.
export function thinkMs(level, what, limitMs, rand) {
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
