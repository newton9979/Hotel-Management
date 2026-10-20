require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('./db');

const PASSWORD = process.env.SEED_PASSWORD || 'Hotel@12345';

const HOTELS = [
  { name: 'Grand Palace Hyderabad', city: 'Hyderabad', tax: 12 },
  { name: 'Sea Breeze Visakhapatnam', city: 'Visakhapatnam', tax: 12 },
  { name: 'Hill View Resort Ooty', city: 'Ooty', tax: 18 },
];
const TYPES = [
  { name: 'Standard', capacity: 2, price: 2500 },
  { name: 'Deluxe', capacity: 3, price: 4200 },
  { name: 'Suite', capacity: 4, price: 8000 },
];

(async () => {
  const existing = await pool.query('SELECT count(*)::int AS n FROM hotels');
  if (existing.rows[0].n > 0) {
    console.log('Data already present, skipping seed');
    return pool.end();
  }
  const hash = await bcrypt.hash(PASSWORD, parseInt(process.env.BCRYPT_ROUNDS || '10', 10));

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ('Super Admin','admin@hotels.test',$1,'super_admin')`,
    [hash]);

  const hotelIds = [];
  for (let h = 0; h < HOTELS.length; h++) {
    const hotel = HOTELS[h];
    const { rows } = await pool.query(
      `INSERT INTO hotels (name, city, tax_percent) VALUES ($1,$2,$3) RETURNING id`,
      [hotel.name, hotel.city, hotel.tax]);
    const hid = rows[0].id;
    hotelIds.push(hid);

    await pool.query(
      `INSERT INTO users (hotel_id, name, email, password_hash, role) VALUES
       ($1,$2,$3,$4,'manager'), ($1,$5,$6,$4,'receptionist')`,
      [hid, `Manager ${h + 1}`, `manager${h + 1}@hotels.test`, hash, `Reception ${h + 1}`, `reception${h + 1}@hotels.test`]);

    const typeIds = [];
    for (const t of TYPES) {
      const r = await pool.query(
        `INSERT INTO room_types (hotel_id, name, capacity, price_per_night) VALUES ($1,$2,$3,$4) RETURNING id`,
        [hid, t.name, t.capacity, t.price]);
      typeIds.push(r.rows[0].id);
    }
    // 30 rooms per hotel: floors 1-3, 10 rooms each
    for (let f = 1; f <= 3; f++) {
      for (let n = 1; n <= 10; n++) {
        const typeId = typeIds[n <= 5 ? 0 : n <= 9 ? 1 : 2];
        await pool.query(
          `INSERT INTO rooms (hotel_id, room_type_id, room_number, floor) VALUES ($1,$2,$3,$4)`,
          [hid, typeId, `${f}${String(n).padStart(2, '0')}`, f]);
      }
    }
    // sample guests
    for (let g = 1; g <= 10; g++) {
      await pool.query(
        `INSERT INTO guests (hotel_id, full_name, email, phone) VALUES ($1,$2,$3,$4)`,
        [hid, `Guest ${h + 1}-${g}`, `guest${h + 1}_${g}@example.com`, `98${String(10000000 + h * 100 + g)}`]);
    }
    // a few sample bookings starting today
    for (let k = 0; k < 5; k++) {
      const room = await pool.query(
        `SELECT r.id, t.price_per_night FROM rooms r JOIN room_types t ON t.id = r.room_type_id
         WHERE r.hotel_id = $1 ORDER BY r.room_number OFFSET $2 LIMIT 1`, [hid, k]);
      const guest = await pool.query('SELECT id FROM guests WHERE hotel_id = $1 ORDER BY id OFFSET $2 LIMIT 1', [hid, k]);
      const nights = 2 + (k % 3);
      await pool.query(
        `INSERT INTO bookings (hotel_id, room_id, guest_id, check_in, check_out, status, total_amount)
         VALUES ($1,$2,$3,current_date,current_date + $4::int,$5,$6)`,
        [hid, room.rows[0].id, guest.rows[0].id, nights, k < 3 ? 'checked_in' : 'reserved',
         nights * Number(room.rows[0].price_per_night)]);
    }
  }

  // 100 staff accounts for load testing (loadtest001..loadtest100), spread across hotels
  for (let i = 1; i <= 100; i++) {
    const hid = hotelIds[(i - 1) % hotelIds.length];
    await pool.query(
      `INSERT INTO users (hotel_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'receptionist')`,
      [hid, `Load Tester ${i}`, `loadtest${String(i).padStart(3, '0')}@hotels.test`, hash]);
  }

  console.log('Seed complete.');
  console.log(`Logins (password: ${PASSWORD}): admin@hotels.test, manager1@hotels.test, reception1@hotels.test ...`);
  await pool.end();
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
