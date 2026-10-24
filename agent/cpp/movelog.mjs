// Plays fixed-seed sim games as agent/scripts/worker.mjs does and prints every decision, the history and the end
// state in a canonical text form; agent/cpp/movelog.exe prints the same for the C++ port, so `diff` checks it:
//   node agent/cpp/movelog.mjs <spec1;spec2;...> <deck size> <first seed> <games>   (one spec per seat)
import { newSimGame, playOut, rng } from '../../lib/bots/sim.js';
import { score, countsOf } from '../../lib/engine.js';
import { agentFor } from '../scripts/registry.mjs';
const [lineup, size = 20, seed0 = 1, games = 1] = process.argv.slice(2);
const specs = lineup.split(';');
const dv = new DataView(new ArrayBuffer(8));
const num = x => { if (Number.isInteger(x)) return String(x); dv.setFloat64(0, x); return 'x' + dv.getBigUint64(0).toString(16).padStart(16, '0'); };
const list = a => '[' + a.map(num).join(',') + ']';
const obj = o => '{' + Object.keys(o).map(k => `${k}:${num(o[k])}`).join(',') + '}';
const out = [];
const mvs = m => {
  if (!m) return 'undefined';
  let t = m.type;
  if (m.target !== undefined) t += ` ${m.target}`;
  if (m.animal !== undefined) t += ` ${m.animal}`;
  if (m.amount !== undefined) t += ` ${num(m.amount)}`;
  if (m.cards !== undefined) t += ` ${list(m.cards)}`;
  return t;
};
for (let g = 0; g < +games; g++) {
  const seed = +seed0 + g, base = rng(seed); let rc = 0; const r = () => { rc++; return base(); };
  const s = newSimGame(specs.length, +size, r);
  if (specs.some(sp => agentFor(sp).person)) s.people = specs.map(sp => !!agentFor(sp).person); // (as pool.h playGame)
  out.push(`game ${seed} ${lineup} ${size}`);
  const agents = specs.map((sp, seat) => {
    const a = agentFor(sp), w = {
      cap: (st, i, rr) => { const c = a.cap(st, i, rr); out.push(`bid ${i} ${num(c)} 0 rc=${rc}`); return c; },
      act: (st, i, what, rr) => {
        let mv;
        try { mv = a.act(st, i, what, rr); } catch (e) { out.push(`move ${i} ${what} ERR rc=${rc}`); throw e; }
        out.push(`move ${i} ${what} ${mvs(mv)} rc=${rc}`); return mv;
      },
    };
    if (a.bid) w.bid = (st, i, rr) => { const b = a.bid(st, i, rr); out.push(`bid ${i} ${num(b.cap)} ${num(b.open || 0)} rc=${rc}`); return b; };
    void seat; return w;
  });
  playOut(s, agents, r);
  for (const e of s.hist || []) {
    if (e.t === 'm') out.push(`h m ${e.amt} ${list(e.to)}`);
    else if (e.t === 'a') out.push(`h a ${e.k} A=${e.A} w=${e.w} p=${e.p} buy=${e.buy ? 1 : 0} mx=${obj(e.mx)} pred=${obj(e.pred)} led=${e.led ? list(e.led) : 'null'}` + (e.cs ? ` P=${e.P} Q=${e.Q} m=${e.m} cs=${list(e.cs)}` : ''));
    else if (e.t === 'k') out.push(`h k a=${e.a} b=${e.b} ${e.k} c=${e.c} na=${e.na} nb=${e.nb} win=${e.win} x=${e.x} y=${e.y} ca=${list(e.ca)} cb=${e.cb ? list(e.cb) : 'null'}`);
  }
  s.players.forEach((p, j) => out.push(`p ${j} money=${list(p.money)} animals=${list(Object.values(p.animals))} score=${score(p, countsOf(s)).score} ledger=${num(s.ledger[j])}`));
  out.push(`end phase=${s.phase} errors=${s.errors || 0} rc=${rc} deck=${s.deck.length} counts=${list(Object.values(countsOf(s)))}`);
}
console.log(out.join('\n'));
