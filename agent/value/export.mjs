// Writes a trained network (agent/value/train.py's json) as a module the bots import: lib/bots/net<id>.js.
//   node agent/value/export.mjs <net.json> <id>   (then list it in lib/bots/nets.js)
import fs from 'node:fs';
const [file, id] = process.argv.slice(2), j = JSON.parse(fs.readFileSync(file, 'utf8'));
const r = x => (Array.isArray(x) ? x.map(r) : +x.toPrecision(7));
const out = { players: j.players, size: j.size ?? 40, arch: j.arch, style: j.style || 0, ft: j.ft, fp: j.fp, weights: Object.fromEntries(Object.entries(j.weights).map(([k, v]) => [k, r(v)])) };
const src = file.split('\\').join('/');
fs.writeFileSync(`lib/bots/net${id}.js`, `// A learned position model (agent/value/train.py, ${src}); see lib/bots/value.js.\nexport default ${JSON.stringify(out)};\n`);
console.log(`lib/bots/net${id}.js`, fs.statSync(`lib/bots/net${id}.js`).size, 'bytes');
