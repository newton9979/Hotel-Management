# Multi-Hotel Management System

One platform that manages several hotels. Each hotel's data is isolated; staff only see their own property.

**Stack:** Node.js (Express) · React (Vite) · PostgreSQL · Nginx + PM2 on AWS EC2 · AWS RDS

## Features

| Area | What it does |
|---|---|
| Hotels | Many properties on one system, each with its own tax rate, rooms, guests, staff |
| Roles | `super_admin` (all hotels), `manager` (own hotel + staff + reports), `receptionist` (bookings, guests, billing) |
| Rooms | Room types with pricing, rooms by floor, maintenance toggle, live occupied status |
| Bookings | Availability search, booking with **double-booking protection** (row lock), check-in, check-out, cancel |
| Billing | Invoice auto-created at check-out (hotel tax applied), mark paid by cash / card / UPI |
| Reports | Occupancy, revenue collected / pending, 7-day arrivals; chain-wide overview for super admin |

## Demo logins (password `Hotel@12345`)

`admin@hotels.test` (all hotels) · `manager1@hotels.test` · `reception1@hotels.test` (hotels 1-3 each have a manager and receptionist).
The seed also creates `loadtest001` … `loadtest100@hotels.test` for the 100-user test.
**Change or delete all of these before real use.**

## Run locally

Needs Node 18+ and PostgreSQL.

```bash
# 1. database
createdb hotels            # or any DB; adjust DATABASE_URL below

# 2. backend
cd backend
cp .env.example .env       # edit DATABASE_URL and JWT_SECRET
npm install
npm run setup              # creates tables + demo data
npm start                  # API on :4000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                # http://localhost:5173 (proxies /api to :4000)
```

## Run with Docker (one command)

Needs Docker Desktop (or Docker Engine + Compose).

```bash
docker compose up --build        # starts PostgreSQL, the API and the website
# open http://localhost:8080     (admin@hotels.test / Hotel@12345)
node loadtest/node-load.js http://localhost:8080 100 60
docker compose down              # stop (add -v to also delete the database data)
```

Optional settings via environment variables or a `.env` file next to `docker-compose.yml`: `DB_PASSWORD`, `JWT_SECRET`, `WEB_PORT`, `RUN_SEED=false` (skip demo data).
The API container creates the tables on start. Change `JWT_SECRET` and `DB_PASSWORD` before using it anywhere public.

## 100-user load test

Simulates 100 concurrent staff, each logging in and repeating: list rooms / bookings / guests / invoices, search availability, create bookings.

```bash
# No install needed (Node 18+)
node loadtest/node-load.js http://localhost:4000 100 60      # url, users, seconds

# Or with k6 (https://k6.io): ramps to 100 users, holds 3 min, checks p95 < 800 ms and < 1% errors
k6 run -e BASE_URL=http://<your-server> loadtest/k6-100-users.js
```

Pass criteria: under 1% unexpected failures and overall p95 under 800 ms. A "409 room already booked" counts as a correct outcome, not an error.

**Result on the dev sandbox (API + PostgreSQL on one small machine, no nginx):** 7,095 requests in 45 s, 0 failures, overall p95 52 ms, login p95 379 ms. Re-run it against your EC2 server for real numbers; network latency and the instance size will change them.

## Deploy to AWS (EC2 + RDS)

Architecture: browser → **Nginx** (serves React build, proxies `/api`) → **Node API under PM2 cluster** (one worker per CPU) → **RDS PostgreSQL** (private, reachable only from the web server's security group).

Prerequisites: AWS CLI v2 configured (`aws configure`), an EC2 key pair, `node`, `npm`, `ssh`, `scp`, `openssl` on your machine.

```bash
export KEY_NAME=my-keypair                  # name of the key pair in AWS
export KEY_PATH=~/.ssh/my-keypair.pem       # the .pem file
export AWS_REGION=ap-south-1                # optional, default Mumbai

./deploy/aws-provision.sh   # security groups, RDS, EC2 + Elastic IP (~10 min, mostly RDS)
./deploy/deploy.sh          # build, upload, install, migrate, seed, start (re-run for each release)
```

Then open `http://<EC2 IP>` and run the load test against it.
Defaults: `t3.small` server, `db.t3.micro` database (change with `INSTANCE_TYPE` / `DB_CLASS`).
**These cost money while running.** When finished testing: `./deploy/aws-teardown.sh` (deletes everything, including the database).

### Before real production use

- Add a domain and HTTPS: point DNS at the Elastic IP, then `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`. Without it, passwords travel unencrypted.
- Redeploy with `RUN_SEED=false ./deploy/deploy.sh` for real data, and remove the demo and `loadtest*` accounts.
- Set `CORS_ORIGIN` in `backend/.env` on the server to your domain instead of `*`.
- Consider RDS Multi-AZ, CloudWatch alarms, and restricting SSH (port 22) to your IP only (the provision script already does this for your current IP).

## Project layout

```
backend/    Express API (src/routes.js, schema.sql, seed.js), PM2 config
frontend/   React app (src/App.jsx), Vite config
loadtest/   node-load.js (zero install) and k6-100-users.js
deploy/     aws-provision.sh, deploy.sh, setup-ec2.sh, nginx.conf, aws-teardown.sh
```

## What was and wasn't verified

Tested here: database schema and seed, every API flow (login, roles, tenant isolation, booking, check-in/out, invoices, payment, reports), a 10-way concurrent double-booking race (exactly one succeeds), frontend production build, 100-user load test.
**Not run:** the Docker setup (Dockerfiles, `docker-compose.yml`) could not be built where this project was made, because image downloads were blocked. The compose file validates, but expect to possibly fix small issues on your first `docker compose up --build`.
**Also not run:** the AWS scripts and Nginx config were syntax-checked only, since there is no AWS account or Nginx in the build environment. Expect to possibly fix small issues on the first real deploy (for example AWS quotas or a region without a default VPC).
