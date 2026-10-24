// Writes the bot settings the C++ simulator reads (agent/cpp/levels.json): DEFAULTS, EXPERT, the card tracker's
// TRACKER, the learned models' weights (NETS) and every level's spec, straight from lib/bots, so the C++ always plays the levels as they are in the JS.
// The C++ programs run this when they start (unless KH_NO_REFRESH is set), and so does build.sh.
import fs from 'node:fs';
import { LEVELS } from '../../lib/bots/index.js';
import { DEFAULTS } from '../../lib/bots/brain.js';
import { EXPERT } from '../../lib/bots/expert.js';
import { TRACKER } from '../../lib/bots/tracker.js';
import { NETS } from '../../lib/bots/nets.js';
const levels = Object.fromEntries(Object.entries(LEVELS).filter(([, l]) => l.spec.kind === 'expert').map(([k, l]) => [k, l.spec]));
const file = new URL('./levels.json', import.meta.url), tmp = new URL(`./levels.json.${process.pid}`, import.meta.url);
fs.writeFileSync(tmp, JSON.stringify({ DEFAULTS, EXPERT, TRACKER, levels, NETS: Object.fromEntries(Object.entries(NETS).map(([k, v]) => [k, v.json])) }, null, 1) + '\n');
fs.renameSync(tmp, file); // whole, for programs reading it meanwhile
