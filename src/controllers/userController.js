const pool = require('../config/db');

const _INVALID_URL_VALUES = ['NON DEFINI', 'INDEFINI', 'undefined', 'null', ''];
const sanitizeUrl = (url) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (_INVALID_URL_VALUES.includes(trimmed)) return null;
  if (!trimmed.startsWith('http')) return null;
  return trimmed;
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online, last_seen FROM users WHERE alanyaID = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ ...rows[0], avatar_url: sanitizeUrl(rows[0].avatar_url) });
  } catch (error) {
    throw error;
  }
};

const getUserByPhone = async (req, res) => {
  try {
    const { phone } = req.params;
    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online FROM users WHERE alanyaPhone = ?',
      [phone]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows.map(u => ({ ...u, avatar_url: sanitizeUrl(u.avatar_url) })));
  } catch (error) {
    throw error;
  }
};

const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query required' });
    }

    const [rows] = await pool.execute(
      `SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online 
       FROM users 
       WHERE (nom LIKE ? OR pseudo LIKE ? OR alanyaPhone LIKE ?) 
       AND exclus = 0
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );

    res.json(rows);
  } catch (error) {
    throw error;
  }
};

const blockUser = async (req, res) => {
  try {
    const { id } = req.params;         // cible (l'utilisateur à bloquer)
    const alanyaID = req.user.alanyaID; // moi (owner du blocage)

    // blocked.alanyaID = owner (moi), blocked.idCallerBlock = target (l'autre)
    const [existing] = await pool.execute(
      'SELECT * FROM blocked WHERE alanyaID = ? AND idCallerBlock = ?',
      [alanyaID, id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'User already blocked' });
    }

    await pool.execute(
      'INSERT INTO blocked (alanyaID, idCallerBlock, dateBlock) VALUES (?, ?, NOW())',
      [alanyaID, id]
    );

    res.json({ message: 'User blocked' });
  } catch (error) {
    throw error;
  }
};

const unblockUser = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute(
      'DELETE FROM blocked WHERE alanyaID = ? AND idCallerBlock = ?',
      [alanyaID, id]
    );

    res.json({ message: 'User unblocked' });
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getUserById,
  getUserByPhone,
  searchUsers,
  blockUser,
  unblockUser,
};