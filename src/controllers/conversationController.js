const pool = require('../config/db');
// ── Helper : nettoyer avatar_url avant envoi client ──────────────────
const _INVALID_URL_VALUES = ['NON DEFINI', 'INDEFINI', 'undefined', 'null', ''];
const sanitizeUrl = (url) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (_INVALID_URL_VALUES.includes(trimmed)) return null;
  if (!trimmed.startsWith('http')) return null;
  return trimmed;
};
// ── Helper : attacher les participants (avec user info) à une conv ───────
async function attachParticipants(conversationRow) {
  if (!conversationRow) return conversationRow;
  const [parts] = await pool.execute(
    `SELECT u.alanyaID, u.nom, u.pseudo, u.avatar_url,
            u.alanyaPhone, u.is_online, u.last_seen
     FROM conv_participants cp
     JOIN users u ON cp.alanyaID = u.alanyaID
     WHERE cp.conversID = ?`,
    [conversationRow.conversID]
  );
  conversationRow.participants = parts.map((p) => ({
    alanyaID:    p.alanyaID,
    nom:         p.nom,
    pseudo:      p.pseudo,
    avatar_url:  sanitizeUrl(p.avatar_url),   // ← nettoyage ici
    alanyaPhone: p.alanyaPhone,
    is_online:   p.is_online,
    last_seen:   p.last_seen,
  }));
  return conversationRow;
}

async function attachParticipantsMany(rows) {
  return Promise.all(rows.map((r) => attachParticipants(r)));
}

const getConversations = async (req, res) => {
  try {
    const alanyaID = req.user.alanyaID;
    const [rows] = await pool.execute(
      `SELECT c.*, cp.unreadCount, cp.isPinned, cp.isArchived
       FROM conversation c
       JOIN conv_participants cp ON c.conversID = cp.conversID
       WHERE cp.alanyaID = ?
       AND c.conversID NOT IN (
          SELECT cp2.conversID 
          FROM conv_participants cp2
          JOIN blocked b ON b.idCallerBlock = cp2.alanyaID
          WHERE b.alanyaID = ?
       )
       ORDER BY cp.isPinned DESC, c.lastMessageAt DESC`,
      [alanyaID, alanyaID]
    );
    const enriched = await attachParticipantsMany(rows);
    res.json(enriched);
  } catch (error) {
    throw error;
  }
};

const getConversationById = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;
    const [rows] = await pool.execute(
      `SELECT c.*, cp.unreadCount, cp.isPinned, cp.isArchived
       FROM conversation c
       JOIN conv_participants cp ON c.conversID = cp.conversID
       WHERE c.conversID = ? AND cp.alanyaID = ?`,
      [id, alanyaID]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const enriched = await attachParticipants(rows[0]);
    res.json(enriched);
  } catch (error) {
    throw error;
  }
};

const createConversation = async (req, res) => {
  try {
    const { participantID } = req.body;
    const alanyaID = req.user.alanyaID;

    if (!participantID) {
      return res.status(400).json({ error: 'participantID required' });
    }

    const [existing] = await pool.execute(
      `SELECT c.* FROM conversation c
       JOIN conv_participants cp1 ON c.conversID = cp1.conversID
       JOIN conv_participants cp2 ON c.conversID = cp2.conversID
       WHERE cp1.alanyaID = ? AND cp2.alanyaID = ? AND c.isGroup = 0`,
      [alanyaID, participantID]
    );

    if (existing.length > 0) {
      const enriched = await attachParticipants(existing[0]);
      return res.json(enriched);
    }

    const [result] = await pool.execute(
      'INSERT INTO conversation (isGroup, lastMessageAt) VALUES (0, NOW())'
    );
    const conversID = result.insertId;

    await pool.execute(
      'INSERT INTO conv_participants (conversID, alanyaID) VALUES (?, ?)',
      [conversID, alanyaID]
    );
    await pool.execute(
      'INSERT INTO conv_participants (conversID, alanyaID) VALUES (?, ?)',
      [conversID, participantID]
    );

    const [rows] = await pool.execute(
      'SELECT c.*, cp.unreadCount, cp.isPinned, cp.isArchived FROM conversation c JOIN conv_participants cp ON c.conversID = cp.conversID WHERE c.conversID = ? AND cp.alanyaID = ?',
      [conversID, alanyaID]
    );
    const enriched = await attachParticipants(rows[0]);

    // Notifier l'autre participant en temps réel
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    if (io && userSockets) {
      const sid = userSockets.get(parseInt(participantID));
      if (sid) io.to(sid).emit('conversation:created', enriched);
    }

    res.json(enriched);
  } catch (error) {
    throw error;
  }
};

