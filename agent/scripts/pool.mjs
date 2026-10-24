// A pool of worker threads that play games in parallel.
import { Worker } from 'node:worker_threads';
import os from 'node:os';

// POOL=n caps the workers (for example to leave room for a game being played on the same computer).
export function pool(size = +process.env.POOL || Math.max(1, os.cpus().length - 1)) {
  const workers = [], queue = [], waiting = new Map(); let next = 0;
  const idle = [];
  const pump = () => { while (idle.length && queue.length) { const w = idle.pop(), job = queue.shift(); w.job = job; w.postMessage({ id: job.id, games: job.games }); } };
  for (let i = 0; i < size; i++) {
    const w = new Worker(new URL('./worker.mjs', import.meta.url));
    w.on('message', ({ id, results }) => { waiting.get(id)(results); waiting.delete(id); idle.push(w); pump(); });
    w.on('error', e => { console.error('worker error', e); process.exit(1); });
    workers.push(w); idle.push(w);
  }
  return {
    size,
    // Play all games (in chunks of `chunk`), resolve with the results in order.
    play(games, chunk = 8) {
      const parts = [];
      for (let i = 0; i < games.length; i += chunk) {
        const id = next++, slice = games.slice(i, i + chunk);
        parts.push(new Promise(res => { waiting.set(id, res); queue.push({ id, games: slice }); }));
      }
      pump();
      return Promise.all(parts).then(r => r.flat());
    },
    close() { for (const w of workers) w.terminate(); },
  };
}

// Duplicate-style match: every deal is played once with the candidate in each seat, the rest of the seats taken
// by the field (cycled), which removes most of the luck of the deal and of the seating.
export function duplicate(candidate, field, { deals, players = 4, size = 40, seed0 = 1 }) {
  const games = [];
  for (let d = 0; d < deals; d++) for (let seat = 0; seat < players; seat++) {
    const specs = [];
    for (let i = 0, f = 0; i < players; i++) specs.push(i === seat ? candidate : field[(d + f++) % field.length]);
    games.push({ specs, seed: seed0 + d, size, seat });
  }
  return games;
}
export const candidateShare = (games, results) => results.reduce((a, r, i) => a + r.wins[games[i].seat], 0) / results.length;
