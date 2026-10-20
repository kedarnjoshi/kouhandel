// Lobby logic at the route-handler level, using the in-memory store (no Redis, no HTTP server).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

let GET, POST;
beforeAll(async () => {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
  ({ GET, POST } = await import('../app/api/game/route.js'));
});
beforeEach(() => { for (const o of [globalThis.__kh, globalThis.__khs, globalThis.__khx]) for (const k of Object.keys(o || {})) delete o[k]; });

const U = 'http://t/api/game';
const post = async b => { const r = await POST(new Request(U, { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, body: await r.json() }; };
const get = async q => { const r = await GET(new Request(U + q)); return { status: r.status, body: await r.json() }; };
const create = async (o = {}) => (await post({ type: 'create', name: 'T', public: true, ...o })).body.room;
const join = async (room, name, code) => (await post({ type: 'join', room, name, code })).body.token;
const peek = async (room, token = '') => (await get(`?room=${room}&token=${token}`)).body;
const fill = async (room, names = ['a', 'b', 'c'], code) => { const t = []; for (const n of names) t.push(await join(room, n, code)); return t; };
const stored = room => { const raw = globalThis.__kh['kh:' + room]; return JSON.parse(raw.slice(raw.indexOf('|') + 1)); };

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
    const key = 'kh:' + a, [v] = globalThis.__kh[key].split('|', 1), s = stored(a); s.auction.deadline = 0;
    globalThis.__kh[key] = v + '|' + JSON.stringify(s);
    expect((await peek(a, t[au])).auction.stage).toBe('decide');
    expect(stored(a).auction.stage).toBe('decide');
  });
});

describe('bots', () => {
  const save = (a, f) => { const key = 'kh:' + a, [v] = globalThis.__kh[key].split('|', 1), s = stored(a); f(s); globalThis.__kh[key] = v + '|' + JSON.stringify(s); };
  // The host adds bots over the API; they show in the view with their level, and nobody can take a bot's name.
  it('adds bots, shows their level and protects their names', async () => {
    const a = await create({ public: false, code: 'k' }), [t] = await fill(a, ['host'], 'k');
    expect((await post({ type: 'addbot', room: a, token: t, level: 'hard' })).status).toBe(200);
    const v = await peek(a, t), bot = v.players[1];
    expect(bot.bot).toBe('hard'); expect(v.host).toBe(0);
    const r = await post({ type: 'join', room: a, name: bot.name.toUpperCase(), code: 'k' });
    expect(r.status).toBe(400); expect(r.body.error).toMatch(/bot/);
    expect((await post({ type: 'addbot', room: a, token: 'nope', level: 'hard' })).status).toBe(400);
  });
  // A poll after the bot's moment makes the bot move, and that move is saved.
  it('a GET lets a bot that is due make its move, and saves it', async () => {
    const a = await create(), [t] = await fill(a, ['host']);
    for (const level of ['hard', 'easy']) await post({ type: 'addbot', room: a, token: t, level });
    await post({ type: 'start', room: a, token: t });
    save(a, s => { s.turn = 1; s.due = Date.now() + 30000; s.botAt = Date.now() - 1; });
    const v = await peek(a, t);
    expect(v.turn === 1 && v.phase === 'turn').toBe(false); // the bot auctioned or started a koehandel
    expect(stored(a).step).toBeGreaterThan(0);
  });
  // Lobby pruning never removes bots (they send no heartbeats).
  it('keeps bots seated in the lobby', async () => {
    const a = await create(), [t] = await fill(a, ['host']);
    await post({ type: 'addbot', room: a, token: t, level: 'random' });
    await get(`?room=${a}&token=${t}&hb=1`);
    expect((await peek(a, t)).players).toHaveLength(2);
  });
});

