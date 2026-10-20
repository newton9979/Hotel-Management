const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { query, tx } = require('./db');
const { sign, authenticate, requireRole, hotelScope } = require('./auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
const MANAGERS = ['super_admin', 'manager'];

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- Health ----------
router.get('/health', wrap(async (req, res) => {
  await query('SELECT 1');
  res.json({ status: 'ok', time: new Date().toISOString() });
}));

// ---------- Auth ----------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_MAX || '1000', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/auth/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return bad(res, 'Email and password required');
  const { rows } = await query(
    `SELECT u.*, h.name AS hotel_name FROM users u
     LEFT JOIN hotels h ON h.id = u.hotel_id
     WHERE lower(u.email) = lower($1) AND u.active`, [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return bad(res, 'Invalid credentials', 401);
  }
  res.json({
    token: sign(user),
    user: { id: user.id, name: user.name, email: user.email, role: user.role,
            hotel_id: user.hotel_id, hotel_name: user.hotel_name },
  });
}));

// Everything below needs a valid token
router.use(authenticate);

// ---------- Hotels ----------
router.get('/hotels', wrap(async (req, res) => {
  const { rows } = req.user.role === 'super_admin'
    ? await query('SELECT * FROM hotels ORDER BY name')
    : await query('SELECT * FROM hotels WHERE id = $1', [req.user.hotel_id]);
  res.json(rows);
}));

router.post('/hotels', requireRole('super_admin'), wrap(async (req, res) => {
  const { name, city, address, phone, tax_percent } = req.body || {};
  if (!name || !city) return bad(res, 'name and city are required');
  const { rows } = await query(
    `INSERT INTO hotels (name, city, address, phone, tax_percent)
     VALUES ($1,$2,$3,$4,COALESCE($5,12)) RETURNING *`,
    [name, city, address || null, phone || null, tax_percent]);
  res.status(201).json(rows[0]);
}));

// ---------- Staff users ----------
router.get('/users', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role, active, hotel_id FROM users WHERE hotel_id = $1 ORDER BY name`,
    [req.hotelId]);
  res.json(rows);
}));

router.post('/users', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || password.length < 8) {
    return bad(res, 'name, email and password (min 8 chars) are required');
  }
  const allowed = req.user.role === 'super_admin' ? ['manager', 'receptionist'] : ['receptionist'];
  if (!allowed.includes(role)) return bad(res, `role must be one of: ${allowed.join(', ')}`);
  const hash = await bcrypt.hash(password, ROUNDS);
  try {
    const { rows } = await query(
      `INSERT INTO users (hotel_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, hotel_id`,
      [req.hotelId, name, email, hash, role]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'Email already exists', 409);
    throw e;
  }
}));

// ---------- Room types ----------
router.get('/room-types', hotelScope, wrap(async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM room_types WHERE hotel_id = $1 ORDER BY price_per_night', [req.hotelId]);
  res.json(rows);
}));

router.post('/room-types', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const { name, capacity, price_per_night } = req.body || {};
  if (!name || !(price_per_night > 0)) return bad(res, 'name and a positive price_per_night are required');
  try {
    const { rows } = await query(
      `INSERT INTO room_types (hotel_id, name, capacity, price_per_night)
       VALUES ($1,$2,COALESCE($3,2),$4) RETURNING *`,
      [req.hotelId, name, capacity, price_per_night]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'Room type already exists', 409);
    throw e;
  }
}));

// ---------- Rooms ----------
router.get('/rooms', hotelScope, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, t.name AS type_name, t.price_per_night, t.capacity,
       EXISTS (SELECT 1 FROM bookings b WHERE b.room_id = r.id AND b.status = 'checked_in') AS occupied
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     WHERE r.hotel_id = $1 ORDER BY r.room_number`, [req.hotelId]);
  res.json(rows);
}));

router.post('/rooms', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const { room_type_id, room_number, floor } = req.body || {};
  if (!room_type_id || !room_number) return bad(res, 'room_type_id and room_number are required');
  const type = await query('SELECT 1 FROM room_types WHERE id = $1 AND hotel_id = $2', [room_type_id, req.hotelId]);
  if (!type.rowCount) return bad(res, 'Unknown room type for this hotel');
  try {
    const { rows } = await query(
      `INSERT INTO rooms (hotel_id, room_type_id, room_number, floor)
       VALUES ($1,$2,$3,COALESCE($4,1)) RETURNING *`,
      [req.hotelId, room_type_id, String(room_number), floor]);
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'Room number already exists', 409);
    throw e;
  }
}));

router.patch('/rooms/:id', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['available', 'maintenance'].includes(status)) return bad(res, 'Invalid status');
  const { rows } = await query(
    'UPDATE rooms SET status = $1 WHERE id = $2 AND hotel_id = $3 RETURNING *',
    [status, req.params.id, req.hotelId]);
  if (!rows[0]) return bad(res, 'Room not found', 404);
  res.json(rows[0]);
}));

