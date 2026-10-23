// Fast self-play on the real engine: no clocks, no waiting. Auctions are settled the way bots bid them live
// (raising by small steps until only one bidder is left), so the winner pays just above the runner-up's limit.
import { newGame, newPlayer, apply, tick, waiting, score, countsOf, composition } from '../engine.js';
import { TYPES } from '../rules.js';

export const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
export const shuffle = (a, rand) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// A started game with n players, a deck of `size` animals, everything decided by `rand`.
export function newSimGame(n, size = 40, rand = Math.random) {
  const s = newGame({ deckSize: size });
  for (let i = 0; i < n; i++) s.players.push(newPlayer('P' + i, 't' + i));
  apply(s, 0, { type: 'start' }, 0);
  s.counts = size >= 40 ? Object.fromEntries(TYPES.map(t => [t, 4])) : composition(size, rand);
  s.deck = shuffle(TYPES.flatMap(t => Array(s.counts[t]).fill(t)), rand);
  s.turn = Math.floor(rand() * n); s.seed = Math.floor(rand() * 2 ** 31);
  s.log = []; s.clock = 1;
  return s;
}

// Settle the open auction: every bidder names a limit, the highest wins at the runner-up's limit + 10 (or at its
// opening bid, if that is higher).
export const bidOf = (agent, s, j, rand) => (agent.bid ? agent.bid(s, j, rand) : { cap: agent.cap(s, j, rand), open: 0 });
export function settleAuction(s, agents, rand) {
  const a = s.auction, caps = [];
  s.players.forEach((p, j) => {
    if (p.out || j === a.auctioneer) return;
    const b = bidOf(agents[j], s, j, rand), c = Math.min(b.cap, p.money.reduce((x, y) => x + y, 0));
    if (c >= 10) caps.push([Math.floor(c / 10) * 10, rand(), j, Math.min(c, b.open || 0)]);
  });
  caps.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  // as in a live English auction, everyone who drops out has bid up to their limit (the history shows it); the
  // winner tops the last of them by 10
  const top = caps.length && Math.max(caps[1] ? Math.min(caps[0][0], caps[1][0] + 10) : 10, Math.floor(caps[0][3] / 10) * 10);
  let cur = 0;
  for (let x = caps.length - 1; x >= 1; x--) {
    const amt = Math.min(caps[x][0], top - 10);
    if (amt > cur) { apply(s, caps[x][2], { type: 'bid', amount: amt }, s.clock); cur = amt; }
  }
  if (caps.length) apply(s, caps[0][2], { type: 'bid', amount: top }, s.clock);
  s.clock = s.auction.deadline; tick(s, s.clock); s.clock++;
}

// Play until the game ends (or maxSteps decisions, against endless koehandel ping-pong). Returns final scores.
export function playOut(s, agents, rand, maxSteps = 1500) {
  for (let step = 0; s.phase !== 'over' && step < maxSteps; step++) {
    if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, rand); continue; }
    const w = waiting(s);
    if (!w) break;
    const t = s.clock++;
    let mv;
    try { mv = agents[w.p].act(s, w.p, w.what, rand); } catch (e) { s.errors = (s.errors || 0) + 1; s.lastError = String(e && e.stack || e).slice(0, 300); }
    try { apply(s, w.p, mv, t); }
    catch { s.due = t; tick(s, t); } // a refused move: the engine makes the obvious one, as on a timeout
  }
  return s.players.map(p => score(p, countsOf(s)).score);
}

// Share of the win for each seat (ties split).
export function wins(scores) {
  const best = Math.max(...scores), n = scores.filter(x => x === best).length;
  return scores.map(x => (x === best ? 1 / n : 0));
}
