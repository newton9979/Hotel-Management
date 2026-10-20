import React, { useCallback, useEffect, useState } from 'react';
import { api, session, money } from './api.js';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const Badge = ({ s }) => <span className={`badge ${s}`}>{String(s).replace('_', ' ')}</span>;

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    setError('');
    return fn().then(setData).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

/* ---------------- Login ---------------- */
function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } });
      session.set(res);
      onLogin(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login">
        <h1>Hotel Manager</h1>
        <div className="muted">Multi-property management console</div>
        <form onSubmit={submit}>
          {error && <div className="msg error">{error}</div>}
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="hint">
          Demo accounts (password <b>Hotel@12345</b>):<br />
          admin@hotels.test · manager1@hotels.test · reception1@hotels.test
        </div>
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ user, hotelId }) {
  const isAdmin = user.role === 'super_admin';
  const canSee = user.role !== 'receptionist';
  const summary = useLoad(() => (canSee ? api('/reports/summary', { params: { hotel_id: hotelId } }) : Promise.resolve(null)), [hotelId]);
  const overview = useLoad(() => (isAdmin ? api('/reports/overview') : Promise.resolve(null)), [isAdmin]);

  if (!canSee) return <div className="card"><h2>Welcome, {user.name}</h2><p className="muted">Use Bookings to check guests in and out, and Invoices to collect payments.</p></div>;
  const s = summary.data;
  const max = s ? Math.max(1, ...s.arrivals_next_7_days.map((d) => d.n)) : 1;
  return (
    <>
      {summary.error && <div className="msg error">{summary.error}</div>}
      {s && (
        <>
          <div className="grid stats" style={{ marginBottom: 18 }}>
            <div className="stat"><div className="label">Occupancy</div><div className="value">{s.occupancy_percent}%</div></div>
            <div className="stat"><div className="label">Rooms occupied</div><div className="value">{s.occupied_rooms} / {s.total_rooms}</div></div>
            <div className="stat"><div className="label">Revenue collected</div><div className="value">{money(s.revenue_paid)}</div></div>
            <div className="stat"><div className="label">Awaiting payment</div><div className="value">{money(s.revenue_unpaid)}</div></div>
          </div>
          <div className="card">
            <h2>Arrivals — next 7 days</h2>
            <div className="bars">
              {s.arrivals_next_7_days.map((d) => (
                <div className="bar" key={d.day}>
                  <div style={{ height: `${(d.n / max) * 80}px` }} />
                  {d.n}<br />{d.day.slice(5)}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {isAdmin && overview.data && (
        <div className="card">
          <h2>All hotels</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Hotel</th><th>City</th><th>Rooms</th><th>Occupied</th><th>Revenue</th></tr></thead>
              <tbody>
                {overview.data.map((h) => (
                  <tr key={h.id}><td>{h.name}</td><td>{h.city}</td><td>{h.rooms}</td><td>{h.occupied}</td><td>{money(h.revenue)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------- Rooms ---------------- */
function Rooms({ user, hotelId }) {
  const rooms = useLoad(() => api('/rooms', { params: { hotel_id: hotelId } }), [hotelId]);
  const types = useLoad(() => api('/room-types', { params: { hotel_id: hotelId } }), [hotelId]);
  const [form, setForm] = useState({ room_number: '', floor: 1, room_type_id: '' });
  const [msg, setMsg] = useState('');
  const canEdit = user.role !== 'receptionist';

  const add = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/rooms', { method: 'POST', params: { hotel_id: hotelId }, body: { ...form, hotel_id: hotelId, room_type_id: Number(form.room_type_id || types.data?.[0]?.id), floor: Number(form.floor) } });
      setForm({ ...form, room_number: '' });
      rooms.reload();
    } catch (err) { setMsg(err.message); }
  };
  const toggle = async (r) => {
    await api(`/rooms/${r.id}`, { method: 'PATCH', params: { hotel_id: hotelId }, body: { status: r.status === 'available' ? 'maintenance' : 'available' } });
    rooms.reload();
  };

  return (
    <>
      {canEdit && (
        <div className="card">
          <h2>Add room</h2>
          {msg && <div className="msg error">{msg}</div>}
          <form className="form-row" onSubmit={add}>
            <label>Room number<input value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} required /></label>
            <label>Floor<input type="number" min="0" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} style={{ width: 80 }} /></label>
            <label>Type
              <select value={form.room_type_id} onChange={(e) => setForm({ ...form, room_type_id: e.target.value })}>
                {(types.data || []).map((t) => <option key={t.id} value={t.id}>{t.name} — {money(t.price_per_night)}</option>)}
              </select>
            </label>
            <button className="btn">Add</button>
          </form>
        </div>
      )}
      <div className="card">
        <h2>Rooms ({rooms.data?.length ?? 0})</h2>
        {rooms.error && <div className="msg error">{rooms.error}</div>}
        <div className="room-grid">
          {(rooms.data || []).map((r) => (
            <div className="room" key={r.id}>
              <b>{r.room_number}</b>
              <div className="meta">{r.type_name} · {money(r.price_per_night)}</div>
              <Badge s={r.status === 'maintenance' ? 'maintenance' : r.occupied ? 'occupied' : 'available'} />
              {canEdit && <div style={{ marginTop: 8 }}><button className="btn ghost small" onClick={() => toggle(r)}>{r.status === 'available' ? 'Set maintenance' : 'Set available'}</button></div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---------------- Guests ---------------- */
function Guests({ hotelId }) {
  const [q, setQ] = useState('');
  const guests = useLoad(() => api('/guests', { params: { hotel_id: hotelId, q } }), [hotelId, q]);
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' });
  const [msg, setMsg] = useState('');

  const add = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/guests', { method: 'POST', params: { hotel_id: hotelId }, body: { ...form, hotel_id: hotelId } });
      setForm({ full_name: '', phone: '', email: '' });
      guests.reload();
    } catch (err) { setMsg(err.message); }
  };

  return (
    <>
      <div className="card">
        <h2>Register guest</h2>
        {msg && <div className="msg error">{msg}</div>}
        <form className="form-row" onSubmit={add}>
          <label>Full name<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
          <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <button className="btn">Add guest</button>
        </form>
      </div>
      <div className="card">
        <div className="form-row"><h2 style={{ marginRight: 'auto' }}>Guests</h2><input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th></tr></thead>
            <tbody>{(guests.data || []).map((g) => <tr key={g.id}><td>{g.full_name}</td><td>{g.phone}</td><td>{g.email}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Bookings ---------------- */
function Bookings({ hotelId }) {
  const [filter, setFilter] = useState('');
  const bookings = useLoad(() => api('/bookings', { params: { hotel_id: hotelId, status: filter } }), [hotelId, filter]);
  const guests = useLoad(() => api('/guests', { params: { hotel_id: hotelId } }), [hotelId]);
  const [dates, setDates] = useState({ check_in: today(), check_out: addDays(today(), 1) });
  const [avail, setAvail] = useState(null);
  const [pick, setPick] = useState({ room_id: '', guest_id: '' });
  const [msg, setMsg] = useState({ type: '', text: '' });

  const search = async (e) => {
    e?.preventDefault();
    setMsg({ type: '', text: '' });
    try {
      const rooms = await api('/rooms/available', { params: { hotel_id: hotelId, ...dates } });
      setAvail(rooms);
      setPick((p) => ({ ...p, room_id: rooms[0]?.id || '' }));
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  };

  const book = async () => {
    setMsg({ type: '', text: '' });
    try {
      await api('/bookings', { method: 'POST', params: { hotel_id: hotelId }, body: { hotel_id: hotelId, ...dates, room_id: Number(pick.room_id), guest_id: Number(pick.guest_id || guests.data?.[0]?.id) } });
      setMsg({ type: 'ok', text: 'Booking created' });
      setAvail(null);
      bookings.reload();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  };

  const setStatus = async (b, status) => {
    setMsg({ type: '', text: '' });
    try {
      await api(`/bookings/${b.id}/status`, { method: 'PATCH', params: { hotel_id: hotelId }, body: { status, hotel_id: hotelId } });
      if (status === 'checked_out') setMsg({ type: 'ok', text: 'Checked out — invoice generated under Invoices' });
      bookings.reload();
    } catch (err) { setMsg({ type: 'error', text: err.message }); }
  };

  return (
    <>
      <div className="card">
        <h2>New booking</h2>
        {msg.text && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <form className="form-row" onSubmit={search}>
          <label>Check-in<input type="date" value={dates.check_in} onChange={(e) => setDates({ ...dates, check_in: e.target.value })} required /></label>
          <label>Check-out<input type="date" value={dates.check_out} onChange={(e) => setDates({ ...dates, check_out: e.target.value })} required /></label>
          <button className="btn">Find rooms</button>
        </form>
        {avail && (
          avail.length === 0 ? <p className="muted">No rooms free for these dates.</p> : (
            <div className="form-row">
              <label>Room
                <select value={pick.room_id} onChange={(e) => setPick({ ...pick, room_id: e.target.value })}>
                  {avail.map((r) => <option key={r.id} value={r.id}>{r.room_number} · {r.type_name} · {money(r.price_per_night)}/night</option>)}
                </select>
              </label>
              <label>Guest
                <select value={pick.guest_id} onChange={(e) => setPick({ ...pick, guest_id: e.target.value })}>
                  {(guests.data || []).map((g) => <option key={g.id} value={g.id}>{g.full_name}</option>)}
                </select>
              </label>
              <button type="button" className="btn" onClick={book}>Confirm booking</button>
            </div>
          )
        )}
      </div>
      <div className="card">
        <div className="form-row">
          <h2 style={{ marginRight: 'auto' }}>Bookings</h2>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="reserved">Reserved</option>
            <option value="checked_in">Checked in</option>
            <option value="checked_out">Checked out</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {bookings.error && <div className="msg error">{bookings.error}</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Guest</th><th>Room</th><th>Stay</th><th>Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(bookings.data || []).map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td>
                  <td>{b.guest_name}</td>
                  <td>{b.room_number} <span className="muted">{b.type_name}</span></td>
                  <td>{b.check_in} → {b.check_out}</td>
                  <td>{money(b.total_amount)}</td>
                  <td><Badge s={b.status} /></td>
                  <td className="actions">
                    {b.status === 'reserved' && <><button className="btn small" onClick={() => setStatus(b, 'checked_in')}>Check in</button><button className="btn danger small" onClick={() => setStatus(b, 'cancelled')}>Cancel</button></>}
                    {b.status === 'checked_in' && <button className="btn small" onClick={() => setStatus(b, 'checked_out')}>Check out</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Invoices ---------------- */
function Invoices({ hotelId }) {
  const invoices = useLoad(() => api('/invoices', { params: { hotel_id: hotelId } }), [hotelId]);
  const [msg, setMsg] = useState('');
  const pay = async (inv, method) => {
    setMsg('');
    try {
      await api(`/invoices/${inv.id}/pay`, { method: 'POST', params: { hotel_id: hotelId }, body: { hotel_id: hotelId, payment_method: method } });
      invoices.reload();
    } catch (err) { setMsg(err.message); }
  };
  return (
    <div className="card">
      <h2>Invoices</h2>
      {(msg || invoices.error) && <div className="msg error">{msg || invoices.error}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Guest</th><th>Room</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(invoices.data || []).map((i) => (
              <tr key={i.id}>
                <td>{i.id}</td><td>{i.guest_name}</td><td>{i.room_number}</td>
                <td>{money(i.subtotal)}</td><td>{money(i.tax_amount)}</td><td><b>{money(i.total)}</b></td>
                <td><Badge s={i.status} />{i.payment_method && <span className="muted"> {i.payment_method}</span>}</td>
                <td className="actions">
                  {i.status === 'unpaid' && ['cash', 'card', 'upi'].map((m) => <button key={m} className="btn ghost small" onClick={() => pay(i, m)}>{m}</button>)}
                </td>
              </tr>
            ))}
            {invoices.data?.length === 0 && <tr><td colSpan="8" className="muted">No invoices yet. They are created at check-out.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Staff ---------------- */
function Staff({ user, hotelId }) {
  const users = useLoad(() => api('/users', { params: { hotel_id: hotelId } }), [hotelId]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'receptionist' });
  const [msg, setMsg] = useState('');
  const roles = user.role === 'super_admin' ? ['manager', 'receptionist'] : ['receptionist'];
  const add = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api('/users', { method: 'POST', params: { hotel_id: hotelId }, body: { ...form, hotel_id: hotelId } });
      setForm({ name: '', email: '', password: '', role: 'receptionist' });
      users.reload();
    } catch (err) { setMsg(err.message); }
  };
  return (
    <>
      <div className="card">
        <h2>Add staff</h2>
        {msg && <div className="msg error">{msg}</div>}
        <form className="form-row" onSubmit={add}>
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label>Password (min 8)<input type="password" minLength="8" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
          <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r}>{r}</option>)}</select></label>
          <button className="btn">Add</button>
        </form>
      </div>
      <div className="card">
        <h2>Staff at this hotel</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody>{(users.data || []).slice(0, 50).map((u) => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Shell ---------------- */
export default function App() {
  const [user, setUser] = useState(session.user && session.token ? session.user : null);
  const [page, setPage] = useState('dashboard');
  const [hotels, setHotels] = useState([]);
  const [hotelId, setHotelId] = useState(null);

  useEffect(() => {
    if (!user) return;
    api('/hotels').then((h) => {
      setHotels(h);
      setHotelId((cur) => cur || (user.role === 'super_admin' ? h[0]?.id : user.hotel_id));
    }).catch(() => {});
  }, [user]);

  if (!user) return <Login onLogin={setUser} />;

  const isStaffManager = user.role !== 'receptionist';
  const nav = [
    ['dashboard', 'Dashboard'], ['bookings', 'Bookings'], ['rooms', 'Rooms'],
    ['guests', 'Guests'], ['invoices', 'Invoices'], ...(isStaffManager ? [['staff', 'Staff']] : []),
  ];
  const logout = () => { session.clear(); setUser(null); setHotelId(null); };
  const hotel = hotels.find((h) => h.id === hotelId);
  const props = { user, hotelId };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Hotel Manager<small>{user.role === 'super_admin' ? 'All properties' : user.hotel_name}</small></div>
        <nav className="nav">
          {nav.map(([k, label]) => <button key={k} className={page === k ? 'active' : ''} onClick={() => setPage(k)}>{label}</button>)}
        </nav>
        <div className="spacer" />
        <div className="userbox">
          {user.name}<br />{user.role.replace('_', ' ')}
          <div><button className="btn ghost small" onClick={logout}>Sign out</button></div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{nav.find(([k]) => k === page)?.[1]}{hotel && user.role !== 'super_admin' ? ` · ${hotel.name}` : ''}</h1>
          {user.role === 'super_admin' && (
            <div className="hotel-pick">
              <span className="muted">Hotel</span>
              <select value={hotelId || ''} onChange={(e) => setHotelId(Number(e.target.value))}>
                {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
          )}
        </div>
        {hotelId ? (
          <>
            {page === 'dashboard' && <Dashboard {...props} />}
            {page === 'bookings' && <Bookings {...props} />}
            {page === 'rooms' && <Rooms {...props} />}
            {page === 'guests' && <Guests {...props} />}
            {page === 'invoices' && <Invoices {...props} />}
            {page === 'staff' && isStaffManager && <Staff {...props} />}
          </>
        ) : <p className="muted">Loading…</p>}
      </main>
    </div>
  );
}
