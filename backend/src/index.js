require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const routes = require('./routes');
const { pool } = require('./db');

const app = express();
app.set('trust proxy', 1); // behind nginx

const origins = (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
app.use(helmet());
app.use(cors({ origin: origins.includes('*') ? true : origins }));
app.use(compression());
app.use(express.json({ limit: '100kb' }));

app.use('/api', routes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = parseInt(process.env.PORT || '4000', 10);
const server = app.listen(port, () => console.log(`Hotel API listening on :${port}`));

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
