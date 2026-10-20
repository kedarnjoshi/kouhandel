import { Redis } from '@upstash/redis';
import { randomUUID, randomInt } from 'crypto';
import { newGame, newPlayer, apply, tick, view, upgrade, host } from '../../../lib/engine';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// Redis deletes rooms by itself: a game expires 10 minutes after its last move or player heartbeat (so a table
// everyone left ends and disappears). A finished game is deleted 15 minutes after it ended, so players can still
// look at the scores, and it leaves the public list after 2 minutes.
const ACTIVE_TTL = 600, OVER_TTL = 900, LISTED_AFTER_END = 120000;
const ttlFor = s => (s.phase === 'over' ? OVER_TTL : ACTIVE_TTL);

// A room is stored as "<version>|<json>". A write only lands if the version is still the one we read
// (version 0 = "must not exist yet", L = "still in the old plain-JSON format"), so simultaneous requests
// can never overwrite each other's moves.
const CAS = `local cur = redis.call('GET', KEYS[1])
if ARGV[1] == '0' then
  if cur then return 0 end
elseif ARGV[1] == 'L' then
  if not cur or string.match(cur, '^%d+|') then return 0 end
elseif not cur or string.match(cur, '^(%d+)|') ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1`;

function redisStore() {
  const r = new Redis({ url, token, automaticDeserialization: false }); // raw strings: we do our own JSON
  return {
    get: k => r.get(k),
    mget: ks => (ks.length ? r.mget(...ks) : []),
    cas: async (k, v, val, ttl) => Number(await r.eval(CAS, [k], [String(v), val, String(ttl)])) === 1,
    sadd: (k, m) => r.sadd(k, m),
    srem: (k, m) => r.srem(k, m),
    smembers: async k => (await r.smembers(k)).map(String),
    hset: (k, f, val) => r.hset(k, { [f]: String(val) }),
    hgetall: async k => { // raw mode returns a flat [field, value, ...] list
      const a = await r.hgetall(k);
      if (!Array.isArray(a)) return a || {};
      const o = {}; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; return o;
    },
    hdel: (k, ...f) => r.hdel(k, ...f),
    expire: (k, sec) => r.expire(k, sec),
    beat: (room, seen, f, val, ttl) => { const p = r.pipeline().hset(seen, { [f]: String(val) }).expire(seen, ACTIVE_TTL); if (ttl) p.expire(room, ttl); return p.exec(); }, // one HTTP call
  };
}
function memStore() { // local dev fallback when no Redis is configured (single process only)
  const kv = (globalThis.__kh ||= {}), sets = (globalThis.__khs ||= {}), exp = (globalThis.__khx ||= {});
  const live = k => { if (exp[k] && exp[k] <= Date.now()) { delete kv[k]; delete exp[k]; } return kv[k] ?? null; };
  const expire = async (k, sec) => { if (kv[k] != null) exp[k] = Date.now() + sec * 1000; };
  return {
    get: async k => live(k),
    mget: async ks => ks.map(live),
    cas: async (k, v, val, ttl) => {
      const cur = live(k), ver = cur == null ? null : /^\d+\|/.test(cur) ? cur.split('|', 1)[0] : 'L';
      if (String(v) === '0' ? cur != null : ver !== String(v)) return false;
      kv[k] = val; exp[k] = Date.now() + ttl * 1000; return true;
    },
    sadd: async (k, m) => { (sets[k] ||= new Set()).add(m); },
    srem: async (k, m) => { sets[k]?.delete(m); },
    smembers: async k => [...(sets[k] || [])],
    hset: async (k, f, val) => { (kv[k] ||= {})[f] = String(val); },
    hgetall: async k => ({ ...(kv[k] || {}) }),
    hdel: async (k, ...f) => { for (const x of f) delete kv[k]?.[x]; },
    expire,
    beat: async (room, seen, f, val, ttl) => { (kv[seen] ||= {})[f] = String(val); await expire(seen, ACTIVE_TTL); if (ttl) await expire(room, ttl); },
  };
}
const store = url ? redisStore() : memStore();
class HttpError extends Error { constructor(m, status) { super(m); this.status = status; } }
const db = () => store;

