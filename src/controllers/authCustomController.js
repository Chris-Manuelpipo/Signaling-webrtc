const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authCustom, generateToken } = require('../middleware/authCustom');

const SALT_ROUNDS = 10;

const generateAlanyaPhone = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const register = async (req, res) => {
  try {
    const { email, password, nom, pseudo, idPays, fcm_token, device_ID } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const [existingEmail] = await pool.execute(
      'SELECT alanyaID FROM users WHERE email = ?',
      [email]
    );
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    let alanyaPhone;
    while (true) {
      alanyaPhone = generateAlanyaPhone();
      const [existing] = await pool.execute(
        'SELECT alanyaID FROM users WHERE alanyaPhone = ?',
        [alanyaPhone]
      );
      if (existing.length === 0) break;
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const [result] = await pool.execute(
      `INSERT INTO users
        (nom, pseudo, alanyaPhone, email, password, idPays, avatar_url,
         fcm_token, device_ID, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        nom || 'Utilisateur',
        pseudo || nom || 'Kamite',
        alanyaPhone,
        email,
        hashedPassword,
        idPays || 1,
        'NON DEFINI',
        fcm_token || 'INDEFINI',
        device_ID || 'INDEFINI',
      ]
    );

    const token = generateToken({ alanyaID: result.insertId, email });

    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, email, avatar_url, is_online, last_seen FROM users WHERE alanyaID = ?',
      [result.insertId]
    );

    res.status(201).json({ user: rows[0], token });
  } catch (error) {
    console.error('[Register] ERROR:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, email, password, avatar_url, is_online FROM users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken({ alanyaID: user.alanyaID, email: user.email });

    delete user.password;
    res.json({ user, token });
  } catch (error) {
    console.error('[Login] ERROR:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and newPassword required' });
    }

    const [rows] = await pool.execute(
      'SELECT alanyaID FROM users WHERE email = ?',
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await pool.execute(
      'UPDATE users SET password = ? WHERE alanyaID = ?',
      [hashedPassword, rows[0].alanyaID]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('[ResetPassword] ERROR:', error);
    res.status(500).json({ error: error.message || 'Reset password failed' });
  }
};

const getMe = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, email, idPays, avatar_url, type_compte, is_online, last_seen FROM users WHERE alanyaID = ?',
      [req.user.alanyaID]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('[GetMe] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateMe = async (req, res) => {
  try {
    const { nom, pseudo, avatar_url, fcm_token, device_ID, is_online } = req.body;
    const updates = [];
    const values = [];

    if (nom) { updates.push('nom = ?'); values.push(nom); }
    if (pseudo) { updates.push('pseudo = ?'); values.push(pseudo); }
    if (avatar_url) { updates.push('avatar_url = ?'); values.push(avatar_url); }
    if (fcm_token) { updates.push('fcm_token = ?'); values.push(fcm_token); }
    if (device_ID) { updates.push('device_ID = ?'); values.push(device_ID); }
    if (is_online !== undefined) {
      updates.push('is_online = ?, last_seen = NOW()');
      values.push(is_online ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.alanyaID);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE alanyaID = ?`,
      values
    );

    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, email, avatar_url, is_online FROM users WHERE alanyaID = ?',
      [req.user.alanyaID]
    );

    res.json(rows[0]);
  } catch (error) {
    console.error('[UpdateMe] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  register,
  login,
  resetPassword,
  getMe,
  updateMe,
  authCustom,
};