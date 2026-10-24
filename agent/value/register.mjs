// Lists an exported network in lib/bots/nets.js: node agent/value/register.mjs <id> "<comment line>"
// (after node agent/value/export.mjs <net.json> <id> wrote lib/bots/net<id>.js)
import fs from 'node:fs';
const [id, note] = process.argv.slice(2), p = 'lib/bots/nets.js';
let t = fs.readFileSync(p, 'utf8');
if (!fs.existsSync(`lib/bots/net${id}.js`)) throw new Error(`lib/bots/net${id}.js missing: export it first`);
if (!t.includes(`import net${id} from`)) {
  const nl = t.includes('\r\n') ? '\r\n' : '\n', imports = [...t.matchAll(/^import net\d+ from .*$/gm)], last = imports[imports.length - 1];
  t = t.slice(0, last.index + last[0].length) + nl + `import net${id} from './net${id}.js';` + t.slice(last.index + last[0].length);
  t = t.replace(/ };(\s*)$/, `, ${id}: entry(net${id}) };$1`);
  if (note) t = t.replace(/(\/\/ [^\n]*\n)(import \{ loadNet)/, `$1// ${note}${nl}$2`);
  fs.writeFileSync(p, t);
}
console.log(fs.readFileSync(p, 'utf8'));
