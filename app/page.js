'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ANIMALS } from '../lib/engine';

const cap = s => s[0].toUpperCase() + s.slice(1);
const sum = a => a.reduce((x, y) => x + y, 0);
const animals = (n, t) => (n > 1 && t !== 'sheep' ? `${n} ${cap(t)}s` : `${n > 1 ? n + ' ' : ''}${cap(t)}`);
const roomFromUrl = () => (new URLSearchParams(location.search).get('room') || '').trim().toLowerCase();
const savedToken = id => { try { return localStorage.getItem('kh:' + id) || ''; } catch { return ''; } };
const saveToken = (id, t) => { try { t ? localStorage.setItem('kh:' + id, t) : localStorage.removeItem('kh:' + id); } catch {} };

async function api(query = '', body) { // never throws on bad JSON; network errors still throw
  const res = await fetch('/api/game' + query, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }
    : { cache: 'no-store' });
  let j = null;
  try { j = await res.json(); } catch {}
  return { status: res.status, j: j || { error: `Server error (${res.status})` } };
}

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
const COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#7aa5d8', '#c792ea'];
const Avatar = ({ i, name }) => <span className="avatar" style={{ background: COLORS[i % COLORS.length] }}>{(name || '?')[0].toUpperCase()}</span>;
const Animal = ({ t, ...p }) => <Card src={`/cards/${t}.png`} label={cap(t)} {...p} />;
const Money = ({ v, ...p }) => <Card src={`/cards/${v}.jpg`} label={String(v)} {...p} />;

