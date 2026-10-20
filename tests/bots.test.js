import { describe, it, expect } from 'vitest';
import { newGame, newPlayer, apply, tick, view, waiting, countsOf } from '../lib/engine';
import { LEVELS, thinkMs, botRand } from '../lib/bots/index';
import { TYPES, sum } from '../lib/rules';

const LV = Object.keys(LEVELS);
const total = s => s.players.reduce((n, p) => n + sum(p.money), 0);
// A lobby with one person (the host) and the given bots.
function table(bots = ['hard', 'hard'], o = {}) {
  const s = newGame({ timeout: 20, ...o }); s.players.push(newPlayer('Ann', 'tokA'));
  for (const level of bots) apply(s, 0, { type: 'addbot', level }, 0);
  return s;
}
// Let time pass in small steps; the person (seat 0) lets their clock run out unless `me` decides for them.
function run(s, until, me = null, step = 500) {
  for (let now = s.clockT || 1; now <= until && s.phase !== 'over'; now += step) {
    tick(s, now); s.clockT = now;
    const w = waiting(s);
    if (me && w && w.p === 0) { const x = me(s); if (x) apply(s, 0, x, now); }
  }
  return s;
}

describe('adding bots in the lobby', () => {
  // The host adds bots of every level, up to 5 seats; each gets its own name.
  it('lets the host fill the table with bots', () => {
    const s = table(['easy', 'medium', 'hard', 'insane']);
    expect(s.players.map(p => p.bot || null)).toEqual([null, 'easy', 'medium', 'hard', 'insane']);
    expect(new Set(s.players.map(p => p.name.toLowerCase())).size).toBe(5);
    expect(() => apply(s, 0, { type: 'addbot', level: 'random' }, 0)).toThrow(/full/);
    expect(s.log[0]).toMatch(/\(insane bot\) joined/);
  });
  // Only the host may add bots, only known levels, and only before the game starts.
  it('refuses bots from others, unknown levels and after the start', () => {
    const s = table([]); s.players.push(newPlayer('Bob', 'tokB'));
    expect(() => apply(s, 1, { type: 'addbot', level: 'hard' }, 0)).toThrow(/host/);
    expect(() => apply(s, 0, { type: 'addbot', level: 'godlike' }, 0)).toThrow(/level/);
    expect(() => apply(s, 0, { type: 'addbot', level: '__proto__' }, 0)).toThrow(/level/);
    apply(s, 0, { type: 'addbot', level: 'random' }, 0); apply(s, 0, { type: 'start' }, 0);
    expect(() => apply(s, 0, { type: 'addbot', level: 'hard' }, 0)).toThrow(/before the game starts/);
  });
  // Bots count towards the 3 players needed; the host can remove one again.
  it('counts bots as players and lets the host remove them', () => {
    const s = table(['easy']);
    expect(() => apply(s, 0, { type: 'start' }, 0)).toThrow(/3 players/);
    apply(s, 0, { type: 'addbot', level: 'confusing' }, 0); apply(s, 0, { type: 'kick', target: 1 }, 0);
    expect(s.players.map(p => p.bot || null)).toEqual([null, 'confusing']);
  });
  // A bot is never the host: when the host leaves, the next person takes over; with only bots left the table empties.
  it('never makes a bot the host and clears a table of only bots', () => {
    const s = table(['hard']); s.players.push(newPlayer('Bob', 'tokB'));
    apply(s, 0, { type: 'leave' }, 0);
    expect(view(s, 1).host).toBe(1); expect(() => apply(s, 1, { type: 'start' }, 0)).toThrow(/3 players/);
    apply(s, 1, { type: 'addbot', level: 'easy' }, 0); apply(s, 1, { type: 'start' }, 0); expect(s.phase).toBe('turn');
    const t = table(['hard', 'easy']); apply(t, 0, { type: 'leave' }, 0); expect(t.players).toEqual([]);
  });
});

