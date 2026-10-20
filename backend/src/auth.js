const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES || '12h';

if (process.env.NODE_ENV === 'production' && SECRET === 'dev-secret-change-me') {
  console.warn('WARNING: JWT_SECRET is not set. Set a strong secret in .env');
}

const sign = (user) =>
  jwt.sign({ id: user.id, role: user.role, hotel_id: user.hotel_id, name: user.name }, SECRET, {
    expiresIn: EXPIRES,
  });

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden' });

// Tenant isolation: staff are locked to their own hotel; super_admin picks one explicitly.
function hotelScope(req, res, next) {
  if (req.user.role === 'super_admin') {
    const id = parseInt(req.query.hotel_id || req.body?.hotel_id, 10);
    if (!id) return res.status(400).json({ error: 'hotel_id is required for super admin' });
    req.hotelId = id;
  } else {
    req.hotelId = req.user.hotel_id;
  }
  next();
}

module.exports = { sign, authenticate, requireRole, hotelScope };
