// src/controllers/statutController.js
const pool = require('../config/db');
const { notifyStatusView } = require('../services/notificationService');

const getStatus = async (req, res) => {
  try {
    const alanyaID = req.user.alanyaID;

    // Statuts actifs des contacts (pas les miens, pas expirés) + likedByMe
    const [rows] = await pool.execute(
      `SELECT s.*, u.nom, u.pseudo, u.avatar_url, u.is_online,
              (sl.statutID IS NOT NULL) AS likedByMe
       FROM statut s
       JOIN users u ON s.alanyaID = u.alanyaID
       LEFT JOIN statut_likes sl ON sl.statutID = s.ID AND sl.alanyaID = ?
       WHERE s.expiredAt > NOW()
         AND s.alanyaID != ?
       ORDER BY s.createdAt DESC
       LIMIT 100`,
      [alanyaID, alanyaID]
    );

    res.json(rows);
  } catch (error) {
    throw error;
  }
};

const getMyStatus = async (req, res) => {
  try {
    const alanyaID = req.user.alanyaID;
    const [rows] = await pool.execute(
      'SELECT * FROM statut WHERE alanyaID = ? ORDER BY createdAt DESC',
      [alanyaID]
    );
    res.json(rows);
  } catch (error) {
    throw error;
  }
};

const getStatusViews = async (req, res) => {
  try {
    const { id } = req.params; // statutID
    const alanyaID = req.user.alanyaID;

    // Vérifier que ce statut appartient bien à l'utilisateur
    const [owner] = await pool.execute(
      'SELECT alanyaID FROM statut WHERE ID = ?', [id]
    );
    if (owner.length === 0 || owner[0].alanyaID !== alanyaID) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const [rows] = await pool.execute(
      `SELECT sv.*, u.nom, u.pseudo, u.avatar_url
       FROM statut_views sv
       JOIN users u ON sv.alanyaID = u.alanyaID
       WHERE sv.statutID = ?
       ORDER BY sv.seenAt DESC`,
      [id]
    );

    res.json(rows);
  } catch (error) {
    throw error;
  }
};

const createStatus = async (req, res) => {
  try {
    const { text, mediaUrl, backgroundColor, type = 0 } = req.body;
    const alanyaID = req.user.alanyaID;

    if (!text && !mediaUrl) {
      return res.status(400).json({ error: 'text ou mediaUrl requis' });
    }

    const [result] = await pool.execute(
      `INSERT INTO statut (alanyaID, type, text, mediaUrl, backgroundColor, createdAt, expiredAt, viewedBy, likedBy)
       VALUES (?, ?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR), 0, 0)`,
      [alanyaID, type, text ?? '', mediaUrl ?? null, backgroundColor ?? null]
    );

    const [rows] = await pool.execute('SELECT * FROM statut WHERE ID = ?', [result.insertId]);
    res.json(rows[0]);
  } catch (error) {
    throw error;
  }
};

const deleteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute('DELETE FROM statut WHERE ID = ? AND alanyaID = ?', [id, alanyaID]);
    res.json({ message: 'Statut supprimé' });
  } catch (error) {
    throw error;
  }
};

const viewStatus = async (req, res) => {
  try {
    const { id } = req.params; // statutID
    const alanyaID = req.user.alanyaID;

    // Vérifier que le statut existe et n'est pas expiré
    const [statut] = await pool.execute(
      'SELECT * FROM statut WHERE ID = ? AND expiredAt > NOW()',
      [id]
    );
    if (statut.length === 0) {
      return res.status(404).json({ error: 'Statut introuvable ou expiré' });
    }

    // ✅ Insérer dans statut_views (IGNORE si déjà vu → contrainte UNIQUE)
    await pool.execute(
      'INSERT IGNORE INTO statut_views (statutID, alanyaID, seenAt) VALUES (?, ?, NOW())',
      [id, alanyaID]
    );

    // ✅ Incrémenter le compteur dénormalisé seulement si c'est la première vue
    const [inserted] = await pool.execute(
      'SELECT id FROM statut_views WHERE statutID = ? AND alanyaID = ? AND seenAt >= NOW() - INTERVAL 1 SECOND',
      [id, alanyaID]
    );

    if (inserted.length > 0) {
      await pool.execute(
        'UPDATE statut SET viewedBy = viewedBy + 1 WHERE ID = ?',
        [id]
      );

      // Notifier le propriétaire du statut (sauf si c'est lui-même)
      const ownerID = statut[0].alanyaID;
      if (ownerID !== alanyaID) {
        const [viewer] = await pool.execute(
          'SELECT nom FROM users WHERE alanyaID = ?', [alanyaID]
        );
        const viewerName = viewer[0]?.nom ?? 'Quelqu\'un';
        await notifyStatusView(ownerID, viewerName);
      }
    }

    res.json({ message: 'Statut vu' });
  } catch (error) {
    throw error;
  }
};

const likeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    const [statut] = await pool.execute(
      'SELECT * FROM statut WHERE ID = ? AND expiredAt > NOW()',
      [id]
    );
    if (statut.length === 0) {
      return res.status(404).json({ error: 'Statut introuvable ou expiré' });
    }
    if (statut[0].alanyaID === alanyaID) {
      return res.status(400).json({ error: 'Vous ne pouvez pas liker votre propre statut' });
    }

    const [ins] = await pool.execute(
      'INSERT IGNORE INTO statut_likes (statutID, alanyaID, likedAt) VALUES (?, ?, NOW())',
      [id, alanyaID]
    );
    if (ins.affectedRows > 0) {
      await pool.execute(
        'UPDATE statut SET likedBy = likedBy + 1 WHERE ID = ?',
        [id]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    throw error;
  }
};

const unlikeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    const [del] = await pool.execute(
      'DELETE FROM statut_likes WHERE statutID = ? AND alanyaID = ?',
      [id, alanyaID]
    );
    if (del.affectedRows > 0) {
      await pool.execute(
        'UPDATE statut SET likedBy = GREATEST(likedBy - 1, 0) WHERE ID = ?',
        [id]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getStatus,
  getMyStatus,
  getStatusViews,
  createStatus,
  deleteStatus,
  viewStatus,
  likeStatus,
  unlikeStatus,
};