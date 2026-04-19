const admin = require('firebase-admin');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
require('dotenv').config();

// ── REGISTER (idempotent) ─────────────────────────────────────────────
// Crée (ou met à jour) le user en MySQL à partir du token Firebase et
// des infos envoyées par le client.
//
// Aucun stockage de firebase_uid en base : on pose le phone comme
// custom claim `talky_phone` sur le user Firebase. Les requêtes
// authentifiées ultérieures pourront être mappées au user MySQL via
// (token.phone_number || token.talky_phone) → users.alanyaPhone.
//
// Flux :
//   - Le token Firebase valide nous donne `req.firebaseUser.uid`.
//   - Priorité au phone du token (OTP), fallback sur le body (Google).
//   - Si le phone existe déjà en base → on considère que c'est le même
//     compte (idempotent), on met à jour les champs optionnels et on
//     s'assure que le custom claim `talky_phone` est bien posé.
//   - Sinon, insertion d'un nouveau user + pose du custom claim.
//
// NB : le unicité du phone est garantie à la fois par le check explicite
//      ci-dessous et par le check côté `phoneExists` appelé avant par le
//      client. Deux users Firebase qui tenteraient le même phone verront
//      juste la même ligne DB (le 2ᵉ récupère la ligne existante), ce
//      qui n'est pas idéal mais acceptable tant qu'on fait confiance au
//      flux de setup profil et à la vérification préalable.
const register = async (req, res) => {
  try {
    const firebaseUid = req.firebaseUser?.uid;
    if (!firebaseUid) {
      return res.status(401).json({ error: 'Invalid Firebase token' });
    }

    const phone =
      (req.firebaseUser?.phone && req.firebaseUser.phone.trim()) ||
      (req.body?.phone && String(req.body.phone).trim()) ||
      null;

    if (!phone) {
      return res.status(400).json({
        error: 'phone required (in token or body)',
      });
    }

    const { nom, pseudo, avatar_url, idPays, fcm_token, device_ID } = req.body;

    // Helper : pose `talky_phone` sur le user Firebase en préservant les
    // autres custom claims éventuels. Si ça échoue, le client n'aura jamais
    // le claim dans son JWT → 401 « No phone claim » sur /auth/me : on échoue explicitement.
    const setPhoneClaim = async () => {
      const fbUser = await admin.auth().getUser(firebaseUid);
      const existing = fbUser.customClaims || {};
      if (existing.talky_phone === phone) return;
      await admin.auth().setCustomUserClaims(firebaseUid, {
        ...existing,
        talky_phone: phone,
      });
      const verify = await admin.auth().getUser(firebaseUid);
      const got = verify.customClaims?.talky_phone;
      if (got !== phone) {
        throw new Error(
          `talky_phone claim not applied (expected ${phone}, got ${got ?? 'undefined'})`,
        );
      }
    };

    // 1) Un user avec ce phone existe-t-il déjà en MySQL ?
    const [byPhone] = await pool.execute(
      'SELECT alanyaID FROM users WHERE alanyaPhone = ?',
      [phone]
    );

    if (byPhone.length > 0) {
      const alanyaID = byPhone[0].alanyaID;
      const updates = [];
      const values = [];

      if (nom)        { updates.push('nom = ?');        values.push(nom); }
      if (pseudo)     { updates.push('pseudo = ?');     values.push(pseudo); }
      if (avatar_url) { updates.push('avatar_url = ?'); values.push(avatar_url); }
      if (fcm_token)  { updates.push('fcm_token = ?');  values.push(fcm_token); }
      if (device_ID)  { updates.push('device_ID = ?');  values.push(device_ID); }

      if (updates.length > 0) {
        values.push(alanyaID);
        await pool.execute(
          `UPDATE users SET ${updates.join(', ')} WHERE alanyaID = ?`,
          values
        );
      }

      await setPhoneClaim();

      const [rows] = await pool.execute(
        'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online, last_seen FROM users WHERE alanyaID = ?',
        [alanyaID]
      );
      return res.json(rows[0]);
    }

    // 2) Nouvel utilisateur
    const [result] = await pool.execute(
      `INSERT INTO users
         (nom, pseudo, alanyaPhone, idPays, password, avatar_url,
          fcm_token, device_ID, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        nom || 'Utilisateur',
        pseudo || nom || 'Kamite',
        phone,
        idPays || 1,
        '',
        avatar_url || 'NON DEFINI',
        fcm_token || 'INDEFINI',
        device_ID || 'INDEFINI',
      ]
    );

    await setPhoneClaim();

    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online, last_seen FROM users WHERE alanyaID = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('[Register] ERROR:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
};

// ── PHONE EXISTS (public, sans auth) ──────────────────────────────────
// Utilisé par le frontend pour détecter les doublons AVANT d'envoyer
// un OTP de liaison.
const phoneExists = async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone) {
      return res.status(400).json({ error: 'phone parameter required' });
    }
    const [rows] = await pool.execute(
      'SELECT alanyaID FROM users WHERE alanyaPhone = ?',
      [phone]
    );
    res.json({
      exists: rows.length > 0,
      alanyaID: rows.length > 0 ? rows[0].alanyaID : null,
    });
  } catch (error) {
    console.error('[PhoneExists] ERROR:', error);
    res.status(500).json({ error: error.message });
  }
};

const verifyToken = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online FROM users WHERE alanyaID = ?',
      [req.user.alanyaID]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    throw error;
  }
};

const getMe = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, idPays, avatar_url, type_compte, is_online, last_seen FROM users WHERE alanyaID = ?',
      [req.user.alanyaID]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    throw error;
  }
};

const updateMe = async (req, res) => {
  try {
    const { nom, pseudo, avatar_url, fcm_token, device_ID } = req.body;
    const updates = [];
    const values = [];

    if (nom) { updates.push('nom = ?'); values.push(nom); }
    if (pseudo) { updates.push('pseudo = ?'); values.push(pseudo); }
    if (avatar_url) { updates.push('avatar_url = ?'); values.push(avatar_url); }
    if (fcm_token) { updates.push('fcm_token = ?'); values.push(fcm_token); }
    if (device_ID) { updates.push('device_ID = ?'); values.push(device_ID); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.alanyaID);
    await pool.execute(
      `UPDATE users SET ${updates.join(', ')} WHERE alanyaID = ?`,
      values
    );

    const [rows] = await pool.execute(
      'SELECT alanyaID, nom, pseudo, alanyaPhone, avatar_url, is_online FROM users WHERE alanyaID = ?',
      [req.user.alanyaID]
    );

    res.json(rows[0]);
  } catch (error) {
    throw error;
  }
};

module.exports = {
  verifyToken,
  getMe,
  updateMe,
  register,
  phoneExists,
};