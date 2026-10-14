// Lobby logic at the route-handler level, using the in-memory store (no Redis, no HTTP server).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

let GET, POST;
beforeAll(async () => {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  ({ GET, POST } = await import('../app/api/game/route.js'));
});
beforeEach(() => { for (const o of [globalThis.__kh, globalThis.__khs]) for (const k of Object.keys(o)) delete o[k]; });

const U = 'http://t/api/game';
const post = async b => { const r = await POST(new Request(U, { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, body: await r.json() }; };
const get = async q => { const r = await GET(new Request(U + q)); return { status: r.status, body: await r.json() }; };
const create = async (o = {}) => (await post({ type: 'create', name: 'T', public: true, ...o })).body.room;
const join = async (room, name, code) => (await post({ type: 'join', room, name, code })).body.token;
const peek = async (room, token = '') => (await get(`?room=${room}&token=${token}`)).body;
const fill = async (room, names = ['a', 'b', 'c'], code) => { const t = []; for (const n of names) t.push(await join(room, n, code)); return t; };

describe('creating and listing tables', () => {
  // A created public table shows up in the list with its name, 0 players and lobby phase.
  it('creates a public table that appears in the list', async () => {
    const r = await post({ type: 'create', name: 'Farm', public: true });
    expect(r.status).toBe(200);
    expect((await get('')).body).toEqual([{ id: r.body.room, name: 'Farm', players: 0, phase: 'lobby' }]);
  });
  // Private tables need a non-blank code and never appear in the public list.
  it('requires a code for private tables and keeps them out of the list', async () => {
    const bad = await post({ type: 'create', name: 'X', public: false, code: '  ' });
    expect(bad.status).toBe(400); expect(bad.body.error).toMatch(/code/);
    expect((await post({ type: 'create', name: 'X', public: false, code: 'k' })).status).toBe(200);
    expect((await get('')).body).toEqual([]);
  });
  // Table names are trimmed, default to "Table" when blank, and are cut to 24 characters.
  it('trims names, defaults blank ones and caps length at 24', async () => {
    const a = await create({ name: '   ' }), b = await create({ name: '  Barn  ' }), c = await create({ name: 'x'.repeat(40) });
    expect((await peek(a)).name).toBe('Table'); expect((await peek(b)).name).toBe('Barn'); expect((await peek(c)).name).toHaveLength(24);
  });
  // The list shows every public table with its current player count.
  it('lists several public tables with live player counts and phases', async () => {
    const a = await create({ name: 'A' }), b = await create({ name: 'B' });
    await fill(a, ['p', 'q', 'r']); await join(b, 'solo');
    const list = (await get('')).body;
    expect(list).toHaveLength(2);
    expect(list.find(x => x.id === a)).toMatchObject({ players: 3, phase: 'lobby' });
    expect(list.find(x => x.id === b)).toMatchObject({ players: 1 });
  });
  // The list shows a table's phase changing after the game starts.
  it('shows a table as in-game once started', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'start', room: a, token: t[0] });
    expect((await get('')).body[0].phase).toBe('turn');
  });
  // A table whose data has expired disappears from the list and from the public index.
  it('drops expired tables from the list', async () => {
    const a = await create(); delete globalThis.__kh['kh:' + a];
    expect((await get('')).body).toEqual([]); expect(globalThis.__khs.rooms.has(a)).toBe(false);
  });
});

