'use client';
import { useState, useEffect, useRef } from 'react';

const EXT = 'png'; // change to 'jpeg' or 'png' to match your files
const EXT_MONEY = 'jpg'; // change to 'jpeg' or 'png' to match your files
const cap = s => s[0].toUpperCase() + s.slice(1);
const sum = a => a.reduce((x, y) => x + y, 0);

function Card({ src, label, sel, onClick, small, badge, gold }) {
  const [bad, setBad] = useState(false); // falls back to a text card if the image is missing
  return (
    <div className={`card${small ? ' sm' : ''}${sel ? ' sel' : ''}${gold ? ' gold' : ''}${onClick ? ' click' : ''}`} onClick={onClick}>
      {bad ? <span className="fb">{label}</span> : <img src={src} alt={label} onError={() => setBad(true)} />}
      {badge > 1 && <b className="badge">×{badge}</b>}
    </div>
  );
}
const Animal = ({ t, ...p }) => <Card src={`/cards/${t}.${EXT}`} label={cap(t)} {...p} />;
const Money = ({ v, ...p }) => <Card src={`/cards/${v}.${EXT_MONEY}`} label={String(v)} {...p} />;

function Rooms({ go, err: e0 }) {
  const [list, setList] = useState([]), [err, setErr] = useState(e0), [n, setN] = useState({ name: '', pub: true, code: '' }), [jr, setJr] = useState('');
  useEffect(() => {
    const load = async () => setList(await (await fetch('/api/game', { cache: 'no-store' })).json());
    load(); const i = setInterval(load, 2000); return () => clearInterval(i);
  }, []);
  const create = async () => {
    const j = await (await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'create', name: n.name, public: n.pub, code: n.code }) })).json();
    j.error ? setErr(j.error) : go(j.room);
  };
  return (
    <main>
      <h1>Kuhhandel</h1>
      <div className="panel">
        <h2>Public tables</h2>
        {list.length ? list.map(r => <p key={r.id} className="row"><b>{r.name}</b><span className="muted">{r.players}/5 · {r.phase === 'lobby' ? 'open' : 'playing'}</span><button className="ghost" onClick={() => go(r.id)}>Open</button></p>) : <p className="muted">No public tables yet.</p>}
      </div>
      <div className="panel row">
        <h2>New table</h2>
        <input placeholder="Table name" value={n.name} onChange={e => setN({ ...n, name: e.target.value })} />
        <label className="row"><input type="checkbox" style={{ width: 'auto' }} checked={n.pub} onChange={e => setN({ ...n, pub: e.target.checked })} />Public</label>
        {!n.pub && <input placeholder="Table code" value={n.code} onChange={e => setN({ ...n, code: e.target.value })} />}
        <button onClick={create}>Create</button>
      </div>
      <div className="panel row">
        <h2>Private table</h2>
        <input placeholder="Table ID" value={jr} onChange={e => setJr(e.target.value)} />
        <button className="ghost" disabled={!jr.trim()} onClick={() => go(jr.trim())}>Open</button>
      </div>
      {err && <p className="err">{err}</p>}
    </main>
  );
}

