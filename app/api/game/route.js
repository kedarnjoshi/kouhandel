import { Redis } from '@upstash/redis';
import { newGame, newPlayer, apply, tick, view } from '../../../lib/engine';

export const dynamic = 'force-dynamic';
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = (globalThis.__kh ||= {}), sets = (globalThis.__khs ||= {}); // local dev fallback when no Redis is configured
const r = url ? new Redis({ url, token }) : {
  get: async k => (mem[k] ? JSON.parse(mem[k]) : null),
  set: async (k, v) => { mem[k] = JSON.stringify(v); },
  sadd: async (k, m) => { (sets[k] ||= new Set()).add(m); },
  srem: async (k, m) => { sets[k]?.delete(m); },
  smembers: async k => [...(sets[k] || [])],
};

const K = id => 'kh:' + id;
const find = (s, tok) => (tok ? s.players.findIndex(p => p.token === tok) : -1);
const save = (id, s) => r.set(K(id), s, { ex: 86400 }); // abandoned rooms vanish after 24h
async function load(id) { const s = id && await r.get(K(id)); if (!s) throw new Error('Room not found'); return s; }
const fail = (e, status = 400) => Response.json({ error: e.message }, { status });

export async function GET(req) {
  const q = new URL(req.url).searchParams, room = q.get('room');
  try {
    if (!room) { // list public rooms
      const out = [];
      for (const id of await r.smembers('rooms')) {
        const s = await r.get(K(id));
        if (!s) { await r.srem('rooms', id); continue; }
        out.push({ id, name: s.name, players: s.players.length, phase: s.phase });
      }
      return Response.json(out);
    }
    const s = await load(room), before = JSON.stringify(s);
    tick(s, Date.now());
    if (JSON.stringify(s) !== before) await save(room, s);
    return Response.json(view(s, find(s, q.get('token'))));
  } catch (e) { return fail(e, 404); }
}

export async function POST(req) {
  const b = await req.json();
  try {
    if (b.type === 'create') {
      const pub = !!b.public, code = String(b.code || '').trim();
      if (!pub && !code) throw new Error('Private tables need a code');
      const id = Math.random().toString(36).slice(2, 8);
      await save(id, newGame({ name: String(b.name || '').trim().slice(0, 24) || 'Table', public: pub, code: pub ? '' : code }));
      if (pub) await r.sadd('rooms', id);
      return Response.json({ room: id });
    }
    let s = await load(b.room);
    if (b.type === 'join') {
      if (!s.public && b.code !== s.code) throw new Error('Wrong table code');
      const name = String(b.name || '').trim().slice(0, 16);
      if (!name) throw new Error('Enter a name');
      let p = s.players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (p) { // same name: rejoin allowed in private rooms only
        if (s.public) throw new Error('That name is taken at this public table');
      } else {
        if (s.phase !== 'lobby') throw new Error('Game already started');
        if (s.players.length >= 5) throw new Error('Table is full');
        p = newPlayer(name, crypto.randomUUID()); s.players.push(p);
        await save(b.room, s);
      }
      return Response.json({ token: p.token });
    }
    const pi = find(s, b.token);
    if (pi < 0) throw new Error('You are not at this table');
    if (b.type === 'reset') { if (pi !== 0) throw new Error('Host only'); await save(b.room, newGame(s)); return Response.json({ ok: 1 }); }
    s = apply(s, pi, b);
    await save(b.room, s);
    return Response.json({ ok: 1 });
  } catch (e) { return fail(e); }
}