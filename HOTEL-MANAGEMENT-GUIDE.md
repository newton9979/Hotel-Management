# Multi-Hotel Management System: Complete Guide

One guide for everything: what the project is, how to run it, how to set up the AWS database and servers, how to load test it, and how to fix common problems. Keep it for future reference.

Last updated: 20 October 2026

---

## Contents

1. [What the project is](#1-what-the-project-is)
2. [Technology used](#2-technology-used)
3. [Login details for the portal](#3-login-details-for-the-portal)
4. [Project folder layout](#4-project-folder-layout)
5. [Run it on your computer](#5-run-it-on-your-computer)
6. [Run it with Docker](#6-run-it-with-docker)
7. [Create the RDS PostgreSQL database (manual)](#7-create-the-rds-postgresql-database-manual)
8. [Connect to the database](#8-connect-to-the-database)
9. [Connect the app to the database (.env)](#9-connect-the-app-to-the-database-env)
10. [Deploy on one EC2 server](#10-deploy-on-one-ec2-server)
11. [Deploy on EC2 with a Load Balancer](#11-deploy-on-ec2-with-a-load-balancer)
12. [HTTPS and a domain name](#12-https-and-a-domain-name)
13. [Load testing with 100 users](#13-load-testing-with-100-users)
14. [Passwords and security](#14-passwords-and-security)
15. [Troubleshooting](#15-troubleshooting)
16. [Costs and cleanup](#16-costs-and-cleanup)
17. [What was tested and what was not](#17-what-was-tested-and-what-was-not)
18. [Quick command cheat sheet](#18-quick-command-cheat-sheet)

---

## 1. What the project is

A web application that manages **several hotels from one system**. Each hotel's data is separate, and staff can only see their own hotel. The owner (super admin) can see all hotels.

**Features**

| Area | What it does |
|---|---|
| Hotels | Many hotels in one system, each with its own tax rate, rooms, guests and staff |
| Roles | `super_admin` (all hotels), `manager` (own hotel, staff, reports), `receptionist` (bookings, guests, rooms, invoices) |
| Rooms | Room types with prices, rooms by floor, maintenance switch, live "occupied" status |
| Bookings | Search free rooms by date, create bookings, check in, check out, cancel |
| Double-booking protection | The database row is locked while booking, so two people cannot book the same room for overlapping dates |
| Billing | An invoice is created automatically at check-out (hotel tax added). Mark it paid by cash, card or UPI |
| Reports | Occupancy, revenue collected, revenue waiting, arrivals for the next 7 days, and a table comparing all hotels for the super admin |

**How the pieces fit together**

```
Browser -> Nginx (serves the React site, forwards /api) -> Node.js API (PM2 cluster) -> PostgreSQL (AWS RDS)
```

With a load balancer:

```
Internet -> Application Load Balancer -> EC2 server 1 (zone A) --+
                                      -> EC2 server 2 (zone B) --+-> RDS PostgreSQL (private)
```

---

## 2. Technology used

| Layer | Technology | Used for |
|---|---|---|
| Frontend | React 18 and Vite | The screens |
| Backend | Node.js 20 and Express | The API and business logic |
| Database | PostgreSQL | Hotels, rooms, guests, bookings, invoices, users |
| Security | JWT tokens, bcrypt, Helmet, CORS, rate limiting | Login tokens, hashed passwords, safe headers, limit on login attempts |
| Web server | Nginx | Serves the website and forwards `/api` to Node |
| Process manager | PM2 (cluster mode) | One Node worker per CPU, restarts on crash |
| Cloud | AWS EC2, RDS, Application Load Balancer, Elastic IP, security groups | Servers, database, traffic distribution, fixed address, firewall |
| Automation | Bash scripts with the AWS CLI | Create AWS resources and deploy |
| Containers | Docker and Docker Compose | Run everything with one command |
| Testing | Node.js load script and k6 | Simulate 100 users |

---

## 3. Login details for the portal

These demo accounts are created by `npm run setup`. **Every one uses the password `Hotel@12345`.**

| Role | Email | Hotel |
|---|---|---|
| Super admin | `admin@hotels.test` | All hotels |
| Manager | `manager1@hotels.test` | Grand Palace Hyderabad |
| Manager | `manager2@hotels.test` | Sea Breeze Visakhapatnam |
| Manager | `manager3@hotels.test` | Hill View Resort Ooty |
| Receptionist | `reception1@hotels.test` | Grand Palace Hyderabad |
| Receptionist | `reception2@hotels.test` | Sea Breeze Visakhapatnam |
| Receptionist | `reception3@hotels.test` | Hill View Resort Ooty |

Also created for load testing: `loadtest001@hotels.test` to `loadtest100@hotels.test` (receptionists, same password, spread over the three hotels).

Demo data: 3 hotels, 30 rooms each (Standard, Deluxe, Suite), 10 sample guests and 5 sample bookings per hotel.

> **The portal password is not the database password.** The database password is the master password you set in RDS. Only the server's `.env` file uses it.

See [section 14](#14-passwords-and-security) before real use.

---

## 4. Project folder layout

```
hotel-management/
  README.md
  docker-compose.yml          Run everything with Docker
  backend/                    Express API
    src/index.js              Starts the server
    src/routes.js             All API routes
    src/auth.js               Login tokens, roles, hotel separation
    src/db.js                 Database connection (reads DATABASE_URL)
    src/schema.sql            Database tables
    src/migrate.js            Creates the tables
    src/seed.js               Demo data and demo accounts
    ecosystem.config.js       PM2 settings
    .env.example              Template for the settings file
    Dockerfile, docker-entrypoint.sh
  frontend/                   React app
    src/App.jsx               All screens
    src/api.js                Talks to the API
    Dockerfile, nginx.docker.conf
  loadtest/
    node-load.js              Load test, no install needed
    k6-100-users.js           Load test for k6
  deploy/
    aws-provision.sh          Single server: create AWS resources
    deploy.sh                 Single server: build, upload, start
    aws-teardown.sh           Single server: delete everything
    aws-provision-alb.sh      Load balanced: create AWS resources
    deploy-alb.sh             Load balanced: deploy to each server
    aws-teardown-alb.sh       Load balanced: delete everything
    setup-ec2.sh              Runs on the server during deploy
    nginx.conf                Nginx for a single server
    nginx-alb.conf            Nginx behind a load balancer
```

---

## 5. Run it on your computer

Needs Node.js 18 or newer and PostgreSQL.

```bash
# 1. Database
createdb hotels

# 2. Backend
cd backend
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET
npm install
npm run setup               # creates tables and demo data
npm start                   # API on port 4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # open http://localhost:5173
```

Local `.env` example:

```
PORT=4000
NODE_ENV=development
JWT_SECRET=any-long-random-text
DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/hotels
DB_SSL=false
DB_POOL_MAX=20
BCRYPT_ROUNDS=10
CORS_ORIGIN=*
```

Check that the API works: `curl http://localhost:4000/api/health` should show `{"status":"ok", ...}`.

---

## 6. Run it with Docker

Needs Docker Desktop (or Docker Engine with Compose).

```bash
docker compose up --build       # starts database, API and website
# open http://localhost:8080    (admin@hotels.test / Hotel@12345)
docker compose down             # stop (add -v to also delete database data)
```

Optional settings (environment variables or a `.env` file next to `docker-compose.yml`): `DB_PASSWORD`, `JWT_SECRET`, `WEB_PORT`, `RUN_SEED=false`.

> **Status:** the Docker files have not been built or run yet, because image downloads were blocked where the project was made. Expect to possibly fix small issues on the first run.

To use RDS instead of the Docker database, change `DATABASE_URL` for the `api` service and remove the `db` service.

---

## 7. Create the RDS PostgreSQL database (manual)

Work in the **same AWS region as your servers**.

1. Sign in to the AWS console. Check the region at the top right. Open **RDS**, then **Databases**, then **Create database**.
2. Choose **Standard create**, engine **PostgreSQL**, and template **Free tier** (if offered) or **Dev/Test**. Keep **Single-AZ** for testing.
3. **Settings:**
   - **DB instance identifier:** `hotel-db` (just the label in the AWS list)
   - **Master username:** `hotel_admin`
   - **Credentials management:** Self managed, then type a strong password. Avoid `@ # / :` and spaces. Save it in a password manager, because AWS cannot show it again.
4. **Instance class:** `db.t3.micro`.
5. **Storage:** General Purpose SSD (gp3), 20 GiB.
6. **Connectivity:**
   - Don't connect to an EC2 compute resource
   - Default VPC
   - **Public access: No**
   - New VPC security group named `hotel-db-sg`
7. **Additional configuration:** in **Initial database name** type `hotels`. If you leave this blank, no database is created and the app cannot connect.
8. Click **Create database**. Wait 5 to 10 minutes until the status is **Available**.
9. Open the database and copy the **Endpoint** from the **Connectivity and security** tab. It looks like `hotel-db.xxxx.<region>.rds.amazonaws.com`.

**Allow the web server to reach the database:**

1. Go to **EC2**, then **Security Groups**, and open `hotel-db-sg`.
2. **Edit inbound rules**, then **Add rule:** type **PostgreSQL**, port **5432**, source **your web server's security group** (never "Anywhere").
3. Save the rules.

**My setup details** (fill in or update; do not store the password here):

| Item | Value |
|---|---|
| Region | `ap-southeast-2` (Sydney) |
| Identifier | `hotel-db` |
| Endpoint | `hotel-db.cjqc4ii4acwd.ap-southeast-2.rds.amazonaws.com` |
| Port | `5432` |
| Master username | `hotel_admin` |
| Master password | (in your password manager) |
| Database name | `hotels` |

---

## 8. Connect to the database

The database is not public, so connect from the EC2 server or through an SSH tunnel.

### 8.1 From the EC2 server

```bash
sudo apt install -y postgresql-client
psql "host=<ENDPOINT> port=5432 dbname=hotels user=hotel_admin sslmode=require"
```

Stricter option, which checks the server's certificate using the AWS bundle:

```bash
curl -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
export RDSHOST="<ENDPOINT>"
psql "host=$RDSHOST port=5432 dbname=postgres user=hotel_admin sslmode=verify-full sslrootcert=./global-bundle.pem"
```

Useful commands inside `psql`:

| Command | What it does |
|---|---|
| `\l` | List databases |
| `\dt` | List tables |
| `SELECT * FROM hotels;` | Show the hotels |
| `CREATE DATABASE hotels;` | Create the database if it is missing (connect to `postgres` first) |
| `\q` | Quit |

### 8.2 From your laptop with pgAdmin or DBeaver (SSH tunnel)

Run this in a terminal and leave it open:

```bash
ssh -i /path/to/your-key.pem -N -L 5433:<ENDPOINT>:5432 ubuntu@<EC2 public IP>
```

Then create a connection with host `localhost`, port `5433`, database `hotels`, username `hotel_admin`, your password, and SSL mode `require`. Do not use `verify-full` through a tunnel, because the hostname will not match.

---

## 9. Connect the app to the database (.env)

The only file to change is **`backend/.env`**. The code reads it automatically.

```
PORT=4000
NODE_ENV=production
JWT_SECRET=<long random text, e.g. from: openssl rand -hex 32>
JWT_EXPIRES=12h
DATABASE_URL=postgres://hotel_admin:<PASSWORD>@<ENDPOINT>:5432/hotels
DB_SSL=true
DB_POOL_MAX=15
BCRYPT_ROUNDS=10
CORS_ORIGIN=*
```

Notes:

- If the password has special characters, URL-encode them or choose a simpler password.
- `DB_SSL=true` makes the connection encrypted. The app does not verify the certificate (it can be changed to use `global-bundle.pem` if needed).
- Create the tables and demo data, then start:
  ```bash
  cd backend
  npm run setup
  npm start
  ```
  You should see "Schema ready" and "Seed complete".
- If you deploy with `./deploy/deploy.sh`, it writes `/opt/hotel-app/backend/.env` on the server for you from `deploy/.deploy-env`.
- To change it directly on the server:
  ```bash
  sudo nano /opt/hotel-app/backend/.env
  pm2 restart hotel-api --update-env
  ```
- Never share or upload `.env`.

---

## 10. Deploy on one EC2 server

### 10.1 Option A: everything automatic (creates database and server)

Needs the AWS CLI configured (`aws configure`) and an EC2 key pair.

```bash
export KEY_NAME=my-keypair
export KEY_PATH=~/.ssh/my-keypair.pem
export AWS_REGION=ap-southeast-2        # use the region you want

./deploy/aws-provision.sh               # security groups, RDS, EC2, Elastic IP (about 10 minutes)
./deploy/deploy.sh                      # build, upload, install, create tables, start
```

Defaults: `t3.small` server, `db.t3.micro` database. Change them with `INSTANCE_TYPE` and `DB_CLASS`.
Open `http://<server IP>` when it finishes.

### 10.2 Option B: you create the database and server by hand, the script deploys

1. **Create the database** as in [section 7](#7-create-the-rds-postgresql-database-manual).
2. **Launch the EC2 server** (EC2, **Launch instance**):
   - Name `hotel-web`, image **Ubuntu Server 22.04 LTS**, type `t3.small`
   - Key pair: create or choose one and keep the `.pem` file
   - Same region and same VPC as the database, with **Auto-assign public IP** on
   - Security group `hotel-web-sg`: SSH (22) from **My IP**, HTTP (80) and HTTPS (443) from **Anywhere**
   - Storage 20 GiB gp3
3. **Let the server reach the database:** add an inbound rule to `hotel-db-sg` for port 5432 with source `hotel-web-sg`.
4. **Optional, recommended:** allocate an Elastic IP (EC2, **Elastic IPs**) and associate it with `hotel-web`, so the address stays the same.
5. **Create `deploy/.deploy-env`** on your computer:
   ```bash
   REGION=ap-southeast-2
   KEY_PATH=/full/path/to/your-key.pem
   EC2_IP=<server public IP>
   DB_HOST=<ENDPOINT>
   DB_PASSWORD=<your master password>
   JWT_SECRET=<run: openssl rand -hex 32>
   ```
6. **Deploy:**
   ```bash
   chmod 400 /full/path/to/your-key.pem
   ./deploy/deploy.sh
   ```
   Your computer needs `node`, `npm`, `ssh` and `scp`. On Windows use WSL or Git Bash.
7. Open `http://<server IP>` and log in.

### 10.3 What the deploy does on the server

Installs Nginx, Node.js 20 and PM2, unpacks the app in `/opt/hotel-app`, writes `.env`, runs `npm ci`, creates the tables, loads demo data (skipped if data exists), starts the API with PM2 (one worker per CPU) and sets up Nginx to serve the site and forward `/api`.

Deploy again for every new version with `./deploy/deploy.sh`. Use `RUN_SEED=false ./deploy/deploy.sh` to skip demo data.

---

## 11. Deploy on EC2 with a Load Balancer

Two or more servers in different availability zones sit behind an Application Load Balancer. The load balancer checks `/api/health` every 15 seconds and only sends visitors to healthy servers, so one server can fail or be updated without the site going down. The API keeps no state on the server (logins use tokens, all data is in the database), so any server can handle any request.

```bash
export KEY_NAME=my-keypair
export KEY_PATH=~/.ssh/my-keypair.pem
export AWS_REGION=ap-southeast-2

./deploy/aws-provision-alb.sh     # 2 servers + load balancer + RDS (about 10 minutes)
./deploy/deploy-alb.sh            # deploys to each server one at a time
node loadtest/node-load.js http://<load-balancer-dns> 100 120
./deploy/aws-teardown-alb.sh      # delete everything when finished
```

Options: `INSTANCE_COUNT=3` for more servers, `INSTANCE_TYPE`, `DB_CLASS`, `CERT_ARN` (HTTPS).

How it is set up:

- **Security groups:** the load balancer accepts ports 80 and 443 from anywhere. The web servers accept port 80 only from the load balancer, and SSH only from your IP. The database accepts port 5432 only from the web servers.
- **Deploying:** one server at a time, waiting until the load balancer sees it as healthy, so the site stays available during a release. Only the first server creates tables and demo data.
- **Visitor IP:** `nginx-alb.conf` restores each visitor's real IP, so the login rate limit works per visitor.
- **Database connections:** servers x CPU cores x `DB_POOL_MAX` (10) must stay below the database limit (about 100 on `db.t3.micro`).
- The load balancer address can take a minute or two to start working after it is created.

If you made the database by hand and only want a load balancer in front of servers you created, the scripts above create their own database. Either use them as they are, or adapt `aws-provision-alb.sh` by removing the RDS section and setting `DB_HOST` and `DB_PASSWORD` in `deploy/.deploy-alb-env` yourself.

---

## 12. HTTPS and a domain name

Without HTTPS, passwords travel unencrypted. Add it before real use.

**With a load balancer (recommended):**

1. Request a certificate for your domain in **AWS Certificate Manager** (same region as the load balancer) and validate it with DNS.
2. Provision with the certificate: `CERT_ARN=<certificate arn> ./deploy/aws-provision-alb.sh`. This adds port 443 and redirects HTTP to HTTPS.
3. Point your domain (CNAME, or alias in Route 53) to the load balancer's DNS name.

**Single server:**

1. Point your domain's DNS A record to the Elastic IP.
2. On the server: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`.

Then set `CORS_ORIGIN` in `backend/.env` to your domain instead of `*`.

---

## 13. Load testing with 100 users

The test simulates 100 receptionists at the same time. Each logs in, then repeats: list rooms, bookings, guests and invoices, search free rooms, and sometimes create a booking.

```bash
# No install needed (Node 18+). Arguments: server URL, users, seconds
node loadtest/node-load.js http://localhost:4000 100 60

# Against AWS (run from your own computer, not the server)
node loadtest/node-load.js http://<server-or-load-balancer> 100 120

# With k6: ramps to 100 users, holds 3 minutes, checks p95 < 800 ms and < 1% errors
k6 run -e BASE_URL=http://<server-or-load-balancer> loadtest/k6-100-users.js
```

**Reading the results**

| Metric | Meaning | Target |
|---|---|---|
| p95 | 95 out of 100 requests were faster than this | Under 800 ms |
| Failures | 5xx errors and timeouts (a 409 "room already booked" is a correct answer, not a failure) | Under 1% |
| req/s | Requests handled per second | Higher is better |
| Last line | PASS or FAIL | PASS |

**Easy changes to the script**

| I want to... | Change this |
|---|---|
| More or fewer users | The second argument, e.g. `... 300 60` |
| Run longer | The third argument, in seconds |
| Heavier load | Lower the `sleep(rnd(1000, 2000))` values in `user()` |
| More bookings | Raise `Math.random() < 0.34` to `0.8` |
| Stricter limits | `errRate < 1 && p95 < 800` near the end |
| Different password | `PASSWORD=yourpass node loadtest/node-load.js ...` |

Other tests: a stress test with more users (e.g. 300) and an endurance test with a long duration (e.g. 600 seconds).

**Result from the development sandbox** (API and database on one small machine, no Nginx): 7,095 requests in 45 seconds, 0 failures, overall p95 52 ms, login p95 379 ms. Your AWS numbers will differ.

Notes:

- The test uses the `loadtest001` to `loadtest100` accounts, so keep the demo data.
- Each run creates real bookings. Reset the demo data afterwards if you keep the server.
- Only test servers you own.
- An earlier run showed slow logins (about 5 seconds), caused by a pure JavaScript password library blocking the server. Switching to native `bcrypt` fixed it.

---

## 14. Passwords and security

Three different passwords exist:

| Password | Where it is used | Default |
|---|---|---|
| Portal login | Typed on the app's login page | `Hotel@12345` (demo accounts) |
| Database master password | `DATABASE_URL` in the server's `.env` only | The one you chose in RDS |
| `JWT_SECRET` | Signs login tokens, in `.env` | You generate it |

**Change a portal password** (there is no change-password screen yet). On the server, in the `backend` folder, make a hash:

```bash
node -e "require('bcrypt').hash('YourNewPassword',10).then(console.log)"
```

Then in `psql`:

```sql
UPDATE users SET password_hash = '<paste the hash>' WHERE email = 'admin@hotels.test';
```

Other options: set `SEED_PASSWORD=YourNewPass` before `npm run seed` on an empty database, or log in as admin or a manager and add real staff on the **Staff** page.

**Change the database master password:** RDS, then your database, then **Modify**, then a new master password, then update `.env` and restart the app.

**Checklist before real use**

- [ ] Change or delete all demo accounts and the `loadtest*` accounts
- [ ] Use a strong `JWT_SECRET`
- [ ] Rotate any password that was pasted into a chat or email
- [ ] Turn on HTTPS ([section 12](#12-https-and-a-domain-name))
- [ ] Set `CORS_ORIGIN` to your domain
- [ ] Keep database access limited to the web servers' security group
- [ ] Keep SSH limited to your IP
- [ ] Use `RUN_SEED=false` for real deployments
- [ ] Consider RDS Multi-AZ and CloudWatch alarms for production
- [ ] Never commit `.env`, `.deploy-env`, `.deploy-alb-env` or `.pem` files

---

## 15. Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Login says "Invalid credentials" | Typo (password is case-sensitive), or the seed has not run: `cd backend && npm run setup` |
| Login page loads but login errors | The API cannot reach the database. Check `.env`, then `pm2 logs hotel-api` |
| `Connection timed out` to the database | `hotel-db-sg` has no inbound rule for port 5432 from the web server's security group, or they are in different VPCs |
| `database "hotels" does not exist` | The initial database name was blank. Connect to `postgres` and run `CREATE DATABASE hotels;` |
| `password authentication failed` | Retype the password, with no trailing space. Check special characters in `DATABASE_URL` |
| SSL or certificate errors | Use `DB_SSL=true`. For `verify-full`, re-download `global-bundle.pem` |
| `Too many connections` | Lower `DB_POOL_MAX`, or fewer servers and workers |
| SSH timeout | Your IP is not in the SSH rule (it changes), or the key path is wrong |
| Site does not load | Port 80 not open in the web security group, or Nginx is down: `sudo systemctl status nginx` |
| Load balancer shows unhealthy targets | The app is not running, or `/api/health` fails: `curl http://127.0.0.1/api/health` on the server |
| `No default VPC` when provisioning | Use a region that has one, or create one in the VPC console |
| Quota or permission errors | New AWS account limits, or the IAM user lacks permissions |
| Health check shows `{"status":"ok"}` but login fails | The seed has not run, so no users exist |
| Dates look one day off | Fixed in this version (dates are returned as plain `YYYY-MM-DD` text) |

Useful server commands:

```bash
pm2 status                                 # is the API running
pm2 logs hotel-api                         # API logs
pm2 restart hotel-api --update-env         # restart after changing .env
sudo systemctl status nginx                # Nginx status
sudo nginx -t                              # test Nginx config
curl http://127.0.0.1/api/health           # health check through Nginx
curl http://127.0.0.1:4000/api/health      # health check directly on the API
```

---

## 16. Costs and cleanup

These resources charge by the hour while they exist, even when nobody uses the app:

- EC2 servers
- The RDS database (and its storage and backups)
- The Application Load Balancer
- Elastic IPs that are not attached to a running server

Check the AWS pricing pages for exact figures. A load balanced setup costs roughly double a single server setup. Set a **budget alert** in AWS Billing so you are not surprised.

**Delete everything when you finish testing:**

```bash
./deploy/aws-teardown.sh          # single server setup (asks you to type 'delete')
./deploy/aws-teardown-alb.sh      # load balanced setup (asks you to type 'delete')
```

These delete the database and all its data with no final snapshot. Take a manual snapshot first if you want to keep it (RDS, your database, **Actions**, **Take snapshot**).

For resources you created by hand, delete them in this order: load balancer, target group, EC2 instances, RDS database, Elastic IP (release), then the security groups.

**Upgrading PostgreSQL:** take a manual snapshot first. A minor upgrade (e.g. 16.3 to 16.4) is done with **Modify**, then a newer engine version, applied in the maintenance window, with a short restart. A major upgrade (e.g. 15 to 16) needs longer downtime, so test it on a copy restored from the snapshot first.

---

## 17. What was tested and what was not

**Tested:**

- Database tables and demo data
- Every API flow: login, roles, hotel separation, booking, check-in, check-out, invoices, payment, reports
- Double-booking race: 10 simultaneous requests for one room gave exactly one success
- Two API servers sharing one database: login tokens work on both, and 20 simultaneous bookings of one room split across both gave exactly one success
- The frontend production build
- The 100-user load test (sandbox numbers in section 13)

**Not tested** (no AWS account, Nginx or image downloads in the build environment):

- The AWS scripts (single server and load balancer) were syntax-checked only
- The Nginx configs were not run
- The Docker setup was not built

Expect to possibly fix small issues on the first real deployment, such as AWS quotas, a region without a default VPC, or a Docker image detail.

**Possible improvements:** a change-password screen, deactivating demo accounts, certificate verification for the database connection, HTTPS by default, online booking for guests, and email or SMS confirmations.

---

## 18. Quick command cheat sheet

```bash
# Run locally
cd backend && npm install && npm run setup && npm start
cd frontend && npm install && npm run dev

# Docker
docker compose up --build
docker compose down

# Database (on the EC2 server)
psql "host=<ENDPOINT> port=5432 dbname=hotels user=hotel_admin sslmode=require"

# Deploy, single server
./deploy/aws-provision.sh && ./deploy/deploy.sh
./deploy/aws-teardown.sh

# Deploy, load balancer
./deploy/aws-provision-alb.sh && ./deploy/deploy-alb.sh
./deploy/aws-teardown-alb.sh

# Load test
node loadtest/node-load.js http://<address> 100 120

# On the server
pm2 status
pm2 logs hotel-api
pm2 restart hotel-api --update-env
curl http://127.0.0.1/api/health
```
