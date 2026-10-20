// k6 load test: 100 concurrent hotel staff users.
// Run:  k6 run -e BASE_URL=http://<ec2-ip> loadtest/k6-100-users.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const PASSWORD = __ENV.PASSWORD || 'Hotel@12345';
const bookingLatency = new Trend('booking_create_ms', true);

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // ramp up to 100 users
    { duration: '3m', target: 100 },  // hold 100 concurrent users
    { duration: '20s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],      // <1% failed requests (409 booking conflicts are tagged expected)
    http_req_duration: ['p(95)<800'],    // 95% of requests under 800ms
    checks: ['rate>0.99'],
  },
};

const JSON_H = { 'Content-Type': 'application/json' };
// Treat expected 409 (room already booked) as a non-failure
const expect409 = http.expectedStatuses({ min: 200, max: 299 }, 409);

const pad = (n) => String(n).padStart(3, '0');
const iso = (d) => d.toISOString().slice(0, 10);

export default function () {
  const email = `loadtest${pad(((__VU - 1) % 100) + 1)}@hotels.test`;

  const login = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), { headers: JSON_H });
  if (!check(login, { 'login 200': (r) => r.status === 200 })) { sleep(2); return; }
  const token = login.json('token');
  const auth = { headers: { ...JSON_H, Authorization: `Bearer ${token}` } };

  // One session = a realistic receptionist workflow, repeated a few times
  for (let round = 0; round < 5; round++) {
    check(http.get(`${BASE}/api/rooms`, auth), { 'rooms 200': (r) => r.status === 200 });
    check(http.get(`${BASE}/api/bookings`, auth), { 'bookings 200': (r) => r.status === 200 });
    check(http.get(`${BASE}/api/guests`, auth), { 'guests 200': (r) => r.status === 200 });
    check(http.get(`${BASE}/api/invoices`, auth), { 'invoices 200': (r) => r.status === 200 });
    sleep(1 + Math.random());

    // Search availability for random future dates
    const start = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86400000);
    const end = new Date(start.getTime() + (1 + Math.floor(Math.random() * 4)) * 86400000);
    const av = http.get(`${BASE}/api/rooms/available?check_in=${iso(start)}&check_out=${iso(end)}`, auth);
    check(av, { 'availability 200': (r) => r.status === 200 });

    // Try to book (about 1 in 3 rounds)
    if (av.status === 200 && Math.random() < 0.34) {
      const rooms = av.json();
      const guests = http.get(`${BASE}/api/guests`, auth).json();
      if (rooms.length && guests.length) {
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        const res = http.post(
          `${BASE}/api/bookings`,
          JSON.stringify({ room_id: room.id, guest_id: guests[0].id, check_in: iso(start), check_out: iso(end) }),
          { ...auth, responseCallback: expect409 }
        );
        bookingLatency.add(res.timings.duration);
        check(res, { 'booking 201 or 409': (r) => r.status === 201 || r.status === 409 });
      }
    }
    sleep(1 + Math.random() * 2);
  }
}