router.get('/rooms/available', hotelScope, wrap(async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!DATE_RE.test(check_in || '') || !DATE_RE.test(check_out || '') || check_out <= check_in) {
    return bad(res, 'Valid check_in and check_out (YYYY-MM-DD, check_out after check_in) required');
  }
  const { rows } = await query(
    `SELECT r.id, r.room_number, r.floor, t.name AS type_name, t.price_per_night, t.capacity
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id
     WHERE r.hotel_id = $1 AND r.status = 'available'
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.room_id = r.id AND b.status IN ('reserved','checked_in')
           AND b.check_in < $3::date AND b.check_out > $2::date)
     ORDER BY r.room_number`, [req.hotelId, check_in, check_out]);
  res.json(rows);
}));

// ---------- Guests ----------
router.get('/guests', hotelScope, wrap(async (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  const { rows } = await query(
    `SELECT * FROM guests WHERE hotel_id = $1
       AND (full_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
     ORDER BY created_at DESC LIMIT 100`, [req.hotelId, q]);
  res.json(rows);
}));

router.post('/guests', hotelScope, wrap(async (req, res) => {
  const { full_name, email, phone, id_proof } = req.body || {};
  if (!full_name) return bad(res, 'full_name is required');
  const { rows } = await query(
    `INSERT INTO guests (hotel_id, full_name, email, phone, id_proof)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.hotelId, full_name, email || null, phone || null, id_proof || null]);
  res.status(201).json(rows[0]);
}));

// ---------- Bookings ----------
router.get('/bookings', hotelScope, wrap(async (req, res) => {
  const params = [req.hotelId];
  let where = 'b.hotel_id = $1';
  if (req.query.status) { params.push(req.query.status); where += ` AND b.status = $${params.length}`; }
  const { rows } = await query(
    `SELECT b.*, g.full_name AS guest_name, g.phone AS guest_phone,
            r.room_number, t.name AS type_name,
            i.id AS invoice_id, i.status AS invoice_status
     FROM bookings b
     JOIN guests g ON g.id = b.guest_id
     JOIN rooms r ON r.id = b.room_id
     JOIN room_types t ON t.id = r.room_type_id
     LEFT JOIN invoices i ON i.booking_id = b.id
     WHERE ${where} ORDER BY b.created_at DESC LIMIT 200`, params);
  res.json(rows);
}));

router.post('/bookings', hotelScope, wrap(async (req, res) => {
  const { room_id, guest_id, check_in, check_out, adults } = req.body || {};
  if (!room_id || !guest_id) return bad(res, 'room_id and guest_id are required');
  if (!DATE_RE.test(check_in || '') || !DATE_RE.test(check_out || '') || check_out <= check_in) {
    return bad(res, 'Valid check_in and check_out (check_out after check_in) required');
  }
  const booking = await tx(async (c) => {
    // Lock the room row so two receptionists cannot double-book the same room
    const room = await c.query(
      `SELECT r.id, r.status, t.price_per_night FROM rooms r
       JOIN room_types t ON t.id = r.room_type_id
       WHERE r.id = $1 AND r.hotel_id = $2 FOR UPDATE OF r`, [room_id, req.hotelId]);
    if (!room.rowCount) { const e = new Error('Room not found'); e.status = 404; throw e; }
    if (room.rows[0].status !== 'available') { const e = new Error('Room is under maintenance'); e.status = 409; throw e; }
    const guest = await c.query('SELECT 1 FROM guests WHERE id = $1 AND hotel_id = $2', [guest_id, req.hotelId]);
    if (!guest.rowCount) { const e = new Error('Guest not found'); e.status = 404; throw e; }
    const clash = await c.query(
      `SELECT 1 FROM bookings WHERE room_id = $1 AND status IN ('reserved','checked_in')
         AND check_in < $3::date AND check_out > $2::date LIMIT 1`, [room_id, check_in, check_out]);
    if (clash.rowCount) { const e = new Error('Room is already booked for these dates'); e.status = 409; throw e; }
    const nights = Math.round((new Date(check_out) - new Date(check_in)) / 86400000);
    const total = nights * Number(room.rows[0].price_per_night);
    const ins = await c.query(
      `INSERT INTO bookings (hotel_id, room_id, guest_id, check_in, check_out, adults, total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,1),$7,$8) RETURNING *`,
      [req.hotelId, room_id, guest_id, check_in, check_out, adults, total, req.user.id]);
    return ins.rows[0];
  });
  res.status(201).json(booking);
}));

const TRANSITIONS = {
  reserved: ['checked_in', 'cancelled'],
  checked_in: ['checked_out'],
};

router.patch('/bookings/:id/status', hotelScope, wrap(async (req, res) => {
  const { status } = req.body || {};
  const result = await tx(async (c) => {
    const cur = await c.query(
      'SELECT * FROM bookings WHERE id = $1 AND hotel_id = $2 FOR UPDATE', [req.params.id, req.hotelId]);
    const b = cur.rows[0];
    if (!b) { const e = new Error('Booking not found'); e.status = 404; throw e; }
    if (!(TRANSITIONS[b.status] || []).includes(status)) {
      const e = new Error(`Cannot change booking from ${b.status} to ${status}`); e.status = 409; throw e;
    }
    const upd = await c.query('UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *', [status, b.id]);
    let invoice = null;
    if (status === 'checked_out') {
      const h = await c.query('SELECT tax_percent FROM hotels WHERE id = $1', [req.hotelId]);
      const subtotal = Number(b.total_amount);
      const tax = Math.round(subtotal * Number(h.rows[0].tax_percent)) / 100;
      const inv = await c.query(
        `INSERT INTO invoices (hotel_id, booking_id, subtotal, tax_amount, total)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (booking_id) DO NOTHING RETURNING *`,
        [req.hotelId, b.id, subtotal, tax, subtotal + tax]);
      invoice = inv.rows[0] || null;
    }
    return { booking: upd.rows[0], invoice };
  });
  res.json(result);
}));

// ---------- Invoices ----------
router.get('/invoices', hotelScope, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT i.*, g.full_name AS guest_name, r.room_number, b.check_in, b.check_out
     FROM invoices i
     JOIN bookings b ON b.id = i.booking_id
     JOIN guests g ON g.id = b.guest_id
     JOIN rooms r ON r.id = b.room_id
     WHERE i.hotel_id = $1 ORDER BY i.created_at DESC LIMIT 200`, [req.hotelId]);
  res.json(rows);
}));

