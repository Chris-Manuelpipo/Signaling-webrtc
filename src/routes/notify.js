// POST /notify — déclenche l'envoi FCM (appels hors ligne, etc.) depuis le client authentifié.
const express = require('express');
const authFirebase = require('../middleware/authFirebase');
const { sendToUser } = require('../services/notificationService');

const router = express.Router();

router.post('/', authFirebase, async (req, res, next) => {
  try {
    const {
      toUserId,
      title,
      body,
      type,
      conversationId,
      callerId,
      offer,
      roomId,
      isVideo,
    } = req.body;

    const id = parseInt(String(toUserId), 10);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ error: 'toUserId invalide' });
    }

    const payload = {
      type: String(type || 'message'),
      title: String(title || ''),
      body: String(body || ''),
    };
    if (conversationId != null) payload.conversationId = String(conversationId);
    if (callerId != null) payload.callerId = String(callerId);
    if (roomId != null) payload.roomId = String(roomId);
    if (isVideo != null) payload.isVideo = String(isVideo);
    if (offer != null) {
      payload.offer =
        typeof offer === 'string' ? offer : JSON.stringify(offer);
    }

    await sendToUser(id, payload);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