describe('joining', () => {
  // Public tables accept anyone without a code; seats are assigned in join order.
  it('lets anyone into a public table with no code, in seat order', async () => {
    const a = await create(); const [t0, t1] = await fill(a, ['x', 'y']);
    expect((await peek(a, t0)).me).toBe(0); expect((await peek(a, t1)).me).toBe(1);
  });
  // No token or an unknown token gives a spectator view (me = -1, no money shown).
  it('treats a missing or invalid token as a spectator', async () => {
    const a = await create(); await fill(a);
    expect((await peek(a)).me).toBe(-1); expect((await peek(a, 'nope')).me).toBe(-1);
    (await peek(a)).players.forEach(p => expect(p.money).toBeNull());
  });
  // Private joins need the correct code (missing or wrong is rejected), and the code is never returned.
  it('requires the right code for a private table and never exposes it', async () => {
    const a = await create({ public: false, code: 'hunter2' });
    expect((await post({ type: 'join', room: a, name: 'x' })).status).toBe(400);
    expect((await post({ type: 'join', room: a, name: 'x', code: 'wrong' })).body.error).toMatch(/Wrong table code/);
    const t = await join(a, 'x', 'hunter2'); expect(t).toBeTruthy();
    const v = await peek(a, t);
    expect(v.public).toBe(false); expect(JSON.stringify(v)).not.toContain('hunter2');
  });
  // Blank names are rejected and names are cut to 16 characters.
  it('rejects empty names and truncates long ones to 16', async () => {
    const a = await create();
    expect((await post({ type: 'join', room: a, name: '   ' })).status).toBe(400);
    await join(a, 'n'.repeat(30)); expect((await peek(a)).players[0].name).toHaveLength(16);
  });
  // In a public table a name already in use cannot be reused, regardless of case.
  it('public: a taken name is rejected (case-insensitive), no rejoin by name', async () => {
    const a = await create(); await join(a, 'Asha');
    const r = await post({ type: 'join', room: a, name: 'aSHA' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/taken/);
  });
  // In a private table, re-entering the same name with the code returns the original seat and token.
  it('private: the same name with the code returns the same seat', async () => {
    const a = await create({ public: false, code: 'k' }); const t = await join(a, 'Asha', 'k');
    expect(await join(a, 'asha', 'k')).toBe(t);
    expect((await peek(a)).players).toHaveLength(1);
  });
  // Rejoining a private table by name is rejected without the correct code.
  it('private: rejoining by name still needs the code', async () => {
    const a = await create({ public: false, code: 'k' }); await join(a, 'Asha', 'k');
    expect((await post({ type: 'join', room: a, name: 'Asha', code: 'bad' })).status).toBe(400);
  });
  // A 6th player is refused in both public and private tables.
  it.each([true, false])('seats at most 5 players (public=%s)', async pub => {
    const a = await create({ public: pub, code: 'k' }); await fill(a, ['a', 'b', 'c', 'd', 'e'], 'k');
    const r = await post({ type: 'join', room: a, name: 'f', code: 'k' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/full/);
  });
  // Players with new names cannot join after the game has begun.
  it('rejects new players once the game has started', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'start', room: a, token: t[0] });
    expect((await post({ type: 'join', room: a, name: 'late' })).body.error).toMatch(/already started/);
  });
  // Mid-game, a private table allows rejoin by name; a public one rejects it but the saved token still works.
  it('private: rejoin by name works mid-game; public: only the saved token works', async () => {
    const pv = await create({ public: false, code: 'k' }), pb = await create();
    const tv = await fill(pv, ['a', 'b', 'c'], 'k'), tb = await fill(pb);
    for (const [room, t] of [[pv, tv], [pb, tb]]) await post({ type: 'start', room, token: t[0] });
    expect(await join(pv, 'a', 'k')).toBe(tv[0]);
    expect((await post({ type: 'join', room: pb, name: 'a' })).status).toBe(400);
    expect((await peek(pb, tb[0])).me).toBe(0);
  });
  // Reading or joining a table that does not exist returns "Room not found".
  it('404s on unknown tables', async () => {
    const g = await get('?room=zzzzzz'); expect(g.status).toBe(404); expect(g.body.error).toMatch(/not found/);
    expect((await post({ type: 'join', room: 'zzzzzz', name: 'x' })).body.error).toMatch(/not found/);
  });
});

