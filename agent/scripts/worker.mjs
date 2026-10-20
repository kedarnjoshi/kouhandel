// Plays batches of games for the arena. Message in: { id, games: [{ specs, seed, size }] }, out: { id, results }.
import { parentPort } from 'node:worker_threads';
import { newSimGame, playOut, rng, wins } from '../../lib/bots/sim.js';
import { agentFor } from './registry.mjs';
parentPort.on('message', ({ id, games }) => {
  const results = games.map(({ specs, seed, size }) => {
    const r = rng(seed), s = newSimGame(specs.length, size || 40, r);
    const sc = playOut(s, specs.map(agentFor), r);
    return { scores: sc, wins: wins(sc), done: s.phase === 'over', errors: s.errors || 0, lastError: s.lastError };
  });
  parentPort.postMessage({ id, results });
});