const K = id => 'kh:' + id;
const ROOM = /^[a-z0-9]{1,12}$/;
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1, easy to read out loud
const newId = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const find = (s, tok) => (typeof tok === 'string' && tok ? s.players.findIndex(p => p.token === tok) : -1);
const encode = (v, s) => v + '|' + JSON.stringify(s);
function decode(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d+)\|/.exec(raw);
  if (m) return { v: Number(m[1]), tag: m[1], s: upgrade(JSON.parse(raw.slice(m[0].length))) };
  return raw[0] === '{' ? { v: 0, tag: 'L', s: upgrade(JSON.parse(raw)) } : null; // saved by the previous version of the app
}
const notFound = () => new HttpError('Room not found', 404);
async function load(id) {
  const d = typeof id === 'string' && ROOM.test(id) ? decode(await db().get(K(id))) : null;
  if (!d) throw notFound();
  return d;
}
// Read-modify-write with retry. fn returns [newState, result]; newState null means "nothing to save".
// `ready` is a state already loaded and changed by the caller: it is tried first, so the work is not done twice.
async function mutate(id, fn, ready) {
  for (let i = 0; i < 10; i++) {
    let v, tag, next, out;
    if (i === 0 && ready) ({ v, tag, s: next } = ready);
    else {
      const d = await load(id); ({ v, tag } = d);
      [next, out] = fn(d.s);
      if (!next) return { v, s: d.s, out };
    }
    if (await db().cas(K(id), tag, encode(v + 1, next), ttlFor(next))) return { v: v + 1, s: next, out };
    await new Promise(res => setTimeout(res, 20 + Math.random() * 60 * (i + 1))); // someone else wrote first: retry
  }
  throw new HttpError('The table is busy, please try again', 503);
}

// Presence: seated players add hb=1 to a poll at most every 20s. That heartbeat keeps the room alive (see ACTIVE_TTL)
// and, in the lobby, frees the seats of players who stopped polling. Closing the tab sends a "bye" that makes the
// seat expire after a short grace period (so a page refresh keeps it).
const SEEN = id => K(id) + ':seen', LOBBY_TIMEOUT = 90000, BYE_GRACE = 8000;
async function pruneLobby(id, s, now) {
  if (s.phase !== 'lobby' || s.players.length < 2) return null;
  const seen = await db().hgetall(SEEN(id));
  const stale = s.players.filter(p => seen[p.token] && now - Number(seen[p.token]) > LOBBY_TIMEOUT).map(p => p.token);
  if (!stale.length) return null;
  const r = await mutate(id, x => {
    if (x.phase !== 'lobby') return [null];
    let gone = 0;
    for (let i = x.players.length - 1; i >= 0; i--) if (stale.includes(x.players[i].token)) { apply(x, i, { type: 'leave' }); gone++; }
    return [gone ? x : null];
  });
  await db().hdel(SEEN(id), ...stale);
  return r;
}

// Soft per-instance limit so a buggy or malicious client cannot hammer the API (the real client polls far slower).
const hits = new Map(), MAX_PER_SEC = process.env.NODE_ENV === 'test' ? Infinity : 5;
function limited(key, now) {
  const h = hits.get(key);
  if (!h || now - h[0] > 1000) { if (hits.size > 5000) hits.clear(); hits.set(key, [now, 1]); return false; }
  return ++h[1] > MAX_PER_SEC;
}

const fail = (e, status) => Response.json({ error: e.message || 'Server error' }, { status: e.status || status });

