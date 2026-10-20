// Plays batches of games for the arena. Message in: { id, games: [{ specs, seed, size }] }, out: { id, results }.
import { parentPort } from 'node:worker_threads';
import { newSimGame, playOut, rng, wins } from '../../lib/bots/sim.js';
import { makeAgent } from '../../lib/bots/levels.js';
import { novice } from './novice.mjs';

const cache = new Map();
const agentFor = spec => { const k = JSON.stringify(spec); if (!cache.has(k)) { if (cache.size > 200) cache.clear(); cache.set(k, spec.kind === 'novice' ? novice : makeAgent(spec)); } return cache.get(k); };
parentPort.on('message', ({ id, games }) => {
  const results = games.map(({ specs, seed, size }) => {
    const r = rng(seed), s = newSimGame(specs.length, size || 40, r);
    const sc = playOut(s, specs.map(agentFor), r);
    return { scores: sc, wins: wins(sc), done: s.phase === 'over' };
  });
  parentPort.postMessage({ id, results });
});
