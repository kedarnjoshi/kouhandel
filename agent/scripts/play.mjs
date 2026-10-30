// Play a game against bots from the command line, one decision per call, without clocks (for an LLM player).
// agent/kh new [bots=3] [level=insane] [deck=40]   -> starts a game (it becomes the current one) and asks the first question
// agent/kh <move> [-- why]                          -> applies the move to the current game, prints what happened and the next question
// (agent/kh is node --no-warnings agent/scripts/play.mjs; a game id as the first argument picks another game.)
// Bidding: the bots bid among themselves first; you are asked once the highest bid stands (raise or pass), and again
// whenever a bot tops you. Obvious moves (paying, a turn with nothing to koehandel, ...) are made for you.
// The game is saved as games/<id>.json after every move (the same format as a table's log: agent/scripts/explain.mjs
// reads it); the reasons after -- are kept in its `why`.
import fs from 'node:fs';
import { newGame, newPlayer, apply, tick, waiting, targets, score, countsOf, cheapest } from '../../lib/engine.js';
import { TYPES, sum } from '../../lib/rules.js';

const ME = 0, DIR = 'games', CUR = `${DIR}/.current`;
const file = id => `${DIR}/${id}.json`;
const save = (id, s) => fs.writeFileSync(file(id), JSON.stringify({ ...s, savedAt: new Date().toISOString() }));
const N = j => (j === ME ? 'you' : j < 0 ? '?' : s.players[j].name);
const herd = p => TYPES.filter(t => p.animals[t]).map(t => t + p.animals[t]).join(' ') || '-';
const cards = a => (a.length ? [...a].sort((x, y) => x - y).join(' ') : 'none');

let s, id;
let [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'new') {
  const [nb = 3, level = 'insane', deck = 40] = rest;
  s = newGame({ name: 'cli', timeout: 120, deckSize: +deck });
  s.players.push(newPlayer('Lex', 'me'));
  for (let i = 0; i < +nb; i++) apply(s, ME, { type: 'addbot', level }, 0);
  apply(s, ME, { type: 'start' }, 0);
  s.vt = 1000; s.seen = 0; s.why = [];
  id = 'llm-' + Math.random().toString(36).slice(2, 7);
  fs.writeFileSync(CUR, id);
  console.log(`game ${id}: you (Lex) vs ${s.players.slice(1).map(p => p.name).join(', ')}; ${s.deck.length} cards`);
} else {
  if (/^llm-/.test(cmd)) id = cmd; else { id = fs.readFileSync(CUR, 'utf8').trim(); rest = [cmd, ...rest]; }
  s = JSON.parse(fs.readFileSync(file(id), 'utf8'));
  const cut = rest.indexOf('--'), [mv, ...args] = cut < 0 ? rest : rest.slice(0, cut), why = cut < 0 ? '' : rest.slice(cut + 1).join(' ');
  try { move(mv, args); } catch (e) { console.log('! ' + e.message); prompt(); process.exit(0); }
  if (why) s.why.push({ at: (s.hist || []).length, move: [mv, ...args].join(' '), why });
}
run();
save(id, s);

// Your move.
function move(mv, args) {
  const w = waiting(s), a = s.auction, num = x => x.split(/[,\s]+/).filter(Boolean).map(Number);
  const go = x => apply(s, ME, x, s.vt);
  if (s.phase === 'auction' && a.stage === 'bidding') {
    if (mv === 'p') { s.passed = true; return; }
    if (mv === 'b') return go({ type: 'bid', amount: +args[0] });
  } else if (w && w.p === ME) {
    if (w.what === 'turn' && mv === 'a') return go({ type: 'auction' });
    if (w.what === 'turn' && mv === 'k') {
      const j = s.players.findIndex(p => p.name.toLowerCase() === (args[0] || '').toLowerCase());
      return go({ type: 'koehandel', target: j, animal: args[1] });
    }
    if (w.what === 'decide' && (mv === 'sell' || mv === 'buy')) return go({ type: mv });
    if (w.what === 'offer' && mv === 'o') return go({ type: 'tradebid', cards: num(args.join(' ')) });
    if (w.what === 'respond' && mv === 'acc') return go({ type: 'accept' });
    if (w.what === 'respond' && mv === 'c') return go({ type: 'tradebid', cards: num(args.join(' ')) });
  }
  throw new Error('not a move now');
}

