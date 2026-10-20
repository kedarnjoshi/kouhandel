// Bots at a real table: which levels exist, how long they "think", how they bid, and their moves.
import { makeAgent } from './levels.js';
import { sum } from '../rules.js';
import PARAMS from './params.js';

// spec: how the bot plays. think: [mean, spread] of its thinking time as a share of the table's time per move
// (the spread shrinks as the bots get better; the confusing bot is all over the place). react: [mean, spread]
// in ms before it answers a bid.
export const LEVELS = {
  easy: { spec: { kind: 'smart', th: PARAMS.easy, noise: 0.45, slip: 0.25 }, think: [0.25, 0.12], react: [2600, 1100] },
  medium: { spec: { kind: 'smart', th: PARAMS.medium, noise: 0.2, slip: 0.08 }, think: [0.25, 0.09], react: [2200, 800] },
  hard: { spec: { kind: 'smart', th: PARAMS.hard }, think: [0.25, 0.06], react: [1800, 550] },
  insane: { spec: { kind: 'insane', th: PARAMS.hard, worlds: 8, depth: 16 }, think: [0.25, 0.04], react: [1500, 350] },
  random: { spec: { kind: 'random' }, think: [0.2, 0.1], react: [2400, 1400] },
  confusing: { spec: { kind: 'confusing', th: PARAMS.medium }, think: [0.25, 0.22], react: [2000, 1700] },
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
export function nextBid(level, cur, cap, rand) {
  const gap = cap - cur;
  if (gap <= 10) return cur + 10;
  const wild = level === 'random' || level === 'confusing';
  const step = wild ? 10 * (1 + Math.floor(rand() * 5)) : cur < 60 || rand() < 0.5 ? 10 : Math.max(10, Math.min(100, Math.floor(gap * (0.1 + 0.2 * rand()) / 10) * 10));
  return Math.min(cap, cur + step);
}

// The most the bot will bid on the auction that just opened, and its move for a decision.
export function botCap(s, i, rand) { const l = s.players[i].bot; return Math.min(sum(s.players[i].money), agent(l).cap(s, i, rand)); }
export function botMove(s, i, what, rand) { return agent(s.players[i].bot).act(s, i, what, rand); }
