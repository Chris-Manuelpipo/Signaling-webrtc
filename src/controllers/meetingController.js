const pool = require('../config/db');
const { notifyMeetingInvite } = require('../services/notificationService');

const getMeetings = async (req, res) => {
  try {
    const alanyaID = req.user.alanyaID;
    const [rows] = await pool.execute(
      `SELECT m.*, u.nom as organiser_nom, u.pseudo as organiser_pseudo, u.avatar_url as organiser_avatar
       FROM meeting m
       JOIN users u ON m.idOrganiser = u.alanyaID
       WHERE m.idOrganiser = ? OR m.idMeeting IN (
         SELECT idMeeting FROM participant WHERE IDparticipant = ?
       )
       ORDER BY m.start_time DESC`,
      [alanyaID, alanyaID]
    );
    res.json(rows);
  } catch (error) {
    throw error;
  }
};

const createMeeting = async (req, res) => {
  try {
    const { start_time, duree, objet, room, type_media = 0 } = req.body;
    const idOrganiser = req.user.alanyaID;

    if (!start_time || !objet || !room) {
      return res.status(400).json({ error: 'start_time, objet, room required' });
    }

    const [result] = await pool.execute(
      `INSERT INTO meeting (idOrganiser, start_time, duree, objet, room, isEnd, type_media) 
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [idOrganiser, start_time, duree || 60, objet, room, type_media]
    );

    await pool.execute(
      `INSERT INTO participant (idMeeting, IDparticipant, status, start_time, connecte, duree) 
       VALUES (?, ?, 1, NOW(), 1, 0)`,
      [result.insertId, idOrganiser]
    );

    const [rows] = await pool.execute(
      `SELECT m.*, u.nom as organiser_nom, u.pseudo as organiser_pseudo 
       FROM meeting m JOIN users u ON m.idOrganiser = u.alanyaID WHERE m.idMeeting = ?`,
      [result.insertId]
    );

    res.json(rows[0]);
  } catch (error) {
    throw error;
  }
};

const getMeetingById = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.execute(
      `SELECT m.*, u.nom as organiser_nom, u.pseudo as organiser_pseudo, u.avatar_url as organiser_avatar
       FROM meeting m
       JOIN users u ON m.idOrganiser = u.alanyaID
       WHERE m.idMeeting = ?`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const [participants] = await pool.execute(
      `SELECT p.*, u.nom, u.pseudo, u.avatar_url, u.is_online
       FROM participant p
       JOIN users u ON p.IDparticipant = u.alanyaID
       WHERE p.idMeeting = ?`,
      [id]
    );

    res.json({ ...rows[0], participants });
  } catch (error) {
    throw error;
  }
};

const updateMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_time, duree, objet, room, isEnd } = req.body;
    const alanyaID = req.user.alanyaID;

    const [existing] = await pool.execute(
      'SELECT * FROM meeting WHERE idMeeting = ? AND idOrganiser = ?',
      [id, alanyaID]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Meeting not found or unauthorized' });
    }

    const updates = [];
    const values = [];

    if (start_time) { updates.push('start_time = ?'); values.push(start_time); }
    if (duree) { updates.push('duree = ?'); values.push(duree); }
    if (objet) { updates.push('objet = ?'); values.push(objet); }
    if (room) { updates.push('room = ?'); values.push(room); }
    if (typeof isEnd === 'number') { updates.push('isEnd = ?'); values.push(isEnd); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    await pool.execute(`UPDATE meeting SET ${updates.join(', ')} WHERE idMeeting = ?`, values);

    const [rows] = await pool.execute('SELECT * FROM meeting WHERE idMeeting = ?', [id]);
    res.json(rows[0]);
  } catch (error) {
    throw error;
  }
};

const deleteMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    await pool.execute('DELETE FROM participant WHERE idMeeting = ?', [id]);
    await pool.execute('DELETE FROM meeting WHERE idMeeting = ? AND idOrganiser = ?', [id, alanyaID]);

    res.json({ message: 'Meeting deleted' });
  } catch (error) {
    throw error;
  }
};

const joinMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const alanyaID = req.user.alanyaID;

    const [existing] = await pool.execute(
      'SELECT * FROM participant WHERE idMeeting = ? AND IDparticipant = ?',
      [id, alanyaID]
    );

    if (existing.length > 0) {
      await pool.execute(
        'UPDATE participant SET connecte = 1, start_time = NOW() WHERE idMeeting = ? AND IDparticipant = ?',
        [id, alanyaID]
      );
    } else {
      await pool.execute(
        `INSERT INTO participant (idMeeting, IDparticipant, status, start_time, connecte, duree) 
         VALUES (?, ?, 0, NOW(), 1, 0)`,
        [id, alanyaID]
      );
    }

    res.json({ message: 'Joined meeting' });
  } catch (error) {
    throw error;
  }
};

const acceptJoinRequest = async (req, res) => {
  try {
    const { id, userId } = req.params;

    await pool.execute(
      'UPDATE participant SET status = 1 WHERE idMeeting = ? AND IDparticipant = ?',
      [id, userId]
    );

    res.json({ message: 'Join request accepted' });
  } catch (error) {
    throw error;
  }
};

const declineJoinRequest = async (req, res) => {
  try {
    const { id, userId } = req.params;

    await pool.execute(
      'DELETE FROM participant WHERE idMeeting = ? AND IDparticipant = ? AND status = 0',
      [id, userId]
    );

    res.json({ message: 'Join request declined' });
  } catch (error) {
    throw error;
  }
};

const inviteParticipants = async (req, res) => {
  try {
    const { id } = req.params;
    const { participant_ids = [] } = req.body;
    const alanyaID = req.user.alanyaID;

    // Vérifier que l'utilisateur est l'organisateur et récupérer les détails du meeting
    const [meetings] = await pool.execute(
      'SELECT m.*, u.nom as organiser_nom FROM meeting m JOIN users u ON m.idOrganiser = u.alanyaID WHERE m.idMeeting = ? AND m.idOrganiser = ?',
      [id, alanyaID]
    );

    if (meetings.length === 0) {
      return res.status(403).json({ error: 'Non autorisé' });
    }

    const meeting = meetings[0];

    // Ajouter les participants avec le statut "pending" (0)
    for (const participantId of participant_ids) {
      const [existing] = await pool.execute(
        'SELECT * FROM participant WHERE idMeeting = ? AND IDparticipant = ?',
        [id, participantId]
      );

      if (existing.length === 0) {
        await pool.execute(
          'INSERT INTO participant (idMeeting, IDparticipant, status, start_time, connecte, duree) VALUES (?, ?, 0, NOW(), 0, 0)',
          [id, participantId]
        );

        // Envoyer la notification d'invitation
        try {
          await notifyMeetingInvite(
            participantId,
            meeting.organiser_nom,
            meeting.objet,
            meeting.start_time
          );
        } catch (err) {
          console.error('[Meeting] Erreur notification invite:', err.message);
        }
      }
    }

    res.json({ message: 'Participants invited' });
  } catch (error) {
    throw error;
  }
};

module.exports = {
  getMeetings,
  createMeeting,
  getMeetingById,
  updateMeeting,
  deleteMeeting,
  joinMeeting,
  acceptJoinRequest,
  declineJoinRequest,
  inviteParticipants,
};