router.post('/invoices/:id/pay', hotelScope, wrap(async (req, res) => {
  const method = (req.body || {}).payment_method;
  if (!['cash', 'card', 'upi'].includes(method)) return bad(res, 'payment_method must be cash, card or upi');
  const { rows } = await query(
    `UPDATE invoices SET status = 'paid', payment_method = $1, paid_at = now()
     WHERE id = $2 AND hotel_id = $3 AND status = 'unpaid' RETURNING *`,
    [method, req.params.id, req.hotelId]);
  if (!rows[0]) return bad(res, 'Invoice not found or already paid', 404);
  res.json(rows[0]);
}));

// ---------- Reports ----------
router.get('/reports/summary', requireRole(...MANAGERS), hotelScope, wrap(async (req, res) => {
  const id = req.hotelId;
  const [rooms, occupied, revenue, byStatus, arrivals] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM rooms WHERE hotel_id = $1 AND status = 'available'`, [id]),
    query(`SELECT count(DISTINCT room_id)::int AS n FROM bookings WHERE hotel_id = $1 AND status = 'checked_in'`, [id]),
    query(`SELECT
             COALESCE(sum(total) FILTER (WHERE status = 'paid'), 0)::float   AS paid,
             COALESCE(sum(total) FILTER (WHERE status = 'unpaid'), 0)::float AS unpaid
           FROM invoices WHERE hotel_id = $1`, [id]),
    query(`SELECT status, count(*)::int AS n FROM bookings WHERE hotel_id = $1 GROUP BY status`, [id]),
    query(`SELECT d::date AS day, count(b.id)::int AS n
           FROM generate_series(current_date, current_date + 6, '1 day') d
           LEFT JOIN bookings b ON b.hotel_id = $1 AND b.check_in = d::date AND b.status <> 'cancelled'
           GROUP BY d ORDER BY d`, [id]),
  ]);
  const total = rooms.rows[0].n;
  const occ = occupied.rows[0].n;
  res.json({
    total_rooms: total,
    occupied_rooms: occ,
    occupancy_percent: total ? Math.round((occ / total) * 100) : 0,
    revenue_paid: revenue.rows[0].paid,
    revenue_unpaid: revenue.rows[0].unpaid,
    bookings_by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n])),
    arrivals_next_7_days: arrivals.rows,
  });
}));

// Chain-wide overview for the super admin
router.get('/reports/overview', requireRole('super_admin'), wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT h.id, h.name, h.city,
       (SELECT count(*)::int FROM rooms r WHERE r.hotel_id = h.id AND r.status = 'available') AS rooms,
       (SELECT count(DISTINCT b.room_id)::int FROM bookings b WHERE b.hotel_id = h.id AND b.status = 'checked_in') AS occupied,
       (SELECT COALESCE(sum(i.total),0)::float FROM invoices i WHERE i.hotel_id = h.id AND i.status = 'paid') AS revenue
     FROM hotels h WHERE h.active ORDER BY h.name`);
  res.json(rows);
}));

module.exports = router;
