const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'talky-secret-key-change-in-production';

const authCustom = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const [rows] = await pool.execute(
      'SELECT alanyaID, alanyaPhone, email FROM users WHERE alanyaID = ?',
      [decoded.alanyaID]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found in DB' });
    }

    req.user = {
      alanyaID: rows[0].alanyaID,
      phone: rows[0].alanyaPhone,
      email: rows[0].email,
    };
    next();
  } catch (error) {
    console.error('[AuthCustom] ERROR:', error.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

module.exports = { authCustom, generateToken, JWT_SECRET };