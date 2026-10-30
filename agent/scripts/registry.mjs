// Named opponents for experiments: a name -> agent ({ cap, act }). Levels of the live bots by name, the old
// (first-generation) bots, and the benchmark stand-ins that are not bots players can pick.
import { makeAgent } from '../../lib/bots/levels.js';
import { LEVELS } from '../../lib/bots/index.js';
import { novice } from './novice.mjs';
import { shark } from './shark.mjs';
import OLD from './old_params.mjs';

import { EXPERT } from '../../lib/bots/expert.js';
import { padder, caller, keen, sniper, hoarder, seller } from './exploiters.mjs';
import { loadNet, NetModel } from './net.mjs';
import fs from 'node:fs';
import { endgameChoice } from './endgame.mjs';
import { endModelOr } from './endmodel.mjs';
const named = {
  v2: () => makeAgent({ kind: 'expert', th: EXPERT }),
  v3: () => makeAgent({ kind: 'expert', th: { ...EXPERT, solve: 1, solveK: 13, solveIt: 80, solveEps: 0.04 } }),
  novice: () => novice,
  padder, caller, keen, sniper, hoarder, seller,
  shark: () => shark,
  hard0: () => makeAgent({ kind: 'smart', th: OLD.hard }),
  medium0: () => makeAgent({ kind: 'smart', th: OLD.hard, noise: 0.5, slip: 0.2 }),
  easy0: () => makeAgent({ kind: 'smart', th: OLD.easy, noise: 0.35, slip: 0.15 }),
  insane0: () => makeAgent({ kind: 'insane', th: OLD.hard, worlds: 16, depth: 16 }),
};
// named specs for experiments (agent/runs/specs2.json), e.g. candidate levels
const extra = (() => { try { return JSON.parse(fs.readFileSync(new URL('../runs/specs2.json', import.meta.url), 'utf8')); } catch { return {}; } })();
const cache = new Map();
export function agentFor(spec) {
  const key = typeof spec === 'string' ? spec : JSON.stringify(spec);
  if (cache.has(key)) return cache.get(key);
  let a;
  if (typeof spec !== 'string') a = spec.kind === 'novice' ? novice : makeAgent(spec);
  else if (spec.startsWith('peek:')) { // experiments: the agent sees everyone's true money
    const b = agentFor(spec.slice(5)), wrap = f => (s, ...r) => { s.peekForTests = true; try { return f(s, ...r); } finally { delete s.peekForTests; } };
    a = { cap: wrap(b.cap), act: wrap(b.act) };
  }
  else if (named[spec]) a = named[spec]();
  else if (extra[spec]) a = makeAgent(extra[spec]);
  else if (spec.startsWith('net:')) { // net:<file>[:k=v,...] v2 with a learned value function
    const [, file, rest] = spec.split(':'), over = rest ? Object.fromEntries(rest.split(',').map(kv => { const [k, v] = kv.split('='); return [k, +v]; })) : {};
    const net = loadNet(JSON.parse(fs.readFileSync(file, 'utf8')));
    a = makeAgent({ kind: 'expert', th: { ...EXPERT, ...over, makeModel: (o, th) => new NetModel(o, th, net) } });
  }
  else if (spec.startsWith('v2:')) { // v2 with parameter overrides: v2:shade=1.1,mDec=0.05
    const over = Object.fromEntries(spec.slice(3).split(',').map(kv => { const [k, v] = kv.split('='); return [k, +v]; }));
    a = makeAgent({ kind: 'expert', th: { ...EXPERT, ...over } });
  }
  else if (LEVELS[spec]) a = makeAgent(LEVELS[spec].spec);
  else if (LEVELS[spec.split(':')[0]] || extra[spec.split(':')[0]]) { // a level (or named spec) with parameter overrides: insane:shade=1.3,mDec=0.05
    if (spec.split(':').length > 2) throw new Error(`spec ${spec}: overrides are comma-separated (one colon)`);
    const [lv, rest] = spec.split(':'), base = LEVELS[lv] ? LEVELS[lv].spec : extra[lv];
    const over = Object.fromEntries(rest.split(',').map(kv => { const [k, v] = kv.split('='); return [k, +v]; }));
    if (over.endRoll) over.endgame = endgameChoice; // experiment: endgame lookahead (endgame.mjs)
    if (over.endModel) over.makeModel = endModelOr; // experiment: the endgame played out (endmodel.mjs)
    // small.k=v: the 20-card value of a setting that is blended by deck size (forDeck in lib/bots/expert.js)
    const small = { ...(base.th.small || {}) };
    for (const k of Object.keys(over)) if (k.startsWith('small.')) { small[k.slice(6)] = over[k]; delete over[k]; }
    // solo.k=v: the value of a setting when all the others are people (th.solo)
    const solo = { ...(base.th.solo || {}) };
    for (const k of Object.keys(over)) if (k.startsWith('solo.')) { solo[k.slice(5)] = over[k]; delete over[k]; }
    a = makeAgent({ ...base, th: { ...base.th, ...over, ...(Object.keys(small).length ? { small } : {}), ...(Object.keys(solo).length ? { solo } : {}) } });
  }
  else throw new Error('unknown agent ' + spec);
  if (cache.size > 200) cache.clear();
  cache.set(key, a); return a;
}
