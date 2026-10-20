// PM2 process file: one Node worker per CPU core (cluster mode)
module.exports = {
  apps: [
    {
      name: 'hotel-api',
      script: 'src/index.js',
      cwd: __dirname, // so dotenv finds backend/.env
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