const createGroup = async (req, res) => {
  try {
    const { participantIDs, groupName, groupPhoto } = req.body;
    const alanyaID = req.user.alanyaID;

    if (!participantIDs || !Array.isArray(participantIDs) || participantIDs.length === 0) {
      return res.status(400).json({ error: 'participantIDs required as array' });
    }

    const [result] = await pool.execute(
      'INSERT INTO conversation (isGroup, GroupName, groupPhoto, lastMessageAt) VALUES (1, ?, ?, NOW())',
      [groupName || 'Group', groupPhoto || null]
    );
    const conversID = result.insertId;

    await pool.execute(
      'INSERT INTO conv_participants (conversID, alanyaID) VALUES (?, ?)',
      [conversID, alanyaID]
    );

    for (const pid of participantIDs) {
      await pool.execute(
        'INSERT INTO conv_participants (conversID, alanyaID) VALUES (?, ?)',
        [conversID, pid]
      );
    }

    const [rows] = await pool.execute(
      'SELECT c.*, cp.unreadCount, cp.isPinned, cp.isArchived FROM conversation c JOIN conv_participants cp ON c.conversID = cp.conversID WHERE c.conversID = ? AND cp.alanyaID = ?',
      [conversID, alanyaID]
    );
    const enriched = await attachParticipants(rows[0]);

    // Notifier tous les membres du groupe en temps réel
    const io = req.app.get('io');
    const userSockets = req.app.get('userSockets');
    if (io && userSockets) {
      for (const pid of participantIDs) {
        const sid = userSockets.get(parseInt(pid));
        if (sid) io.to(sid).emit('conversation:created', enriched);
      }
    }

    res.json(enriched);
  } catch (error) {
    throw error;
  }
};

const updateConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPinned, isArchived, GroupName, groupPhoto } = req.body;
    const alanyaID = req.user.alanyaID;

    const updates = [];
    const values = [];

    if (GroupName) { updates.push('GroupName = ?'); values.push(GroupName); }
    if (groupPhoto !== undefined) { updates.push('groupPhoto = ?'); values.push(groupPhoto); }

    if (updates.length > 0) {
      values.push(id);
      await pool.execute(`UPDATE conversation SET ${updates.join(', ')} WHERE conversID = ?`, values);
    }

    if (typeof isPinned === 'number') {
      await pool.execute('UPDATE conv_participants SET isPinned = ? WHERE conversID = ? AND alanyaID = ?', [isPinned, id, alanyaID]);
    }
    if (typeof isArchived === 'number') {
      await pool.execute('UPDATE conv_participants SET isArchived = ? WHERE conversID = ? AND alanyaID = ?', [isArchived, id, alanyaID]);
    }

    const [rows] = await pool.execute(
      'SELECT c.*, cp.unreadCount, cp.isPinned, cp.isArchived FROM conversation c JOIN conv_participants cp ON c.conversID = cp.conversID WHERE c.conversID = ? AND cp.alanyaID = ?',
      [id, alanyaID]
    );
    const enriched = await attachParticipants(rows[0]);
    res.json(enriched);
  } catch (error) {
    throw error;
  }
};

const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute('DELETE FROM conv_participants WHERE conversID = ? AND alanyaID = ?', [id, alanyaID]);

    const [remaining] = await pool.execute('SELECT * FROM conv_participants WHERE conversID = ?', [id]);

    if (remaining.length === 0) {
      await pool.execute('DELETE FROM message WHERE conversationID = ?', [id]);
      await pool.execute('DELETE FROM conversation WHERE conversID = ?', [id]);
    }

    res.json({ message: 'Conversation deleted' });
  } catch (error) {
    throw error;
  }
};

const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute(
      `UPDATE message SET status = 3, readAt = NOW() 
       WHERE conversationID = ? AND senderID != ? AND status < 3`,
      [id, alanyaID]
    );
    await pool.execute(
      'UPDATE conv_participants SET unreadCount = 0 WHERE conversID = ? AND alanyaID = ?',
      [id, alanyaID]
    );

    res.json({ message: 'Marked as read' });
  } catch (error) {
    throw error;
  }
};

const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute('DELETE FROM conv_participants WHERE conversID = ? AND alanyaID = ?', [id, alanyaID]);

    const [remaining] = await pool.execute('SELECT * FROM conv_participants WHERE conversID = ?', [id]);

    if (remaining.length === 0) {
      await pool.execute('DELETE FROM message WHERE conversationID = ?', [id]);
      await pool.execute('DELETE FROM conversation WHERE conversID = ?', [id]);
    }

    res.json({ message: 'Left group' });
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getConversations,
  getConversationById,
  createConversation,
  createGroup,
  updateConversation,
  deleteConversation,
  markAsRead,
  leaveGroup,
};