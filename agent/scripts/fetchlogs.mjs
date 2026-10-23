// Download the logs of finished hosted games (kept 30 days in Redis by app/api/game/route.js) into games/:
// node agent/scripts/fetchlogs.mjs [max]
// Needs the Redis credentials in the environment or in .env.local (vercel env pull .env.local). Files already in
// games/ are skipped. Read them with: node agent/scripts/replay.mjs games/<file>.json
import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

const root = new URL('../../', import.meta.url), envFile = new URL('.env.local', root);
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const e = process.env;
const url = e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL;
const token = e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) { console.error('No Redis credentials: set them or run "vercel env pull .env.local" first.'); process.exit(1); }

const r = new Redis({ url, token, automaticDeserialization: false });
const dir = path.join(root.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'games'); fs.mkdirSync(dir, { recursive: true });
const names = (await r.lrange('log:index', 0, (+process.argv[2] || 1000) - 1)).map(String).filter(n => !fs.existsSync(path.join(dir, n + '.json')));
let saved = 0;
for (let i = 0; i < names.length; i += 20) { // a few games per request
  const part = names.slice(i, i + 20), vals = await r.mget(...part.map(n => 'log:' + n));
  part.forEach((n, x) => { if (typeof vals[x] === 'string') { fs.writeFileSync(path.join(dir, n + '.json'), vals[x]); saved++; } });
}
console.log(`${saved} new game${saved === 1 ? '' : 's'} saved to ${dir}`);
