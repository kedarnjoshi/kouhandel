// Positions from self-play for learning a value function: node agent/scripts/datagen.mjs <games> <out.jsonl> [workers] [seed0]
// Every turn, from every player's side: what they can see (herds, money estimates, card counts, deck), the
// current model's win chances (as a baseline), and how the game ended (who won, who got each set).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';

const LINEUP = [['v2', 5], ['v2:solve=1', 8], ['v2:solve=1,shade=1.15', 2], ['v2:solve=1,shade=0.9', 2], ['v2:shade=1.2', 1], ['keen', 1], ['sniper', 1], ['hard0', 1], ['shark', 1], ['easyA', 1]];
if (isMainThread) {
  const [games = 100, out = 'data.jsonl', workers = Math.max(1, os.cpus().length - 1), seed0 = 1] = process.argv.slice(2);
  const f = fs.createWriteStream(out, { flags: 'a' });
  let next = 0, done = 0, pos = 0; const t0 = Date.now();
  for (let w = 0; w < +workers; w++) {
    const wk = new Worker(new URL(import.meta.url), { workerData: {} });
    const give = () => { if (next < +games) wk.postMessage(+seed0 + next++); else wk.terminate(); };
    wk.on('message', rows => {
      for (const r of rows) f.write(JSON.stringify(r) + '\n');
      pos += rows.length; done++;
      if (done % 50 === 0) console.log(`${done} games, ${pos} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (done === +games) { f.end(); console.log(`done: ${done} games, ${pos} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
      give();
    });
    give();
  }
} else {
  const { newSimGame, rng, settleAuction, wins } = await import('../../lib/bots/sim.js');
  const { apply, waiting, tick, score, countsOf } = await import('../../lib/engine.js');
  const { TYPES } = await import('../../lib/rules.js');
  const { Model } = await import('../../lib/bots/brain.js');
  const { look, EXPERT } = await import('../../lib/bots/expert.js');
  const { DEFAULTS } = await import('../../lib/bots/brain.js');
  const { agentFor } = await import('./registry.mjs');
  const th = { ...DEFAULTS, ...EXPERT };
  const pickW = (list, r) => { let W = 0; for (const [, w] of list) W += w; let x = r() * W; for (const [n, w] of list) { x -= w; if (x <= 0) return n; } return list[0][0]; };
  parentPort.on('message', seed => {
    const r = rng(seed * 7919 + 13), n = r() < 0.5 ? 3 : r() < 0.5 ? 4 : 5, size = 40;
    const names = Array.from({ length: n }, () => pickW(LINEUP, r)), agents = names.map(agentFor);
    const s = newSimGame(n, size, r), rows = [];
    for (let step = 0; s.phase !== 'over' && step < 1500; step++) {
      if (s.phase === 'auction' && s.auction.stage === 'bidding') { settleAuction(s, agents, r); continue; }
      const w = waiting(s); if (!w) break;
      if (w.what === 'turn') {
        const views = s.players.map((p, i) => {
          if (p.out) return null;
          const o = look(s, i), M = new Model(o, th);
          return { money: o.money, sd: o.sd.map(x => Math.round(x)), seenAs: o.seenAs, base: s.players.map((q, j) => (q.out ? 0 : +M.util(j, [], []).toFixed(4))) };
        });
        const o = look(s, w.p);
        rows.push({ n, turn: s.turn, herd: o.herd, cards: o.cards, remain: o.remain, deck: o.deckLeft, mules: o.mules, pool: o.pool, future: o.future, real: s.players.map(p => p.money.reduce((a, b) => a + b, 0)), views });
      }
      const t = s.clock++;
      try { apply(s, w.p, agents[w.p].act(s, w.p, w.what, r), t); } catch { s.due = t; tick(s, t); }
    }
    if (s.phase !== 'over') { parentPort.postMessage([]); return; }
    const sc = s.players.map(p => score(p, countsOf(s)).score), wn = wins(sc);
    const owner = TYPES.map(t => s.players.findIndex(p => p.animals[t] === countsOf(s)[t]));
    for (const x of rows) { x.gid = seed; x.wins = wn; x.owner = owner; x.scores = sc; x.names = names; }
    parentPort.postMessage(rows);
  });
}
