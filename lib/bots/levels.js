// The bots players can add, built from a spec: { kind: 'smart', th, noise, slip } | { kind: 'random' } | ...
import { smart, random, confusing } from './policies.js';
import { DEFAULTS } from './brain.js';
import { insane } from './insane.js';

export function makeAgent(spec) {
  const th = { ...DEFAULTS, ...(spec.th || {}) };
  if (spec.kind === 'random') return random;
  if (spec.kind === 'confusing') return confusing(th);
  if (spec.kind === 'insane') return insane(th, { worlds: spec.worlds, depth: spec.depth });
  return smart(th, { noise: spec.noise || 0, slip: spec.slip || 0 });
}