describe('storage under concurrency', () => {
  // Five players joining at the same moment all get a seat (no lost updates).
  it('simultaneous joins are never lost', async () => {
    const a = await create();
    const toks = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(n => join(a, n)));
    expect(toks.every(Boolean)).toBe(true);
    expect((await peek(a)).players.map(p => p.name).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((await post({ type: 'join', room: a, name: 'f' })).body.error).toMatch(/full/);
  });
  // Two bids for the same amount at the same moment: exactly one wins, the others are told to bid higher.
  it('simultaneous equal bids: one wins, the rest are rejected', async () => {
    const a = await create(); const t = await fill(a, ['a', 'b', 'c', 'd']); await post({ type: 'start', room: a, token: t[0] });
    const au = (await peek(a)).turn; await post({ type: 'auction', room: a, token: t[au] });
    const res = await Promise.all(t.filter((_, i) => i !== au).map(token => post({ type: 'bid', room: a, token, amount: 10 })));
    expect(res.filter(r => r.status === 200)).toHaveLength(1);
    expect((await peek(a)).auction.high.amt).toBe(10);
  });
  // Every saved change bumps the version the client uses to ignore stale responses.
  it('exposes an increasing version', async () => {
    const a = await create(); const v1 = (await peek(a)).v; await join(a, 'x');
    expect((await peek(a)).v).toBe(v1 + 1);
  });
});

describe('robustness', () => {
  // Garbage requests get a clean 400/404 instead of crashing the route.
  it('handles invalid JSON and bad room ids', async () => {
    const r = await POST(new Request(U, { method: 'POST', body: '{nope' }));
    expect(r.status).toBe(400);
    expect((await get('?room=../../x')).status).toBe(404);
    expect((await post({ type: 'join', room: { $ne: 1 }, name: 'x' })).body.error).toMatch(/not found/);
  });
  // Room ids are short, lowercase and unique.
  it('creates distinct lowercase ids', async () => {
    const ids = await Promise.all(Array.from({ length: 30 }, () => create()));
    expect(new Set(ids).size).toBe(30); ids.forEach(id => expect(id).toMatch(/^[a-z2-9]{6}$/));
  });
  // Rooms saved by the previous version (plain JSON, no version prefix) keep working and get upgraded on the next write.
  it('reads and upgrades rooms saved in the old format', async () => {
    const old = { name: 'Old', public: true, code: '', phase: 'lobby', players: [], deck: [], donkeys: 0, turn: 0, auction: null, trade: null, log: [] };
    globalThis.__kh['kh:0ld1d'] = JSON.stringify(old);
    expect((await peek('0ld1d')).name).toBe('Old');
    const t = await join('0ld1d', 'x'); expect(t).toBeTruthy();
    expect(globalThis.__kh['kh:0ld1d']).toMatch(/^1\|/); expect((await peek('0ld1d', t)).me).toBe(0);
  });
  // Games saved with the old animal names keep working: roosters become chickens, donkeys become money mules.
  it('upgrades roosters and donkeys in saved games', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'start', room: a, token: t[0] });
    const raw = globalThis.__kh['kh:' + a], [v] = raw.split('|', 1), s = stored(a);
    s.players[0].animals.rooster = 2; delete s.players[0].animals.chicken; s.deck = s.deck.map(x => (x === 'chicken' ? 'rooster' : x));
    s.players[1].animals.donkey = 1; delete s.players[1].animals.mule; s.deck = s.deck.map(x => (x === 'mule' ? 'donkey' : x));
    s.donkeys = 2; delete s.mules;
    globalThis.__kh['kh:' + a] = v + '|' + JSON.stringify(s);
    const view = await peek(a, t[0]);
    expect(view.players[0].animals.chicken).toBe(2); expect(view.players[0].animals).not.toHaveProperty('rooster');
    expect(view.players[1].animals.mule).toBe(1); expect(view.mules).toBe(2);
    expect(JSON.stringify(stored(a))).toContain('rooster'); // nothing is rewritten until the next move…
    await post({ type: 'auction', room: a, token: t[view.turn] });
    expect(JSON.stringify(stored(a))).not.toMatch(/rooster|donkey/); // …which saves the upgraded game
  });
  // Private codes are trimmed on join just like on create.
  it('trims the code on join', async () => {
    const a = await create({ public: false, code: 'k' });
    expect((await post({ type: 'join', room: a, name: 'x', code: ' k ' })).status).toBe(200);
  });
  // The decision time limit is chosen at creation: default 30s, clamped to 10s..2min.
  it('stores the decision time limit, clamped to 10..120 seconds', async () => {
    const cases = [[undefined, 30], [5, 10], [45, 45], [9999, 120], ['abc', 30]];
    for (const [timeout, want] of cases) expect((await peek(await create({ timeout }))).timeout).toBe(want);
  });
  // A table can be created with the game log turned off: only the latest event is shown, never the history.
  it('can hide the game log', async () => {
    const a = await create({ log: false }), b = await create();
    for (const r of [a, b]) { const t = await fill(r); await post({ type: 'start', room: r, token: t[0] }); await post({ type: 'auction', room: r, token: t[(await peek(r)).turn] }); }
    expect((await peek(a)).log).toHaveLength(1); expect((await peek(a)).showLog).toBe(false);
    expect((await peek(b)).log.length).toBeGreaterThan(1); expect((await peek(b)).showLog).toBe(true);
  });
});

