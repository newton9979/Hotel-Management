CREATE TABLE IF NOT EXISTS hotels (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  city          TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  tax_percent   NUMERIC(5,2) NOT NULL DEFAULT 12,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER REFERENCES hotels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('super_admin','manager','receptionist')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS room_types (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  capacity      INTEGER NOT NULL DEFAULT 2,
  price_per_night NUMERIC(10,2) NOT NULL,
  UNIQUE (hotel_id, name)
);

CREATE TABLE IF NOT EXISTS rooms (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id  INTEGER NOT NULL REFERENCES room_types(id),
  room_number   TEXT NOT NULL,
  floor         INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance')),
  UNIQUE (hotel_id, room_number)
);

CREATE TABLE IF NOT EXISTS guests (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  id_proof      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_id       INTEGER NOT NULL REFERENCES rooms(id),
  guest_id      INTEGER NOT NULL REFERENCES guests(id),
  check_in      DATE NOT NULL,
  check_out     DATE NOT NULL,
  adults        INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'reserved'
                CHECK (status IN ('reserved','checked_in','checked_out','cancelled')),
  total_amount  NUMERIC(12,2) NOT NULL,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);

CREATE TABLE IF NOT EXISTS invoices (
  id            SERIAL PRIMARY KEY,
  hotel_id      INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  subtotal      NUMERIC(12,2) NOT NULL,
  tax_amount    NUMERIC(12,2) NOT NULL,
  total         NUMERIC(12,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  payment_method TEXT,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_hotel        ON users(hotel_id);
CREATE INDEX IF NOT EXISTS idx_rooms_hotel        ON rooms(hotel_id);
CREATE INDEX IF NOT EXISTS idx_guests_hotel       ON guests(hotel_id);
CREATE INDEX IF NOT EXISTS idx_bookings_hotel     ON bookings(hotel_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON bookings(room_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_invoices_hotel     ON invoices(hotel_id, status);