export async function GET(req) {
  const q = new URL(req.url).searchParams, room = q.get('room');
  try {
    const tok = q.get('token'), now = Date.now();
    if (limited(tok || req.headers.get('x-forwarded-for') || 'anon', now)) return Response.json({ error: 'Too many requests' }, { status: 429 });
    if (room === null) { // list public rooms (2 Redis commands, plus cleanup of expired ones)
      const ids = await db().smembers('rooms'), raws = await db().mget(ids.map(K)), out = [];
      for (let i = 0; i < ids.length; i++) {
        const d = decode(raws[i]);
        if (!d) { await db().srem('rooms', ids[i]); continue; }
        if (d.s.phase === 'over' && !(now - d.s.endedAt < LISTED_AFTER_END)) continue; // finished tables leave the list after 2 minutes
        out.push({ id: ids[i], name: d.s.name, players: d.s.players.filter(p => !p.out).length, phase: d.s.phase });
      }
      return Response.json(out);
    }
    let { v, tag, s } = await load(room);
    const pi = find(s, tok);
    if (q.get('hb') && pi >= 0 && !s.players[pi].out) { // heartbeat from a seated player
      await db().beat(K(room), SEEN(room), tok, now, s.phase === 'over' ? 0 : ACTIVE_TTL); // a finished game is not kept alive by people looking at it
      if (s.phase === 'lobby') { const r = await pruneLobby(room, s, now); if (r) ({ v, s } = r, tag = String(v)); }
    }
    const before = JSON.stringify(s);
    tick(s, Date.now()); // timers and bot moves happen lazily, triggered by whoever looks first
    if (JSON.stringify(s) !== before) ({ v, s } = await mutate(room, x => { tick(x, Date.now()); return [x]; }, { v, tag, s }));
    return Response.json({ ...view(s, find(s, tok)), v });
  } catch (e) { return fail(e, 500); }
}

export async function POST(req) {
  try {
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== 'object') throw new Error('Bad request');
    if (b.type === 'create') {
      const pub = !!b.public, code = String(b.code ?? '').trim();
      if (!pub && !code) throw new Error('Private tables need a code');
      const game = newGame({ name: String(b.name ?? '').trim().slice(0, 24) || 'Table', public: pub, code: pub ? '' : code.slice(0, 40), showLog: b.log !== false, timeout: b.timeout, deckSize: b.deckSize });
      for (let i = 0; i < 5; i++) {
        const id = newId();
        if (!(await db().cas(K(id), 0, encode(1, game), ACTIVE_TTL))) continue; // id already taken: pick another
        if (pub) await db().sadd('rooms', id);
        return Response.json({ room: id });
      }
      throw new Error('Could not create a table, please try again');
    }
    if (b.type === 'join') {
      const name = String(b.name ?? '').trim().slice(0, 16), code = String(b.code ?? '').trim();
      const { out } = await mutate(b.room, s => {
        if (!s.public && code !== s.code) throw new Error('Wrong table code');
        if (!name) throw new Error('Enter a name');
        const p = s.players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (p) { // same name: rejoin allowed in private rooms only
          if (p.bot) throw new Error('A bot at this table already has that name');
          if (s.public) throw new Error('That name is taken at this public table');
          return [null, { token: p.token }];
        }
        if (s.phase !== 'lobby') throw new Error('Game already started');
        if (s.players.length >= 5) throw new Error('Table is full');
        const np = newPlayer(name, randomUUID()); s.players.push(np);
        return [s, { token: np.token }];
      });
      await db().beat(K(b.room), SEEN(b.room), out.token, Date.now(), ACTIVE_TTL);
      return Response.json(out);
    }
    if (b.type === 'bye') { // sent by the browser when the tab closes; only matters in the lobby
      const { s } = await load(b.room);
      if (s.phase === 'lobby' && find(s, b.token) >= 0) await db().hset(SEEN(b.room), b.token, Date.now() - LOBBY_TIMEOUT + BYE_GRACE);
      return Response.json({ ok: 1 });
    }
    const { out } = await mutate(b.room, s => {
      const pi = find(s, b.token);
      if (pi < 0) throw new Error('You are not at this table');
      if (b.type === 'reset') { if (pi !== host(s)) throw new Error('Host only'); return [newGame(s), { ok: 1 }]; }
      return [apply(s, pi, b), { ok: 1 }];
    });
    return Response.json(out);
  } catch (e) { return fail(e, 400); }
}
