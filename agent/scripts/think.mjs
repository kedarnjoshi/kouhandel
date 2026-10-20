// Samples of how long each bot level thinks at a table with 30s per move -> agent/runs/think.json
import { writeFileSync } from 'node:fs';
import { LEVELS, thinkMs, botRand } from '../../lib/bots/index.js';
const out = {};
for (const l of Object.keys(LEVELS)) { const r = botRand({ seed: 7 }, 0, l); out[l] = Array.from({ length: 5000 }, () => thinkMs(l, 'turn', 30000, r)); }
writeFileSync('agent/runs/think.json', JSON.stringify(out));
for (const l in out) { const xs = out[l], m = xs.reduce((a, b) => a + b) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); console.log(l.padEnd(10), 'mean', (m / 1000).toFixed(2) + 's', 'sd', (sd / 1000).toFixed(2) + 's'); }