describe('lobby presence', () => {
  const seen = room => globalThis.__kh['kh:' + room + ':seen'];
  const beat = async (room, token) => (await get(`?room=${room}&token=${token}&hb=1`)).body; // a poll that carries a heartbeat
  // Leaving from the lobby frees the seat at once.
  it('leave frees the seat', async () => {
    const a = await create(); const [t0] = await fill(a, ['a', 'b']);
    expect((await post({ type: 'leave', room: a, token: t0 })).status).toBe(200);
    expect((await peek(a)).players.map(p => p.name)).toEqual(['b']);
  });
  // A player who stops sending heartbeats for too long is removed from the lobby on someone else's heartbeat.
  it('drops players who went silent', async () => {
    const a = await create(); const [t0, t1] = await fill(a, ['a', 'b']);
    seen(a)[t0] = String(Date.now() - 100000);
    expect((await peek(a, t1)).players).toHaveLength(2); // a plain poll costs nothing extra and changes nothing
    const v = await beat(a, t1);
    expect(v.players.map(p => p.name)).toEqual(['b']); expect(v.me).toBe(0);
    expect(v.log[0]).toMatch(/a left/);
  });
  // Closing the tab ("bye") frees the seat after a short grace period, unless the player comes back (refresh).
  it('bye frees the seat after the grace period, a refresh keeps it', async () => {
    const a = await create(); const [t0, t1] = await fill(a, ['a', 'b']);
    await post({ type: 'bye', room: a, token: t0 });
    expect((await beat(a, t1)).players).toHaveLength(2); // still inside the grace period
    await beat(a, t0); // the page came back (refresh)
    seen(a)[t0] = String(Number(seen(a)[t0]) - 10000);
    expect((await beat(a, t1)).players).toHaveLength(2);
    await post({ type: 'bye', room: a, token: t0 });
    seen(a)[t0] = String(Number(seen(a)[t0]) - 10000); // grace period passes
    expect((await beat(a, t1)).players.map(p => p.name)).toEqual(['b']);
  });
  // Presence never removes anyone once the game is running.
  it('never removes players mid-game', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'start', room: a, token: t[0] });
    seen(a)[t[1]] = '0';
    expect((await beat(a, t[0])).players).toHaveLength(3);
  });
  // Spectators and unknown tokens cannot send heartbeats.
  it('ignores heartbeats from people without a seat', async () => {
    const a = await create(); await fill(a, ['a', 'b']);
    await beat(a, 'nope'); expect(Object.keys(seen(a))).toHaveLength(2);
  });
});