export default function Page() {
  const [room, setRoom] = useState(null), [g, setG] = useState(null), [tok, setTok] = useState(null), [err, setErr] = useState('');
  const [sel, setSel] = useState([]), [bid, setBid] = useState(''), [f, setF] = useState({ code: '', name: '' });
  const [, setTick] = useState(0), skew = useRef(0);

  const go = id => { history.pushState({}, '', id ? '?room=' + id : '/'); setG(null); setErr(''); setRoom(id); };
  useEffect(() => { setRoom(new URLSearchParams(location.search).get('room') || ''); }, []);
  useEffect(() => { if (room) setTok(localStorage.getItem('kh:' + room) || ''); }, [room]);
  useEffect(() => {
    if (!room || tok === null) return;
    const load = async () => {
      const j = await (await fetch(`/api/game?room=${room}&token=${tok}`, { cache: 'no-store' })).json();
      if (j.error) { go(''); setErr(j.error); return; }
      skew.current = j.now - Date.now(); setG(j);
    };
    load(); const i = setInterval(load, 1000); window.khLoad = load;
    return () => clearInterval(i);
  }, [room, tok]);
  useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 250); return () => clearInterval(i); }, []);

  const post = async body => {
    setErr('');
    const j = await (await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, token: tok, ...body }) })).json();
    if (j.error) { setErr(j.error); return null; }
    setSel([]); window.khLoad?.(); return j;
  };
  const join = async () => { const j = await post({ type: 'join', ...f }); if (j?.token) { localStorage.setItem('kh:' + room, j.token); setTok(j.token); } };

  if (room === null) return <main><p>Loading…</p></main>;
  if (!room) return <Rooms go={go} err={err} />;
  if (!g) return <main><p>Loading…</p></main>;
  const { me, players: P, auction: a, trade: t } = g, mine = P[me];

  if (me < 0) return (
    <main>
      <h1>{g.name}</h1>
      <div className="panel row">
        {!g.public && <input placeholder="Table code" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} />}
        <input placeholder="Your name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <button onClick={join}>Join table</button>
        <button className="ghost" onClick={() => go('')}>Back</button>
      </div>
      {err && <p className="err">{err}</p>}
      <p className="muted">At the table: {P.map(p => p.name).join(', ') || 'nobody yet'}.{!g.public && ' Already joined? Enter the same name to get back in.'}</p>
    </main>
  );

  const name = i => P[i].name, hand = mine.money || [];
  const picked = sel.map(i => hand[i]), pickedSum = sum(picked);
  const toggle = i => setSel(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i]);
  const left = a && a.stage === 'bidding' ? Math.max(0, Math.ceil((a.deadline - (Date.now() + skew.current)) / 1000)) : 0;
  const canPick = (a && a.stage === 'pay' && a.payer === me) || (t && (t.a === me || t.b === me) && !t.submitted.includes(me));
  const myTurn = g.turn === me;

  let panel = null;
  if (g.phase === 'lobby') panel = (<>
    <h2>Waiting for players ({P.length}/5)</h2>
    {me === 0 ? <p><button disabled={P.length < 3} onClick={() => post({ type: 'start' })}>Start game</button> {P.length < 3 && <span className="muted">Needs 3 players</span>}</p> : <p>Waiting for {name(0)} to start.</p>}
  </>);
  else if (g.phase === 'turn') panel = myTurn ? (<>
    <h2>Your turn</h2>
    <div className="row">
      {g.deck > 0 && <button onClick={() => post({ type: 'auction' })}>Auction the next animal</button>}
      {g.targets.map((x, i) => <button key={i} className="ghost" onClick={() => post({ type: 'challenge', target: x.p, animal: x.type })}>Trade with {name(x.p)} for {cap(x.type)}</button>)}
    </div>
  </>) : <h2>{name(g.turn)} is choosing…</h2>;
  else if (g.phase === 'auction') {
    const hi = a.high, isAu = me === a.auctioneer;
    panel = (<div className="center"><Animal t={a.type} /><div>
      <h2>{name(a.auctioneer)} auctions a {cap(a.type)}</h2>
      {a.stage === 'bidding' && (<>
        <p><span className="big">{hi ? hi.amt : '—'}</span> {hi ? `${name(hi.p)}` : 'no bids yet'} · closes in {left}s</p>
        {isAu ? <div className="row"><button className="ghost" onClick={() => post({ type: 'extend' })}>+10s</button><button onClick={() => post({ type: 'close' })}>Close bidding</button></div>
          : <div className="row">
            {[10, 50, 100].map(d => <button key={d} className="ghost" onClick={() => post({ type: 'bid', amount: (hi ? hi.amt : 0) + d })}>+{d}</button>)}
            <input type="number" step="10" placeholder="Your bid" value={bid} onChange={e => setBid(e.target.value)} />
            <button onClick={() => post({ type: 'bid', amount: bid })}>Bid</button>
          </div>}
      </>)}
      {a.stage === 'decide' && (isAu
        ? <div className="row"><button onClick={() => post({ type: 'sell' })}>Sell to {name(hi.p)} for {hi.amt}</button><button className="ghost" onClick={() => post({ type: 'buy' })}>Buy it for {hi.amt}</button></div>
        : <p>{name(a.auctioneer)} is deciding whether to sell or buy at {hi.amt}.</p>)}
      {a.stage === 'pay' && (a.payer === me
        ? <><p>Pay {name(a.payee)} at least <b>{hi.amt}</b>. No change is given. Selected: {pickedSum}</p><button disabled={pickedSum < hi.amt} onClick={() => post({ type: 'pay', cards: picked })}>Pay</button></>
        : <p>Waiting for {name(a.payer)} to pay {hi.amt}.</p>)}
    </div></div>);
  } else if (g.phase === 'trade') {
    const inTrade = t.a === me || t.b === me, done = t.submitted.includes(me);
    panel = (<div className="center"><Animal t={t.type} badge={t.count} /><div>
      <h2>{name(t.a)} vs {name(t.b)} for {t.count > 1 ? `${t.count} ` : ''}{cap(t.type)}</h2>
      <p>Bids in: {t.submitted.length ? t.submitted.map(name).join(', ') : 'none yet'}. Higher bid wins, then both bids swap hands.</p>
      {inTrade && !done ? <><p>Pick cards face down. Picking none bids 0. Selected: {pickedSum}</p><button onClick={() => post({ type: 'tradebid', cards: picked })}>Lock in bid</button></>
        : <p>{done ? 'Your bid is locked.' : 'Waiting for the bids.'}</p>}
    </div></div>);
  } else if (g.phase === 'over') panel = (<>
    <h2>Final scores</h2>
    {[...P.keys()].sort((x, y) => P[y].score - P[x].score).map(i => <p key={i}><b>{P[i].name}</b>: {P[i].score} ({P[i].sets} sets)</p>)}
  </>);

  return (
    <main>
      <div className="row"><h1>{g.name}</h1><button className="ghost" onClick={() => go('')}>Leave</button><span className="muted">{g.deck} animals left · {g.donkeys}/4 donkeys out</span></div>
      <div className="players">
        {P.map((p, i) => (
          <div key={i} className={`panel pl${g.phase === 'turn' && g.turn === i ? ' turn' : ''}`}>
            <b>{p.name}{i === me ? ' (you)' : ''}</b>
            <span className="muted">{p.cards} money cards</span>
            <div className="row">{Object.entries(p.animals).filter(([, n]) => n > 0).map(([k, n]) => <Animal key={k} t={k} small badge={n} gold={n === 4} />)}</div>
          </div>
        ))}
      </div>
      <div className="panel">{panel}</div>
      {err && <p className="err">{err}</p>}
      <div className="panel">
        <b>Your money: {sum(hand)}</b>
        <div className="hand">{hand.map((v, i) => <Money key={i} v={v} sel={sel.includes(i)} onClick={canPick ? () => toggle(i) : null} />)}</div>
      </div>
      <ul className="log">{g.log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {me === 0 && <div className="row">
        {g.phase !== 'lobby' && g.phase !== 'over' && <button className="ghost" onClick={() => confirm('End the game now?') && post({ type: 'end' })}>End game</button>}
        <button className="ghost" onClick={() => confirm('Reset the table? Everyone is removed.') && post({ type: 'reset' })}>Reset table</button>
      </div>}
    </main>
  );
}