describe('bots during the game', () => {
  // A bot on turn gets a moment to move, before its time limit, and the view tells players when to look again.
  it('schedules the bot move within the time limit and shows when', () => {
    const s = table(['hard', 'hard']); apply(s, 0, { type: 'start' }, 1000);
    if (s.turn === 0) { apply(s, 0, { type: 'auction' }, 1000); run(s, 40000); }
    const w = waiting(s);
    if (w && s.players[w.p].bot) {
      expect(s.botAt).toBeGreaterThan(s.due - 20000); expect(s.botAt).toBeLessThan(s.due);
      expect(view(s, 0).next).toBe(s.botAt);
      const before = s.step; tick(s, s.botAt); expect(s.step).toBe(before + 1);
    }
  });
  // Thinking time: about a quarter of the time per move, never under 0.7s or over 80% of the limit, steadier for
  // better bots and all over the place for the confusing one.
  it('thinks for about a quarter of the limit, with level-dependent spread', () => {
    const stats = l => {
      const r = botRand({ seed: 1 }, 0, l), xs = Array.from({ length: 4000 }, () => thinkMs(l, 'turn', 20000, r));
      const m = sum(xs) / xs.length, sd = Math.sqrt(sum(xs.map(x => (x - m) ** 2)) / xs.length);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(700); expect(Math.max(...xs)).toBeLessThanOrEqual(16000);
      return { m, sd };
    };
    const e = stats('easy'), h = stats('hard'), i = stats('insane'), c = stats('confusing');
    for (const x of [e, h, i]) expect(Math.abs(x.m - 5000)).toBeLessThan(400);
    expect(e.sd).toBeGreaterThan(h.sd); expect(h.sd).toBeGreaterThan(i.sd); expect(c.sd).toBeGreaterThan(e.sd);
    expect(thinkMs('hard', 'turn', 120000, botRand({ seed: 2 }, 0, 'x'))).toBeLessThan(20000); // long limits do not drag
  });
  // Bots bid on an animal the person auctions, raise in steps, never beyond their money, and before the clock ends.
  it('bots bid on auctions before the clock runs out', () => {
    let seen = 0;
    for (let k = 0; k < 6; k++) {
      const s = table(['hard', 'medium', 'easy']); s.seed = k; apply(s, 0, { type: 'start' }, 0);
      s.turn = 0; s.deck = ['cow', 'horse', 'pig', 'cat'].concat(s.deck.slice(4)); s.due = 30000; s.botAt = null;
      apply(s, 0, { type: 'auction' }, 1000);
      const a = s.auction, cap = { ...a.caps };
      expect(view(s, 0).auction).not.toHaveProperty('caps');
      let last = 0;
      for (let now = 1000; s.phase === 'auction' && s.auction.stage === 'bidding' && now < 200000; now += 250) {
        tick(s, now);
        const h = s.phase === 'auction' && s.auction.high;
        if (h && h.amt !== last) { seen++; expect(h.amt).toBeGreaterThan(last); expect(h.amt).toBeLessThanOrEqual(cap[h.p]); last = h.amt; }
      }
      expect(s.log.join('\n')).not.toMatch(/ran out of time/);
    }
    expect(seen).toBeGreaterThan(0);
  });
  // Whoever looks first triggers the bot move; looking again from a copy gives exactly the same move.
  it('makes the same move no matter who triggers it', () => {
    const s = table(['hard', 'insane', 'confusing']); apply(s, 0, { type: 'start' }, 0); s.turn = 1; s.due = 30000; s.botAt = 3000;
    const copy = JSON.parse(JSON.stringify(s));
    tick(s, 60000); tick(copy, 60000);
    expect(copy).toEqual(s);
  });
  // When the last person leaves, the bots do not play on.
  it('ends the game when only bots are left', () => {
    const s = table(['hard', 'easy']); apply(s, 0, { type: 'start' }, 0);
    apply(s, 0, { type: 'leave' }, 10); expect(s.phase).toBe('over'); expect(s.log[0]).toMatch(/only bots/);
  });
  // The host can kick a bot mid-game: its money is shared out and its animals stay up for grabs.
  it('lets the host kick a bot mid-game', () => {
    const s = table(['hard', 'easy', 'random']); apply(s, 0, { type: 'start' }, 0);
    apply(s, 0, { type: 'kick', target: 2 }, 10);
    expect(s.players[2]).toMatchObject({ out: true, money: [] }); expect(s.phase).not.toBe('over');
  });
});

// ---- whole games: one person who plays simple moves (or sleeps), the rest bots of every kind ----
describe('full games with bots', () => {
  const person = s => { // auctions when it can, otherwise lets the clock decide
    const w = waiting(s);
    return w.what === 'turn' && s.deck.length ? { type: 'auction' } : null;
  };
  const combos = [['easy', 'medium', 'hard'], ['insane', 'random', 'confusing'], ['hard', 'hard', 'hard', 'hard'], ['random', 'confusing'], ['medium', 'insane', 'easy', 'confusing']];
  combos.forEach((bots, n) => [40, 26].forEach(size => {
    // Every animal and every coin stays accounted for, no bot ever runs out of time, and the game ends.
    it(`${bots.join(', ')} with a ${size}-card deck`, () => {
      const s = table(bots, { deckSize: size, timeout: 10 }); s.seed = n + size; apply(s, 0, { type: 'start' }, 1);
      const money = () => 90 * s.players.length + s.players.length * [50, 100, 200, 500].slice(0, s.mules).reduce((a, b) => a + b, 0);
      for (let now = 1, k = 0; s.phase !== 'over' && k < 40000; now += 400, k++) {
        tick(s, now);
        const w = waiting(s);
        if (w && w.p === 0 && k % 3 === 0) { const x = person(s); if (x) apply(s, 0, x, now); }
        for (const t of TYPES) {
          const c = s.deck.filter(x => x === t).length + s.players.reduce((a, p) => a + p.animals[t], 0) + (s.auction?.type === t ? 1 : 0);
          expect(c).toBe(countsOf(s)[t]);
        }
        expect(total(s)).toBe(money());
      }
      expect(s.phase).toBe('over');
      const late = s.log.filter(l => / ran out of time/.test(l) && !/^Ann /.test(l));
      expect(late).toEqual([]);
      s.players.slice(1).forEach(p => expect(p.strikes || 0).toBe(0));
    }, 60000);
  }));
});