describe('automatic cleanup', () => {
  const exp = room => globalThis.__khx['kh:' + room];
  // Rooms expire 10 minutes after the last move or heartbeat; finished games are kept for an hour.
  it('gives rooms a 10 minute lifetime, renewed by heartbeats, and 15 minutes once finished', async () => {
    const a = await create(); const t = await fill(a);
    expect(exp(a) - Date.now()).toBeGreaterThan(590000); expect(exp(a) - Date.now()).toBeLessThanOrEqual(600000);
    globalThis.__khx['kh:' + a] = Date.now() + 1000;
    await get(`?room=${a}&token=${t[0]}&hb=1`); expect(exp(a) - Date.now()).toBeGreaterThan(590000);
    await post({ type: 'start', room: a, token: t[0] }); await post({ type: 'end', room: a, token: t[0] });
    expect(exp(a) - Date.now()).toBeGreaterThan(890000); expect(exp(a) - Date.now()).toBeLessThanOrEqual(900000);
  });
  // Players looking at the final scores do not keep a finished game alive.
  it('heartbeats do not extend a finished game', async () => {
    const a = await create(); const t = await fill(a);
    await post({ type: 'start', room: a, token: t[0] }); await post({ type: 'end', room: a, token: t[0] });
    globalThis.__khx['kh:' + a] = Date.now() + 5000;
    await get(`?room=${a}&token=${t[1]}&hb=1`); expect(exp(a) - Date.now()).toBeLessThanOrEqual(5000);
  });
  // A finished table shows in the public list for 2 minutes, then disappears from it.
  it('drops finished tables from the public list after 2 minutes', async () => {
    const a = await create(); const t = await fill(a);
    await post({ type: 'start', room: a, token: t[0] }); await post({ type: 'end', room: a, token: t[0] });
    expect((await get('')).body.map(x => x.phase)).toEqual(['over']);
    const key = 'kh:' + a, [v] = globalThis.__kh[key].split('|', 1), st = stored(a); st.endedAt = Date.now() - 121000;
    globalThis.__kh[key] = v + '|' + JSON.stringify(st);
    expect((await get('')).body).toEqual([]);
    expect((await peek(a)).phase).toBe('over'); // still reachable by its link until it expires
  });
  // When everyone has left (no heartbeats), the room expires: it is gone and drops off the public list.
  it('ends and removes a game everyone left', async () => {
    const a = await create(); const t = await fill(a); await post({ type: 'start', room: a, token: t[0] });
    globalThis.__khx['kh:' + a] = Date.now() - 1;
    expect((await get(`?room=${a}`)).status).toBe(404);
    expect((await get('')).body).toEqual([]); expect(globalThis.__khs.rooms.has(a)).toBe(false);
  });
  // Players who left mid-game are not counted in the public list.
  it('counts only players still in the game', async () => {
    const a = await create(); const t = await fill(a, ['a', 'b', 'c', 'd']); await post({ type: 'start', room: a, token: t[0] });
    await post({ type: 'leave', room: a, token: t[3] });
    expect((await get('')).body[0].players).toBe(3);
  });
});

describe('rate limiting', () => {
  // Outside tests, more than 5 polls per second from one player get a 429.
  it('throttles a client polling too fast', async () => {
    vi.resetModules(); const env = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    try {
      const m = await import('../app/api/game/route.js');
      const codes = [];
      for (let i = 0; i < 7; i++) codes.push((await m.GET(new Request(U + '?room=zzzzzz&token=t1'))).status);
      expect(codes.slice(0, 5).every(c => c === 404)).toBe(true); expect(codes[6]).toBe(429);
      expect((await m.GET(new Request(U + '?room=zzzzzz&token=t2'))).status).toBe(404); // other players are unaffected
    } finally { process.env.NODE_ENV = env; }
  });
});
