'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ANIMALS } from '../lib/rules'; // not the engine: keeps the game logic and bots out of the browser bundle

const cap = s => s[0].toUpperCase() + s.slice(1);
const nameOf = t => (t === 'mule' ? 'Money mule' : cap(t)); // display name of an animal
const sum = a => a.reduce((x, y) => x + y, 0);
const animals = (n, t) => (n > 1 && t !== 'sheep' ? `${n} ${nameOf(t)}s` : `${n > 1 ? n + ' ' : ''}${nameOf(t)}`);
const roomFromUrl = () => (new URLSearchParams(location.search).get('room') || '').trim().toLowerCase();
// Seats are remembered per tab (sessionStorage) so two tabs can be two players, with localStorage as the fallback
// for a new tab or a reopened browser.
const savedToken = id => { try { return sessionStorage.getItem('kh:' + id) || localStorage.getItem('kh:' + id) || ''; } catch { return ''; } };
const saveToken = (id, t) => {
  for (const st of ['sessionStorage', 'localStorage']) try { t ? window[st].setItem('kh:' + id, t) : window[st].removeItem('kh:' + id); } catch {}
};

// How long to wait before the next poll. Only poll fast when someone else can change the table any moment.
function pollDelay(g, skew, spent = 0) { // spent: how long the last request took
  if (typeof document !== 'undefined' && document.hidden) return 15000;
  if (!g) return 2000;
  if (g.phase === 'over') return 30000;
  if (g.phase === 'lobby' || g.paused) return 3000;
  const soon = at => Math.max(400, at - (Date.now() + skew) + 300); // look right after a deadline passes
  if (g.phase === 'auction' && g.auction.stage === 'bidding') return Math.min(Math.max(0, 500 - spent), soon(g.auction.deadline)); // a look every half second: every bid shows at once
  const mine = g.waiting && g.waiting.p === g.me; // nobody else can move: only check now and then (kicks, the clock)
  return Math.min(mine ? 10000 : 2500, g.due ? soon(g.due) : 10000, g.next ? soon(g.next) : 10000); // next: when a bot moves
}
async function api(query = '', body) { // never throws on bad JSON; network errors still throw
  const res = await fetch('/api/game' + query, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }
    : { cache: 'no-store' });
  let j = null;
  try { j = await res.json(); } catch {}
  return { status: res.status, j: j || { error: `Server error (${res.status})` } };
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function Card({ src, label, sel, onClick, small, badge, gold }) {
  const [bad, setBad] = useState(false); // falls back to a text card if the image is missing
  useEffect(() => setBad(false), [src]);
  return (
    <div className={`card${small ? ' sm' : ''}${sel ? ' sel' : ''}${gold ? ' gold' : ''}${onClick ? ' click' : ''}`} onClick={onClick}>
      {bad ? <span className="fb">{label}</span> : <img src={src} alt={label} onError={() => setBad(true)} />}
      {badge > 1 && <b className="badge">×{badge}</b>}
    </div>
  );
}
// Private, animated notice of money that just changed hands (shown only to the players involved).
function Notice({ n }) {
  const [hidden, setHidden] = useState(() => n?.id ?? null); // whatever was already there when the page opened is old news
  useEffect(() => { if (!n) return; const t = setTimeout(() => setHidden(n.id), 15000); return () => clearTimeout(t); }, [n?.id]);
  if (!n || hidden === n.id) return null;
  return (
    <div key={n.id} className="panel notice" onClick={() => setHidden(n.id)} title="Click to dismiss">
      <b>{n.text}</b>
      {n.got.length > 0 && <div className="row"><span className="muted">You received</span>{n.got.map((v, i) => <span key={i} className="fly in" style={{ animationDelay: `${150 + i * 120}ms` }}><Money v={v} small /></span>)}<b className="plus">+{sum(n.got)}</b></div>}
      {n.gave.length > 0 && <div className="row"><span className="muted">You gave</span>{n.gave.map((v, i) => <span key={i} className="fly out" style={{ animationDelay: `${150 + i * 120}ms` }}><Money v={v} small /></span>)}<b className="minus">−{sum(n.gave)}</b></div>}
    </div>
  );
}
const Seats = ({ n }) => <span className="seats" title={`${n}/5 players`}>{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < n ? 'on' : ''} />)}</span>;
const Toggle = ({ on, set, children }) => <label className="toggle"><input type="checkbox" checked={on} onChange={e => set(e.target.checked)} /><span className="knob" />{children}</label>;
// A small (i) that explains a setting: shows on hover with a mouse, toggles on tap (and closes on a tap elsewhere).
function Info({ label, children }) {
  const [open, setOpen] = useState(false), ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = e => { if (!ref.current?.contains(e.target)) setOpen(false); }, esc = e => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', off); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', off); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className={`info${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="info-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)}>i</button>
      <span role="tooltip" className="tip">{children}</span>
    </span>
  );
}
// The bots a host can add (kept here, not imported from the bots, so the bot code stays on the server), with how hard
// each one is (pips; 0: just for fun).
const BOTS = [['easy', 'Easy', 1], ['medium', 'Medium', 2], ['hard', 'Hard', 3], ['insane', 'Insane', 4], ['random', 'Random', 0], ['confusing', 'Confusing', 0]];
const Level = ({ b: [, name, d] }) => (
  <span className="lvl"><span className="lvl-name">{name}</span>
    {d ? <span className="pips" aria-label={`difficulty ${d} of 4`}>{[1, 2, 3, 4].map(x => <i key={x} className={x <= d ? 'on' : ''} />)}</span> : <span className="lvl-tag">for fun</span>}
  </span>
);
// A dropdown of bot levels (a list of its own rather than a native select, so Insane can carry its (i)).
function BotPicker({ value, set }) {
  const [open, setOpen] = useState(false), ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = e => { if (!ref.current?.contains(e.target)) setOpen(false); }, esc = e => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', off); addEventListener('keydown', esc);
    return () => { removeEventListener('pointerdown', off); removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`picker${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="picker-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Level b={BOTS.find(b => b[0] === value)} /><span className="caret" aria-hidden>▾</span>
      </button>
      {open && <div role="listbox" className="picker-menu">{BOTS.map(b => (
        <div key={b[0]} className={`picker-row${b[0] === value ? ' on' : ''}`}>
          <button type="button" role="option" aria-selected={b[0] === value} className="picker-opt" onClick={() => { set(b[0]); setOpen(false); }}><Level b={b} /></button>
          {b[0] === 'insane' ? <Info label="About Insane">Really hard. It plays every deal to win and rarely makes a mistake: expect to lose most games against it.</Info> : <span className="info-slot" />}
        </div>))}</div>}
    </div>
  );
}
function AddBot({ post, full }) {
  const [level, setLevel] = useState('medium');
  return (
    <div className="row addbot">
      <span>Add a bot</span>
      <BotPicker value={level} set={setLevel} />
      <button className="ghost" disabled={full} onClick={() => post({ type: 'addbot', level })}>Add bot</button>
      {full && <span className="muted">The table is full.</span>}
    </div>
  );
}
const COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#7aa5d8', '#c792ea'];
const Avatar = ({ i, name }) => <span className="avatar" style={{ background: COLORS[i % COLORS.length] }}>{(name || '?')[0].toUpperCase()}</span>;
// const VALUES = [['Horse', 1000], ['Cow', 800], ['Pig', 650], ['Money mule', 500], ['Goat', 350], ['Sheep', 250], ['Dog', 160], ['Cat', 90], ['Duck', 40], ['Chicken', 10]];
// "How to play" drawer: collapsed by default, opened from the tab on the right edge.
function Rules() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const k = e => e.key === 'Escape' && setOpen(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return (<>
    <button className="rules-tab" aria-expanded={open} aria-controls="rules" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'How to play'}</button>
    {open && <div className="rules-shade" onClick={() => setOpen(false)} />}
    <aside id="rules" className={`rules${open ? ' open' : ''}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div className="row"><h2 className="grow">How to play</h2><button className="ghost small" onClick={() => setOpen(false)}>Close</button></div>
      <h3>Goal</h3>
      <p>Collect complete sets of 4 of the same animal (with a smaller deck: all the copies of an animal, see below). Your score is the total value of your sets times the number of sets (3 sets worth 1960 together score 5880). Money is worth nothing at the end.</p>
      <h3>Start</h3>
      <p>3 to 5 players. Everyone gets 90: two 0s, four 10s and one 50. Keep your money secret: others only see how many cards you hold.</p>
      <h3>Your turn</h3>
      <p>Either <b>auction</b> the next animal from the deck, or start a <b>koehandel</b> with a player who owns the same kind of animal as you.</p>
      <h3>Auction</h3>
      <ul>
        <li>The others bid in steps of 10. Bidding runs 20s, and every new bid resets the clock to 10s. The auctioneer may add 5s once.</li>
        <li>When time runs out the auctioneer either sells to the highest bidder, or buys the animal by paying that bidder the same amount.</li>
        <li>No change is given: pay with cards worth at least the bid. No bids? The auctioneer gets the animal for free.</li>
        <li><b>Money mules:</b> each time one comes up, everyone receives 50, then 100, 200 and 500.</li>
      </ul>
      <h3>Koehandel</h3>
      <ul>
        <li>Pick a player who has an animal type you have too. If you both have 2, you play for both; otherwise for 1.</li>
        <li>You put money cards face down. The other player sees how many cards, then <b>accepts</b> (takes your cards, hands over the animal) or makes a <b>counter-offer</b> face down.</li>
        <li>The higher offer wins the animals, and the two offers swap hands. A tie: you offer again; a second tie and you win for free.</li>
      </ul>
      <h3>End</h3>
      <p>When the deck is empty only koehandels are left. The game ends when every set is complete.</p>
      <h3>Smaller deck</h3>
      <p>The table can use a deck of 20 to 39 animals instead of 40. Then each animal has 2, 3 or 4 cards, chosen at random and kept secret: a set is all the cards of one animal, and nobody knows how many that is until the game ends. Fewer money mules may come up, so there is less money too.</p>
      <h3>Time limit</h3>
      <p>Each move has a time limit. Run out and your turn is skipped; in the middle of an action the obvious choice is made: the auctioneer buys if they can, payment uses your cheapest cards, an offer is 0 cards and an answer is "accept".</p>
      <h3>Leaving and kicking</h3>
      <p>The host can kick anyone; anyone can kick a player who missed 2 moves in a row. A player who leaves or is kicked has their money shared out evenly (poorest first). Their animals stay on the table: anyone who owns that animal can start a koehandel for them and take them for free.</p>
      <h3>Animal values</h3>
      <table className="values"><tbody>{Object.entries(ANIMALS).map(([a, v]) => { const label = a === 'mule' ? 'money mule' : a; return <tr key={a}><td>{label.charAt(0).toUpperCase() + label.slice(1)}</td><td>{v}</td></tr>; })}</tbody></table>
    </aside>
  </>);
}
const Animal = ({ t, ...p }) => <Card src={`/cards/${t}.png`} label={nameOf(t)} {...p} />;
const Money = ({ v, ...p }) => <Card src={`/cards/${v}.jpg`} label={String(v)} {...p} />;

function Rooms({ go, err: e0 }) {
  const [list, setList] = useState(null), [err, setErr] = useState(e0), [n, setN] = useState({ name: '', pub: true, code: '', log: true, timeout: 30, deck: 40 }), [jr, setJr] = useState('');
  const [busy, setBusy] = useState(false), [listErr, setListErr] = useState('');
  useEffect(() => {
    let dead = false, timer;
    const load = async () => {
      try {
        const { j } = await api();
        if (dead) return;
        if (Array.isArray(j)) { setList(j); setListErr(''); } else setListErr(j.error);
      } catch { if (!dead) setListErr('Cannot reach the server, retrying…'); }
      if (!dead) timer = setTimeout(load, document.hidden ? 30000 : 5000);
    };
    load();
    return () => { dead = true; clearTimeout(timer); };
  }, []);
  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const { j } = await api('', { type: 'create', name: n.name, public: n.pub, code: n.code, log: n.log, timeout: n.timeout, deckSize: n.deck });
      j.error ? setErr(j.error) : go(j.room);
    } catch { setErr('Cannot reach the server'); }
    setBusy(false);
  };
  const open = () => { const id = jr.trim().toLowerCase(); if (id) go(id); };
  const label = p => (p === 'lobby' ? 'open' : p === 'over' ? 'finished' : 'playing');
  return (
    <main>
      <Rules />
      <header className="hero">
        <h1>Koehandel</h1>
        <p className="tag">Bid, bluff and horse-trade your way to the finest farm. 3 to 5 players.</p>
      </header>
      <div className="lobby-grid">
        <section className="panel">
          <h2>Public tables</h2>
          {listErr && <p className="err">{listErr}</p>}
          {list === null ? <p className="muted">Loading…</p> : list.length ? <ul className="tables">{list.map(r => (
            <li key={r.id} className="table-row">
              <div className="grow"><b>{r.name}</b><Seats n={r.players} /></div>
              <span className={`status ${r.phase === 'lobby' ? 'open' : r.phase === 'over' ? 'done' : 'live'}`}>{label(r.phase)}</span>
              <button className="ghost small" onClick={() => go(r.id)}>{r.phase === 'lobby' ? 'Join' : 'Watch'}</button>
            </li>))}</ul>
            : <p className="muted empty">No public tables yet. Create one!</p>}
        </section>
        <div className="stack">
          <section className="panel form">
            <h2>New table</h2>
            <input placeholder="Table name" maxLength={24} value={n.name} onChange={e => setN({ ...n, name: e.target.value })} />
            <div className="opts">
              <Toggle on={n.pub} set={v => setN({ ...n, pub: v })}>Public</Toggle>
              <Toggle on={n.log} set={v => setN({ ...n, log: v })}>Game log</Toggle>
              <label className="field">Time per move
                <select value={n.timeout} onChange={e => setN({ ...n, timeout: Number(e.target.value) })}>
                  {[10, 15, 20, 30, 45, 60, 90, 120].map(v => <option key={v} value={v}>{v < 60 ? `${v}s` : `${v / 60} min`}</option>)}
                </select></label>
            </div>
            <div className="deck-size">
              <label htmlFor="deck">Deck: <b>{n.deck}</b> animals{n.deck === 40 ? ' (normal)' : ', secret sets of 2 to 4'}</label>
              <Info label="About the deck size">
                A normal game has 40 animals: 4 of each of the 10 kinds. With a smaller deck every kind has 2, 3 or 4 cards,
                picked at random when the game starts, and <b>nobody knows how many of each there are</b>. A set is all the
                cards of one kind, so 2 pigs can already be a full set, if there are only 2 pigs. Fewer money mules mean
                less money, too. Everything is revealed when the game ends.
              </Info>
              <input id="deck" type="range" min={20} max={40} step={1} value={n.deck} onChange={e => setN({ ...n, deck: Number(e.target.value) })} />
            </div>
            {!n.pub && <input placeholder="Table code (password)" maxLength={40} value={n.code} onChange={e => setN({ ...n, code: e.target.value })} />}
            <button disabled={busy || (!n.pub && !n.code.trim())} onClick={create}>Create table</button>
          </section>
          <section className="panel form">
            <h2>Private table</h2>
            <div className="row nowrap">
              <input className="grow" placeholder="Table ID" value={jr} onChange={e => setJr(e.target.value)} onKeyDown={e => e.key === 'Enter' && open()} />
              <button className="ghost" disabled={!jr.trim()} onClick={open}>Open</button>
            </div>
          </section>
        </div>
      </div>
      {err && <p className="err">{err}</p>}
    </main>
  );
}

export default function Page() {
  const [room, setRoom] = useState(null), [g, setG] = useState(null), [tok, setTok] = useState(null), [err, setErr] = useState('');
  const [sel, setSel] = useState([]), [bid, setBid] = useState(''), [f, setF] = useState({ code: '', name: '' }), [net, setNet] = useState('');
  const [, setTick] = useState(0), skew = useRef(0), refresh = useRef(null), busy = useRef(false), live = useRef({});
  const [unseated, setUnseated] = useState(false), wasSeated = useRef(false); // removed from the lobby without leaving

  const enter = useCallback((id, why = '') => { wasSeated.current = false; setUnseated(false); setG(null); setErr(why); setNet(''); setSel([]); setBid(''); setTok(id ? savedToken(id) : null); setRoom(id); }, []);
  const go = useCallback((id, why) => { history.pushState(null, '', id ? '?room=' + encodeURIComponent(id) : location.pathname); enter(id, why); }, [enter]);
  useEffect(() => {
    enter(roomFromUrl());
    const onPop = () => enter(roomFromUrl());
    addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop);
  }, [enter]);

  useEffect(() => { // poll the table; one request at a time, newest state wins, as rarely as the game allows
    if (!room || tok === null) return;
    let dead = false, timer, misses = 0, lastV = -1, lastBeat = 0, last = null, slow = 0;
    const load = async () => {
      clearTimeout(timer);
      const t0 = Date.now();
      const beat = tok && Date.now() - lastBeat > 20000; // seated players say "still here" every 20s
      try {
        const { status, j } = await api(`?room=${encodeURIComponent(room)}&token=${encodeURIComponent(tok)}${beat ? '&hb=1' : ''}`);
        if (dead) return;
        slow = status === 429 ? 5000 : 0;
        if (status === 404) { // only give up once the server keeps saying so, never on a single blip
          if (++misses >= 3) { dead = true; go('', 'This table no longer exists: the game finished or everyone left.'); return; }
        } else if (j.error) setNet(j.error);
        else {
          misses = 0; setNet(''); if (beat) lastBeat = Date.now();
          if (!(j.v < lastV)) { lastV = j.v; skew.current = j.now - Date.now(); setG(j); last = j; }
        }
      } catch { if (!dead) setNet('Connection problem, retrying…'); }
      if (!dead) timer = setTimeout(load, Math.max(slow, pollDelay(last, skew.current, Date.now() - t0)));
    };
    refresh.current = load;
    load();
    // A hidden tab polls slowly; coming back to it (or getting the network back) must show the table as it is now.
    const wake = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', wake); addEventListener('focus', wake); addEventListener('online', wake);
    return () => {
      dead = true; clearTimeout(timer); if (refresh.current === load) refresh.current = null;
      document.removeEventListener('visibilitychange', wake); removeEventListener('focus', wake); removeEventListener('online', wake);
    };
  }, [room, tok, go]);
  useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 250); return () => clearInterval(i); }, []);

  // Closing the tab while seated in the lobby frees the seat (after a short grace period, so a refresh keeps it).
  live.current = { room, tok, seated: !!g && g.phase === 'lobby' && g.me >= 0 };
  useEffect(() => {
    const bye = () => {
      const { room, tok, seated } = live.current;
      if (!seated) return;
      const body = JSON.stringify({ type: 'bye', room, token: tok });
      if (!navigator.sendBeacon?.('/api/game', new Blob([body], { type: 'text/plain' }))) fetch('/api/game', { method: 'POST', body, keepalive: true }).catch(() => {});
    };
    addEventListener('pagehide', bye); return () => removeEventListener('pagehide', bye);
  }, []);

  useEffect(() => {
    if (!g) return;
    if (g.me >= 0) { wasSeated.current = true; setUnseated(false); }
    else if (wasSeated.current && g.phase === 'lobby') { wasSeated.current = false; setUnseated(true); }
  }, [g]);

  const P = g ? g.players : [], me = g ? g.me : -1, mine = me >= 0 ? P[me] : null, hand = mine?.money || [];
  const a = g?.auction, t = g?.trade;
  const canPick = !!g && me >= 0 && ((g.phase === 'auction' && a.stage === 'pay' && a.payer === me) || (g.phase === 'trade' && !t.submitted.includes(me) && (t.a === me || (t.b === me && t.offer !== null))));
  const handKey = hand.join(',');
  useEffect(() => setSel([]), [handKey, canPick]); // selection is by position, so drop it whenever the hand changes

  const post = async body => {
    if (busy.current) return null; // ignore double clicks while a request is in flight
    busy.current = true; setErr('');
    try {
      const { j } = await api('', { room, token: tok, ...body });
      if (j.error) { setErr(j.error); refresh.current?.(); return null; } // most refusals mean our view was out of date
      setSel([]); refresh.current?.(); return j;
    } catch { setErr('Connection problem, please try again'); return null; }
    finally { busy.current = false; }
  };
  const join = async () => { const j = await post({ type: 'join', ...f }); if (j?.token) { saveToken(room, j.token); setTok(j.token); } };
  const playing = !!g && me >= 0 && !mine.out && g.phase !== 'lobby' && g.phase !== 'over';
  const leave = async () => {
    if (playing && !confirm('Leave the game? Your money is shared out among the others and your animals stay on the table for anyone to take.')) return;
    if (((g?.phase === 'lobby' && me >= 0) || playing) && !(await post({ type: 'leave' }))) return;
    if (g?.phase === 'lobby') saveToken(room, '');
    go('');
  };
  const kick = i => confirm(g.phase === 'lobby' ? `Remove ${P[i].name} from the table?` : `Kick ${P[i].name}? Their money is shared out and their animals stay on the table for anyone to take.`) && post({ type: 'kick', target: i });

  if (room === null) return <main><p>Loading…</p></main>;
  if (!room) return <Rooms go={go} err={err} />;
  if (!g) return <main><p>Loading…</p>{net && <p className="err">{net}</p>}<button className="ghost" onClick={() => go('')}>Back</button></main>;

  const name = i => P[i]?.name ?? '?';
  const picked = sel.map(i => hand[i]), pickedSum = sum(picked), money = sum(hand);
  const toggle = i => setSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);
  const secsTo = at => Math.max(0, Math.ceil((at - (g.paused ? g.paused.at : Date.now() + skew.current)) / 1000)); // clocks stand still while paused
  const left = a && a.stage === 'bidding' ? secsTo(a.deadline) : 0;
  const w = g.waiting, clock = w && g.due ? secsTo(g.due) : null;
  const clockLine = clock !== null && <p className={`clock${w.p === me ? ' mine' : ''}${clock <= 10 ? ' low' : ''}`}>{w.p === me ? 'Your' : `${name(w.p)}'s`} time: {clock}s</p>;
  const myTurn = me >= 0 && g.turn === me;
  const hostIdx = g.host ?? P.findIndex(p => !p.out && !p.bot), isHost = me >= 0 && me === hostIdx;
  const canKick = i => i !== me && !P[i].out && g.phase !== 'over' && me >= 0 && !mine.out && (isHost || (g.phase !== 'lobby' && P[i].strikes >= 2));
  const header = (
    <header className="topbar">
      <div className="grow">
        <h1>{g.name}</h1>
        <div className="chips">
          <span className="chip">Table <b>{room}</b></span>
          {!g.public && <span className="chip">Private</span>}
          {g.phase !== 'lobby' && <><span className="chip"><b>{g.deck}</b> animals left</span>{g.counts
            ? <span className="chip"><b>{g.mules ?? 0}</b>/{g.counts.mule} money mules</span>
            : <span className="chip"><b>{g.mules ?? 0}</b> money mule{g.mules === 1 ? '' : 's'} so far</span>}</>}
          {g.deckSize < 40 && <span className="chip">Deck of <b>{g.deckSize}</b>, secret sets</span>}
        </div>
      </div>
      <div className="row nowrap">
        {isHost && playing && <button className="ghost" onClick={() => post({ type: g.paused ? 'resume' : 'pause' })}>{g.paused ? 'Resume' : 'Pause'}</button>}
        <button className="ghost" onClick={leave}>{playing ? 'Leave game' : 'Leave'}</button>
      </div>
    </header>
  );

  if (me < 0 && g.phase === 'lobby') return (
    <main>
      <Rules />
      {header}
      {unseated && <p className="panel warn">You are no longer seated at this table: the host removed you or reset the table, or you were away too long. You can join again below.</p>}
      <section className="panel form narrow">
        <h2>Take a seat</h2>
        {!g.public && <input placeholder="Table code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />}
        <input placeholder="Your name" maxLength={16} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && join()} />
        <button onClick={join}>Join table</button>
        {err && <p className="err">{err}</p>}{net && <p className="err">{net}</p>}
        <p className="muted">At the table ({P.length}/5): {P.map(p => p.name + (p.bot ? ` (${p.bot} bot)` : '')).join(', ') || 'nobody yet'}.{!g.public && ' Already joined? Enter the same name to get back in.'}</p>
      </section>
    </main>
  );

  let panel = null;
  if (g.phase === 'lobby') panel = (<>
    <h2>Waiting for players ({P.length}/5)</h2>
    {isHost ? <>
      <p><button disabled={P.length < 3} onClick={() => post({ type: 'start' })}>Start game</button> {P.length < 3 && <span className="muted">Needs 3 players (bots count)</span>}</p>
      <AddBot post={post} full={P.length >= 5} />
    </> : <p>Waiting for {name(hostIdx)} to start.</p>}
    <p className="muted">Settings: {g.timeout}s per move · game log {g.showLog ? 'on' : 'off'} · {g.deckSize < 40 ? `${g.deckSize} animals, secret sets of 2 to 4` : 'normal deck of 40'}.</p>
    <p className="muted">Share the table ID <b>{room}</b>{!g.public && ' and the code'} with your friends. Players who close the page before the start lose their seat.</p>
  </>);
  else if (g.phase === 'turn') panel = myTurn ? (<>
    <h2>Your turn</h2>{clockLine}
    <div className="row">
      {g.deck > 0 && <button onClick={() => post({ type: 'auction' })}>Auction the next animal</button>}
      {g.targets.map((x, i) => <button key={i} className={x.free ? '' : 'ghost'} onClick={() => post({ type: 'koehandel', target: x.p, animal: x.type })}>
        {x.free ? `Take ${animals(x.count, x.type)} from ${name(x.p)}'s abandoned herd (free)` : `Koehandel with ${name(x.p)} for ${animals(x.count, x.type)}`}</button>)}
    </div>
  </>) : <><h2>{name(g.turn)} is choosing…</h2>{clockLine}</>;
  else if (g.phase === 'auction') {
    const hi = a.high, isAu = me === a.auctioneer;
    panel = (<div className="center"><Animal t={a.type} /><div>
      <h2>{name(a.auctioneer)} auctions a {nameOf(a.type)} with {ANIMALS[a.type]} points</h2>
      {a.stage === 'bidding' && (<>
        <p className="highbid"><span className="big">{hi ? hi.amt : '—'}</span><span>{hi ? <>highest bid by <b>{name(hi.p)}</b></> : 'no bids yet'}</span></p>
        {a.trail && a.trail.length > 1 && <p className="muted trail">before: {a.trail.slice(0, -1).reverse().map(([p, amt]) => `${name(p)} ${amt}`).join(' · ')}</p>}
        <div className={`bar${left <= 5 ? ' low' : ''}`}><i style={{ width: `${Math.min(100, left / 20 * 100)}%` }} /><span>{left}s</span></div>
        {isAu ? <div className="row"><button className="ghost" disabled={a.extended || left >= 20} onClick={() => post({ type: 'extend' })}>+5s</button><span className="muted">{a.extended ? 'You already added time. ' : 'You can add 5s once. '}Every bid resets the clock to 10s.</span></div>
          : hi && hi.p === me ? <p className="muted">You are the highest bidder.</p>
          : me >= 0 && <div className="row">
            {[10, 50, 100].map(d => { const amt = (hi ? hi.amt : 0) + d; return <button key={d} className="ghost" disabled={amt > money} onClick={() => post({ type: 'bid', amount: amt })}>+{d}</button>; })}
            <input type="number" step="10" min="10" placeholder="Your bid" value={bid} onChange={e => setBid(e.target.value)} />
            <button disabled={!bid} onClick={async () => { if (await post({ type: 'bid', amount: bid })) setBid(''); }}>Bid</button>
          </div>}
      </>)}
      {a.stage !== 'bidding' && clockLine}
      {a.stage === 'decide' && clock !== null && isAu && <p className="muted">If time runs out you {money >= hi.amt ? 'buy it' : 'sell it'} automatically.</p>}
      {a.stage === 'decide' && (isAu
        ? <div className="row"><button onClick={() => post({ type: 'sell' })}>Sell to {name(hi.p)} for {hi.amt}</button><button className="ghost" disabled={money < hi.amt} onClick={() => post({ type: 'buy' })}>Buy it for {hi.amt}</button></div>
        : <p>{name(a.auctioneer)} is deciding whether to sell or buy at {hi.amt}.</p>)}
      {a.stage === 'pay' && (a.payer === me
        ? <><p>Pay {name(a.payee)} at least <b>{hi.amt}</b>. No change is given. Selected: {pickedSum}</p><button disabled={pickedSum < hi.amt} onClick={() => post({ type: 'pay', cards: picked })}>Pay</button></>
        : <p>Waiting for {name(a.payer)} to pay {hi.amt}.</p>)}
    </div></div>);
  } else if (g.phase === 'trade') {
    const offered = t.offer !== null, isA = t.a === me, isB = t.b === me, done = t.submitted.includes(me), cards = n => `${n} card${n === 1 ? '' : 's'}`;
    panel = (<div className="center"><Animal t={t.type} badge={t.count} /><div>
      <h2>Koehandel: {name(t.a)} vs {name(t.b)} for {animals(t.count, t.type)}</h2>
      {t.ties > 0 && <p><b>It was a tie!</b> {name(t.a)} offers again. Another tie and {name(t.a)} wins for free.</p>}
      <p>{offered ? <>{name(t.a)} put <b>{cards(t.offer)}</b> face down.</> : `Waiting for ${name(t.a)} to make an offer.`}</p>
      {clockLine}
      {isA && !done && <><p>Pick your offer, face down. Picking none (or running out of time) offers 0. Selected: {pickedSum}</p><button onClick={() => post({ type: 'tradebid', cards: picked })}>Make offer ({cards(picked.length)})</button></>}
      {isA && done && <p>Your offer is on the table. Waiting for {name(t.b)} to answer.</p>}
      {isB && offered && <><p>If time runs out you accept automatically. Accept the offer (you hand over the {nameOf(t.type).toLowerCase()} and take the {cards(t.offer)}), or pick a counter-offer: the higher offer wins and the offers swap. Selected: {pickedSum}</p>
        <div className="row"><button className="ghost" onClick={() => post({ type: 'accept' })}>Accept offer</button><button onClick={() => post({ type: 'tradebid', cards: picked })}>Counter-offer ({cards(picked.length)})</button></div></>}
      {isB && !offered && <p>Wait for {name(t.a)}'s offer, then decide.</p>}
    </div></div>);
  } else if (g.phase === 'over') panel = (<>
    <h2>Final scores</h2>
    <ol className="scores">{[...P.keys()].sort((x, y) => P[y].score - P[x].score).map(i => { const rank = 1 + P.filter(q => q.score > P[i].score).length; return <li key={i} className={i === me ? 'me' : ''}><span className="rank">{ordinal(rank)}</span><Avatar i={i} name={P[i].name} /><b className="grow">{P[i].name}{i === me ? ' (you)' : ''}</b><span className="muted">{P[i].sets} set{P[i].sets === 1 ? '' : 's'}</span><span className="big">{P[i].score}</span></li>; })}</ol>
    {g.deckSize < 40 && g.counts && <p className="muted">This deck had {Object.entries(g.counts).map(([k, c]) => `${c} ${nameOf(k).toLowerCase()}`).join(', ')}.</p>}
  </>);

  return (
    <main>
      {header}
      <Rules />
      {me < 0 && <p className="muted">You are watching this game.{!g.public && ' Were you playing? Enter your table code and name to get back in.'}</p>}
      {mine?.out && g.phase !== 'over' && <p className="muted">You are no longer in this game. You can keep watching.</p>}
      {me < 0 && !g.public && <div className="panel row">
        <input placeholder="Table code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
        <input placeholder="Your name" maxLength={16} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <button onClick={join}>Rejoin</button>
      </div>}
      <div className="players">
        {P.map((p, i) => (
          <div key={i} className={`panel pl${(g.waiting ? g.waiting.p : a?.auctioneer) === i ? ' turn' : ''}${i === me ? ' me' : ''}${p.out ? ' out' : ''}`}>
            <div className="who"><Avatar i={i} name={p.name} /><div className="grow"><b>{p.name}{i === me ? ' (you)' : ''}</b>
              <span className="muted">{p.out ? 'out of the game · animals up for grabs' : <>{p.bot ? <span className="botTag">{cap(p.bot)} bot</span> : ''}{i === hostIdx ? 'host · ' : ''}{g.phase === 'lobby' ? 'ready' : `${p.cards} money card${p.cards === 1 ? '' : 's'}`}{p.strikes >= 2 ? ` · missed ${p.strikes} moves` : ''}{p.away ? ' · away' : ''}</>}</span></div>
              {canKick(i) && <button className="ghost small kick" onClick={() => kick(i)}>{g.phase === 'lobby' ? 'Remove' : 'Kick'}</button>}</div>
            <div className="row">{Object.entries(p.animals).filter(([, n]) => n > 0).map(([k, n]) => <Animal key={k} t={k} small badge={n} gold={!!g.counts && n === g.counts[k]} />)}</div>
          </div>
        ))}
      </div>
      {g.paused && g.phase !== 'over' && <div className="pausebox" role="dialog" aria-live="polite"><div className="panel">
        <h2>Game paused</h2>
        <p>{g.paused.by === me ? 'You paused the game. Everyone waits until you resume.' : <><b>{g.paused.name}</b> paused the game. Waiting for {isHost ? 'you' : 'them'} to resume.</>}</p>
        {isHost && <button onClick={() => post({ type: 'resume' })}>Resume</button>}
      </div></div>}
      {me >= 0 && <Notice key={room} n={g.note} />}
      <section className="panel stage">{panel}</section>
      {err && <p className="err">{err}</p>}{net && <p className="err">{net}</p>}
      {me >= 0 && !mine.out && g.phase !== 'lobby' && <div className="panel">
        <div className="row"><h2 className="grow">Your money</h2><span className="big">{money}</span></div>
        <div className="hand">{hand.map((v, i) => <Money key={i} v={v} sel={sel.includes(i)} onClick={canPick ? () => toggle(i) : null} />)}</div>
      </div>}
      {g.log.length > 0 && <div className="log"><span className="muted">{g.showLog ? 'Game log' : 'Latest (game log is off)'}</span><ul>{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
      {isHost && <div className="row">
        {g.phase !== 'lobby' && g.phase !== 'over' && <button className="ghost" onClick={() => confirm('End the game now?') && post({ type: 'end' })}>End game</button>}
        <button className="ghost" onClick={() => confirm('Reset the table? Everyone is removed.') && post({ type: 'reset' })}>Reset table</button>
      </div>}
    </main>
  );
}
