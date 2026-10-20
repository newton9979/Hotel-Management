#!/bin/sh
# Create tables, optionally load demo data, then start the API.
set -e
node src/migrate.js
if [ "${RUN_SEED:-true}" = "true" ]; then
  node src/seed.js
fi
exec node src/index.js