// Let the bots play until you have a real decision (or the game ends), then print what happened and the question.
function run() {
  const me = s.players[ME];
  for (let g = 0; g < 5000 && s.phase !== 'over'; g++) {
    const a = s.auction, w = waiting(s);
    if (s.phase === 'auction' && a.stage === 'bidding') {
      const nb = a.nb; s.vt = Math.max(s.vt, a.deadline - 1); tick(s, s.vt);
      if (s.auction !== a || a.stage !== 'bidding' || a.nb !== nb) { if (a.nb !== nb) s.passed = false; continue; }
      const high = a.high ? a.high.amt : 0;
      if (a.auctioneer !== ME && !(a.high && a.high.p === ME) && sum(me.money) >= high + 10 && !s.passed) return prompt();
      s.passed = false; s.vt = a.deadline; tick(s, s.vt); continue;
    }
    if (!w) break;
    if (w.p !== ME) { s.vt = Math.max(s.vt, s.botAt ?? s.vt); tick(s, s.vt); continue; }
    const m = sum(me.money), auto = w.what === 'pay' ? { type: 'pay', cards: cheapest(me.money, a.high.amt) }
      : w.what === 'turn' && s.deck.length && !targets(s, ME).length ? { type: 'auction' }
      : w.what === 'decide' && m < a.high.amt ? { type: 'sell' }
      : w.what === 'respond' && !m ? { type: 'accept' }
      : w.what === 'offer' && !me.money.length ? { type: 'tradebid', cards: [] } : null;
    if (!auto) return prompt();
    apply(s, ME, auto, s.vt);
  }
  report();
  const sc = s.players.map((p, j) => ({ j, ...score(p, countsOf(s)) })).sort((x, y) => y.score - x.score);
  console.log('GAME OVER: ' + sc.map(x => `${N(x.j)} ${x.score} (${x.sets} sets)`).join(', ') + `. Saved ${file(id)}`);
}

// What happened since the last question: auctions, mules and koehandels (amounts only where you were in it).
function report() {
  const h = s.hist || [];
  for (; s.seen < h.length; s.seen++) {
    const e = h[s.seen];
    if (e.t === 'm') console.log(`mule: everyone +${e.amt}`);
    if (e.t === 'a') {
      const bids = Object.entries(e.mx).map(([j, b]) => `${N(+j)} ${b}`).join(', ');
      console.log(`${N(e.A)} auctioned ${e.k}: ` + (!bids ? 'no bids, kept' : `bids ${bids}; ` + (e.buy ? `bought back for ${e.p}` : `${N(e.w)} got it for ${e.p}`)));
    }
    if (e.t === 'k') {
      const mine = e.a === ME || e.b === ME, amt = (x, c) => (mine ? `${x} (${c.join(' ') || 'nothing'})` : `${c.length} cards`);
      console.log(`koehandel ${N(e.a)} vs ${N(e.b)} for ${e.k} x${e.c}: offer ${amt(e.x, e.ca)}, ` +
        (e.cb ? `counter ${amt(e.y, e.cb)}` : 'accepted') + ` -> ${N(e.win)} gets it`);
    }
  }
}

function prompt() {
  report();
  const me = s.players[ME], a = s.auction, tr = s.trade, w = waiting(s);
  const others = s.players.map((p, j) => j === ME ? null : `${p.name} ~${Math.round(s.ledger[j])} ${p.money.length}c: ${herd(p)}`).filter(Boolean);
  console.log(`[deck ${s.deck.length}, mules ${s.mules}/4] ${others.join(' | ')}`);
  console.log(`you: ${cards(me.money)} (=${sum(me.money)}): ${herd(me)}`);
  if (s.phase === 'auction' && a.stage === 'bidding') {
    const bids = Object.entries(a.mx || {}).map(([j, b]) => `${N(+j)} ${b}`).join(', ');
    console.log(`> ${N(a.auctioneer)} auctions ${a.type}. ${a.high ? `high ${a.high.amt} by ${N(a.high.p)} (bids: ${bids})` : 'no bids'}. b <amount> | p`);
  } else if (w.what === 'turn') {
    const t = targets(s, ME).map(x => `${s.players[x.p].name} ${x.type} x${x.count}`).join(', ');
    console.log(`> your turn: ${s.deck.length ? 'a | ' : ''}k <player> <animal>   (koehandels: ${t})`);
  } else if (w.what === 'decide') console.log(`> ${N(a.high.p)} bid ${a.high.amt} for your ${a.type}: sell | buy`);
  else if (w.what === 'offer') console.log(`> koehandel vs ${N(tr.b)} for ${tr.type} x${tr.count}${tr.ties ? ` (tied at ${tr.tieAt}: offer again)` : ''}: o <cards>`);
  else if (w.what === 'respond') console.log(`> ${N(tr.a)} offers ${tr.bids[tr.a].length} cards for your ${tr.type} x${tr.count}${tr.ties ? ` (tied at ${tr.tieAt})` : ''}: acc | c <cards>`);
}
