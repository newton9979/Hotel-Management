// Zero-install load test (Node 18+): simulates N concurrent hotel staff users.
// Usage: node loadtest/node-load.js [baseUrl] [users=100] [durationSec=60]
// Example: node loadtest/node-load.js http://<ec2-ip> 100 120
const BASE = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const USERS = parseInt(process.argv[3] || '100', 10);
const DURATION_MS = parseInt(process.argv[4] || '60', 10) * 1000;
const PASSWORD = process.env.PASSWORD || 'Hotel@12345';

const stats = {}; // name -> { times: [], ok: 0, fail: 0, codes: {} }
let unexpected = 0;
let total = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const iso = (d) => d.toISOString().slice(0, 10);

async function call(name, path, { method = 'GET', body, token, okCodes = [200, 201] } = {}) {
  const t0 = performance.now();
  let status = 0;
  let data = null;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch {
    status = 0; // network error / timeout
  }
  const ms = performance.now() - t0;
  const s = (stats[name] ||= { times: [], ok: 0, fail: 0, codes: {} });
  s.times.push(ms);
  s.codes[status] = (s.codes[status] || 0) + 1;
  total++;
  if (okCodes.includes(status)) s.ok++; else { s.fail++; unexpected++; }
  return { status, data };
}

async function user(i, endAt) {
  const email = `loadtest${String(((i - 1) % 100) + 1).padStart(3, '0')}@hotels.test`;
  await sleep(rnd(0, 5000)); // stagger ramp-up
  const login = await call('POST /auth/login', '/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } });
  if (login.status !== 200) return;
  const token = login.data.token;

  while (performance.now() < endAt) {
    await Promise.all([
      call('GET /rooms', '/api/rooms', { token }),
      call('GET /bookings', '/api/bookings', { token }),
      call('GET /guests', '/api/guests', { token }),
      call('GET /invoices', '/api/invoices', { token }),
    ]);
    await sleep(rnd(1000, 2000));

    const start = new Date(Date.now() + Math.floor(rnd(30, 330)) * 86400000);
    const end = new Date(start.getTime() + Math.floor(rnd(1, 5)) * 86400000);
    const av = await call('GET /rooms/available', `/api/rooms/available?check_in=${iso(start)}&check_out=${iso(end)}`, { token });

    if (av.status === 200 && av.data.length && Math.random() < 0.34) {
      const g = await call('GET /guests', '/api/guests', { token });
      if (g.status === 200 && g.data.length) {
        const room = av.data[Math.floor(Math.random() * av.data.length)];
        // 409 = another user just booked it: expected business outcome, not an error
        await call('POST /bookings', '/api/bookings', {
          method: 'POST', token, okCodes: [201, 409],
          body: { room_id: room.id, guest_id: g.data[0].id, check_in: iso(start), check_out: iso(end) },
        });
      }
    }
    await sleep(rnd(1000, 3000));
  }
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

(async () => {
  console.log(`Load test: ${USERS} concurrent users -> ${BASE} for ${DURATION_MS / 1000}s`);
  const t0 = performance.now();
  const endAt = t0 + DURATION_MS;
  await Promise.all(Array.from({ length: USERS }, (_, i) => user(i + 1, endAt)));
  const secs = (performance.now() - t0) / 1000;

  console.log('\nEndpoint                  reqs   p50ms   p95ms   p99ms   fail  status codes');
  let all = [];
  for (const [name, s] of Object.entries(stats).sort()) {
    all = all.concat(s.times);
    console.log(
      name.padEnd(24), String(s.times.length).padStart(6),
      pct(s.times, 50).toFixed(0).padStart(7), pct(s.times, 95).toFixed(0).padStart(7),
      pct(s.times, 99).toFixed(0).padStart(7), String(s.fail).padStart(6), ' ', JSON.stringify(s.codes)
    );
  }
  const errRate = total ? (unexpected / total) * 100 : 100;
  const p95 = pct(all, 95);
  console.log(`\nTotal requests: ${total}  (${(total / secs).toFixed(1)} req/s)`);
  console.log(`Overall p95: ${p95.toFixed(0)} ms | unexpected failures: ${unexpected} (${errRate.toFixed(2)}%)`);
  const pass = errRate < 1 && p95 < 800;
  console.log(pass ? 'RESULT: PASS (error rate < 1%, p95 < 800 ms)' : 'RESULT: FAIL');
  process.exit(pass ? 0 : 1);
})();