describe('isolation between tables', () => {
  // Players in one table do not appear in another, and the same name can be used in two tables.
  it('keeps rosters separate and allows the same name in different tables', async () => {
    const a = await create(), b = await create();
    const ta = await join(a, 'Sam'), tb = await join(b, 'Sam');
    expect(ta).not.toBe(tb);
    await join(a, 'Kim');
    expect((await peek(a)).players).toHaveLength(2); expect((await peek(b)).players).toHaveLength(1);
  });
  // A player token only works in its own table; elsewhere it is rejected or treated as a spectator.
  it("a token from one table is useless in another", async () => {
    const a = await create(), b = await create(); const ta = await fill(a), tb = await fill(b);
    const r = await post({ type: 'start', room: b, token: ta[0] });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/not at this table/);
    expect((await peek(b, ta[0])).me).toBe(-1);
    expect(tb).toHaveLength(3);
  });
  // An action in one table does not change the phase of another running table.
  it('games progress independently', async () => {
    const a = await create(), b = await create(); const ta = await fill(a), tb = await fill(b);
    await post({ type: 'start', room: a, token: ta[0] }); await post({ type: 'start', room: b, token: tb[0] });
    const turnA = (await peek(a, ta[0])).turn;
    expect((await post({ type: 'auction', room: a, token: ta[turnA] })).status).toBe(200);
    expect((await peek(a, ta[0])).phase).toBe('auction'); expect((await peek(b, tb[0])).phase).toBe('turn');
  });
  // Starting a game in one table does not start another.
  it('starting one table leaves another in the lobby', async () => {
    const a = await create(), b = await create(); const ta = await fill(a); await fill(b);
    await post({ type: 'start', room: a, token: ta[0] });
    expect((await peek(b)).phase).toBe('lobby');
  });
});

describe('host controls', () => {
  // The first player to join is the host; only they can start, and only with at least 3 players.
  it('only the first joiner can start, and only with 3+ players', async () => {
    const a = await create(); const [h, p] = await fill(a, ['host', 'two']);
    expect((await post({ type: 'start', room: a, token: h })).body.error).toMatch(/3 players/);
    const t3 = await join(a, 'three');
    expect((await post({ type: 'start', room: a, token: p })).body.error).toMatch(/host/);
    expect((await post({ type: 'start', room: a, token: h })).status).toBe(200); expect(t3).toBeTruthy();
  });
  // Actions with a missing or fake token are rejected.
  it('rejects actions with a bogus token', async () => {
    const a = await create(); await fill(a);
    expect((await post({ type: 'start', room: a, token: 'bogus' })).body.error).toMatch(/not at this table/);
    expect((await post({ type: 'start', room: a })).status).toBe(400);
  });
  // Reset (host only) empties the table but keeps its name, visibility and code, and old tokens stop working.
  it('reset keeps the table settings, clears players and voids old tokens', async () => {
    const a = await create({ name: 'Farm', public: false, code: 'k' }); const t = await fill(a, ['a', 'b', 'c'], 'k');
    await post({ type: 'start', room: a, token: t[0] });
    expect((await post({ type: 'reset', room: a, token: t[1] })).body.error).toMatch(/Host only/);
    expect((await post({ type: 'reset', room: a, token: t[0] })).status).toBe(200);
    const v = await peek(a, t[0]);
    expect(v).toMatchObject({ name: 'Farm', public: false, phase: 'lobby', me: -1 }); expect(v.players).toHaveLength(0);
    expect((await post({ type: 'join', room: a, name: 'a', code: 'bad' })).status).toBe(400);
    expect((await post({ type: 'join', room: a, name: 'a', code: 'k' })).status).toBe(200);
  });
  // A public table remains in the list after being reset.
  it('a reset public table stays listed', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'reset', room: a, token: t[0] });
    expect((await get('')).body.map(x => x.id)).toEqual([a]);
  });
});

describe('server-side timer', () => {
  // Polling the table closes an auction whose timer has passed and saves the new stage.
  it('a GET closes an expired auction and persists the result', async () => {
    const a = await create(); const t = await fill(a);
    await post({ type: 'start', room: a, token: t[0] });
    const au = (await peek(a, t[0])).turn;
    await post({ type: 'auction', room: a, token: t[au] });
    expect((await post({ type: 'bid', room: a, token: t[(au + 1) % 3], amount: 10 })).status).toBe(200);
    const key = 'kh:' + a, s = JSON.parse(globalThis.__kh[key]); s.auction.deadline = 0; globalThis.__kh[key] = JSON.stringify(s);
    expect((await peek(a, t[au])).auction.stage).toBe('decide');
    expect(JSON.parse(globalThis.__kh[key]).auction.stage).toBe('decide');
  });
});