function Rooms({ go, err: e0 }) {
  const [list, setList] = useState(null), [err, setErr] = useState(e0), [n, setN] = useState({ name: '', pub: true, code: '', log: true, timeout: 60 }), [jr, setJr] = useState('');
  const [busy, setBusy] = useState(false), [listErr, setListErr] = useState('');
  useEffect(() => {
    let dead = false, timer;
    const load = async () => {
      try {
        const { j } = await api();
        if (dead) return;
        if (Array.isArray(j)) { setList(j); setListErr(''); } else setListErr(j.error);
      } catch { if (!dead) setListErr('Cannot reach the server, retrying…'); }
      if (!dead) timer = setTimeout(load, document.hidden ? 10000 : 3000);
    };
    load();
    return () => { dead = true; clearTimeout(timer); };
  }, []);
  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const { j } = await api('', { type: 'create', name: n.name, public: n.pub, code: n.code, log: n.log, timeout: n.timeout });
      j.error ? setErr(j.error) : go(j.room);
    } catch { setErr('Cannot reach the server'); }
    setBusy(false);
  };
  const open = () => { const id = jr.trim().toLowerCase(); if (id) go(id); };
  const label = p => (p === 'lobby' ? 'open' : p === 'over' ? 'finished' : 'playing');
  return (
    <main>
      <header className="hero">
        <h1>Kuhhandel</h1>
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
                  {[30, 45, 60, 90, 120, 180, 240, 300].map(v => <option key={v} value={v}>{v < 60 ? `${v}s` : `${v / 60} min`}</option>)}
                </select></label>
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

  const enter = useCallback((id, why = '') => { setG(null); setErr(why); setNet(''); setSel([]); setBid(''); setTok(id ? savedToken(id) : null); setRoom(id); }, []);
  const go = useCallback((id, why) => { history.pushState(null, '', id ? '?room=' + encodeURIComponent(id) : location.pathname); enter(id, why); }, [enter]);
  useEffect(() => {
    enter(roomFromUrl());
    const onPop = () => enter(roomFromUrl());
    addEventListener('popstate', onPop); return () => removeEventListener('popstate', onPop);
  }, [enter]);

  useEffect(() => { // poll the table; one request at a time, newest state wins
    if (!room || tok === null) return;
    let dead = false, timer, misses = 0, lastV = -1;
    const load = async () => {
      clearTimeout(timer);
      try {
        const { status, j } = await api(`?room=${encodeURIComponent(room)}&token=${encodeURIComponent(tok)}`);
        if (dead) return;
        if (status === 404) { // only give up once the server keeps saying so, never on a single blip
          if (++misses >= 3) { dead = true; go('', j.error || 'Room not found'); return; }
        } else if (j.error) setNet(j.error);
        else {
          misses = 0; setNet('');
          if (!(j.v < lastV)) { lastV = j.v; skew.current = j.now - Date.now(); setG(j); }
        }
      } catch { if (!dead) setNet('Connection problem, retrying…'); }
      if (!dead) timer = setTimeout(load, document.hidden ? 4000 : 1000);
    };
    refresh.current = load;
    load();
    return () => { dead = true; clearTimeout(timer); if (refresh.current === load) refresh.current = null; };
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
      if (j.error) { setErr(j.error); return null; }
      setSel([]); refresh.current?.(); return j;
    } catch { setErr('Connection problem, please try again'); return null; }
    finally { busy.current = false; }
  };
  const join = async () => { const j = await post({ type: 'join', ...f }); if (j?.token) { saveToken(room, j.token); setTok(j.token); } };
  const leave = async () => {
    if (g?.phase === 'lobby' && me >= 0 && !(await post({ type: 'leave' }))) return;
    if (g?.phase === 'lobby') saveToken(room, '');
    go('');
  };

  if (room === null) return <main><p>Loading…</p></main>;
  if (!room) return <Rooms go={go} err={err} />;
  if (!g) return <main><p>Loading…</p>{net && <p className="err">{net}</p>}<button className="ghost" onClick={() => go('')}>Back</button></main>;

  const name = i => P[i]?.name ?? '?';
  const picked = sel.map(i => hand[i]), pickedSum = sum(picked), money = sum(hand);
  const toggle = i => setSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);
  const secsTo = at => Math.max(0, Math.ceil((at - (Date.now() + skew.current)) / 1000));
  const left = a && a.stage === 'bidding' ? secsTo(a.deadline) : 0;
  const w = g.waiting, clock = w && g.due ? secsTo(g.due) : null;
  const clockLine = clock !== null && <p className={`clock${w.p === me ? ' mine' : ''}${clock <= 10 ? ' low' : ''}`}>{w.p === me ? 'Your' : `${name(w.p)}'s`} time: {clock}s</p>;
  const myTurn = me >= 0 && g.turn === me;
  const header = (
    <header className="topbar">
      <div className="grow">
        <h1>{g.name}</h1>
        <div className="chips">
          <span className="chip">Table <b>{room}</b></span>
          {!g.public && <span className="chip">Private</span>}
          {g.phase !== 'lobby' && <><span className="chip"><b>{g.deck}</b> animals left</span><span className="chip"><b>{g.donkeys}</b>/4 donkeys</span></>}
        </div>
      </div>
      <button className="ghost" onClick={leave}>Leave</button>
    </header>
  );

  if (me < 0 && g.phase === 'lobby') return (
    <main>
      {header}
      <section className="panel form narrow">
        <h2>Take a seat</h2>
        {!g.public && <input placeholder="Table code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />}
        <input placeholder="Your name" maxLength={16} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} onKeyDown={e => e.key === 'Enter' && join()} />
        <button onClick={join}>Join table</button>
        {err && <p className="err">{err}</p>}{net && <p className="err">{net}</p>}
        <p className="muted">At the table ({P.length}/5): {P.map(p => p.name).join(', ') || 'nobody yet'}.{!g.public && ' Already joined? Enter the same name to get back in.'}</p>
      </section>
    </main>
  );

  let panel = null;
  if (g.phase === 'lobby') panel = (<>
    <h2>Waiting for players ({P.length}/5)</h2>
    {me === 0 ? <p><button disabled={P.length < 3} onClick={() => post({ type: 'start' })}>Start game</button> {P.length < 3 && <span className="muted">Needs 3 players</span>}</p> : <p>Waiting for {name(0)} to start.</p>}
    <p className="muted">Settings: {g.timeout}s per move · game log {g.showLog ? 'on' : 'off'}.</p>
    <p className="muted">Share the table ID <b>{room}</b>{!g.public && ' and the code'} with your friends. Players who close the page before the start lose their seat.</p>
  </>);
  else if (g.phase === 'turn') panel = myTurn ? (<>
    <h2>Your turn</h2>{clockLine}
    <div className="row">
      {g.deck > 0 && <button onClick={() => post({ type: 'auction' })}>Auction the next animal</button>}
      {g.targets.map((x, i) => <button key={i} className="ghost" onClick={() => post({ type: 'challenge', target: x.p, animal: x.type })}>Trade with {name(x.p)} for {cap(x.type)}</button>)}
    </div>
  </>) : <><h2>{name(g.turn)} is choosing…</h2>{clockLine}</>;
  else if (g.phase === 'auction') {
    const hi = a.high, isAu = me === a.auctioneer;
    panel = (<div className="center"><Animal t={a.type} /><div>
      <h2>{name(a.auctioneer)} auctions a {cap(a.type)} with {ANIMALS[a.type]} points</h2>
      {a.stage === 'bidding' && (<>
        <p className="highbid"><span className="big">{hi ? hi.amt : '—'}</span><span>{hi ? <>highest bid by <b>{name(hi.p)}</b></> : 'no bids yet'}</span></p>
        <div className={`bar${left <= 5 ? ' low' : ''}`}><i style={{ width: `${Math.min(100, left / 20 * 100)}%` }} /><span>{left}s</span></div>
        {isAu ? <div className="row"><button className="ghost" disabled={left >= 20} onClick={() => post({ type: 'extend' })}>+5s</button><span className="muted">Bidding closes when the timer runs out (max 20s).</span></div>
          : hi && hi.p === me ? <p className="muted">You are the highest bidder.</p>
          : me >= 0 && <div className="row">
            {[10, 50, 100].map(d => { const amt = (hi ? hi.amt : 0) + d; return <button key={d} className="ghost" disabled={amt > money} onClick={() => post({ type: 'bid', amount: amt })}>+{d}</button>; })}
            <input type="number" step="10" min="10" placeholder="Your bid" value={bid} onChange={e => setBid(e.target.value)} />
            <button disabled={!bid} onClick={async () => { if (await post({ type: 'bid', amount: bid })) setBid(''); }}>Bid</button>
          </div>}
      </>)}
      {a.stage !== 'bidding' && clockLine}
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
      <h2>{name(t.a)} challenges {name(t.b)} for {animals(t.count, t.type)}</h2>
      {t.ties > 0 && <p><b>It was a tie!</b> {name(t.a)} offers again. Another tie and {name(t.a)} wins for free.</p>}
      <p>{offered ? <>{name(t.a)} put <b>{cards(t.offer)}</b> face down.</> : `Waiting for ${name(t.a)} to make an offer.`}</p>
      {clockLine}
      {isA && !done && <><p>Pick your offer, face down. Picking none offers 0. Selected: {pickedSum}</p><button onClick={() => post({ type: 'tradebid', cards: picked })}>Make offer ({cards(picked.length)})</button></>}
      {isA && done && <p>Your offer is on the table. Waiting for {name(t.b)} to answer.</p>}
      {isB && offered && <><p>Accept the offer (you hand over the {t.type} and take the {cards(t.offer)}), or pick a counter-offer: the higher offer wins and the offers swap. Selected: {pickedSum}</p>
        <div className="row"><button className="ghost" onClick={() => post({ type: 'accept' })}>Accept offer</button><button onClick={() => post({ type: 'tradebid', cards: picked })}>Counter-offer ({cards(picked.length)})</button></div></>}
      {isB && !offered && <p>Wait for {name(t.a)}'s offer, then decide.</p>}
    </div></div>);
  } else if (g.phase === 'over') panel = (<>
    <h2>Final scores</h2>
    <ol className="scores">{[...P.keys()].sort((x, y) => P[y].score - P[x].score).map((i, r) => <li key={i} className={r === 0 ? 'winner' : ''}><Avatar i={i} name={P[i].name} /><b className="grow">{P[i].name}</b><span className="muted">{P[i].sets} set{P[i].sets === 1 ? '' : 's'}</span><span className="big">{P[i].score}</span></li>)}</ol>
  </>);

  return (
    <main>
      {header}
      {me < 0 && <p className="muted">You are watching this game.{!g.public && ' Were you playing? Enter your table code and name to get back in.'}</p>}
      {me < 0 && !g.public && <div className="panel row">
        <input placeholder="Table code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />
        <input placeholder="Your name" maxLength={16} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <button onClick={join}>Rejoin</button>
      </div>}
      <div className="players">
        {P.map((p, i) => (
          <div key={i} className={`panel pl${(g.waiting ? g.waiting.p : a?.auctioneer) === i ? ' turn' : ''}${i === me ? ' me' : ''}`}>
            <div className="who"><Avatar i={i} name={p.name} /><div><b>{p.name}{i === me ? ' (you)' : ''}</b><span className="muted">{i === 0 && g.phase === 'lobby' ? 'host · ' : ''}{p.cards} money card{p.cards === 1 ? '' : 's'}</span></div></div>
            <div className="row">{Object.entries(p.animals).filter(([, n]) => n > 0).map(([k, n]) => <Animal key={k} t={k} small badge={n} gold={n === 4} />)}</div>
          </div>
        ))}
      </div>
      {me >= 0 && <Notice key={room} n={g.note} />}
      <section className="panel stage">{panel}</section>
      {err && <p className="err">{err}</p>}{net && <p className="err">{net}</p>}
      {me >= 0 && g.phase !== 'lobby' && <div className="panel">
        <div className="row"><h2 className="grow">Your money</h2><span className="big">{money}</span></div>
        <div className="hand">{hand.map((v, i) => <Money key={i} v={v} sel={sel.includes(i)} onClick={canPick ? () => toggle(i) : null} />)}</div>
      </div>}
      {g.log.length > 0 && <div className="log"><span className="muted">{g.showLog ? 'Game log' : 'Latest (game log is off)'}</span><ul>{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
      {me === 0 && <div className="row">
        {g.phase !== 'lobby' && g.phase !== 'over' && <button className="ghost" onClick={() => confirm('End the game now?') && post({ type: 'end' })}>End game</button>}
        <button className="ghost" onClick={() => confirm('Reset the table? Everyone is removed.') && post({ type: 'reset' })}>Reset table</button>
      </div>}
    </main>
  );
}
