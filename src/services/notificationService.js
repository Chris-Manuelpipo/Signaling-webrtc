// src/services/notificationService.js
const admin = require('firebase-admin');

// Firebase Admin est initialisé une seule fois dans server.js
// Ce service utilise l'instance existante via admin.app()

const sendDataOnlyNotification = async (fcmToken, data = {}) => {
  if (!fcmToken || fcmToken === 'INDEFINI') return;

  try {
    // ✅ PAS de champ "notification" → Flutter reçoit tout via onMessage
    // Android ne génère pas de notif système, flutter_local_notifications gère l'affichage
    const message = {
      token: fcmToken,
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: data.type === 'call' || data.type === 'group_call' ? 'high' : 'normal',
      },
      apns: {
        payload: { aps: { 'content-available': 1 } },
      },
    };

    await admin.messaging().send(message);
  } catch (error) {
    console.error('[FCM] Send error:', error.message);
  }
};

const sendToUser = async (alanyaID, data = {}) => {
  try {
    const pool = require('../config/db');
    const [rows] = await pool.execute(
      'SELECT fcm_token FROM users WHERE alanyaID = ? AND fcm_token != "INDEFINI"',
      [alanyaID]
    );
    if (rows.length > 0) {
      await sendDataOnlyNotification(rows[0].fcm_token, data);
    }
  } catch (error) {
    console.error('[FCM] sendToUser error:', error.message);
  }
};

// ✅ Requête corrigée : utilise conv_participants (plus participantID)
const notifyNewMessage = async (conversationID, senderID, senderName, content, type = 0) => {
  try {
    const pool = require('../config/db');
    const [participants] = await pool.execute(
      'SELECT alanyaID FROM conv_participants WHERE conversID = ? AND alanyaID != ?',
      [conversationID, senderID]
    );

    for (const p of participants) {
      await sendToUser(p.alanyaID, {
        type:           'message',
        title:          senderName,
        body:           content ? content.substring(0, 100) : 'Nouveau média',
        conversationId: String(conversationID),
        callerId:       String(senderID),
        msgType:        String(type),
      });
    }
  } catch (error) {
    console.error('[FCM] notifyNewMessage error:', error.message);
  }
};

const notifyIncomingCall = async (idReceiver, callerID, callerName, callerPhoto, isVideo, roomId) => {
  await sendToUser(idReceiver, {
    type:       'call',
    title:      callerName,
    body:       `${callerName} vous appelle`,
    callerId:   String(callerID),
    callerName: String(callerName),
    photo:      String(callerPhoto ?? ''),
    isVideo:    String(isVideo ?? 'false'),
    roomId:     String(roomId ?? ''),
  });
};

const notifyGroupCall = async (targetUserIds = [], callerID, callerName, callerPhoto, isVideo, roomId) => {
  for (const uid of targetUserIds) {
    await sendToUser(uid, {
      type:       'group_call',
      title:      callerName,
      body:       `${callerName} démarre un appel de groupe`,
      callerId:   String(callerID),
      callerName: String(callerName),
      photo:      String(callerPhoto ?? ''),
      isVideo:    String(isVideo ?? 'false'),
      roomId:     String(roomId ?? ''),
    });
  }
};

const notifyStatusView = async (statusOwnerID, viewerName) => {
  await sendToUser(statusOwnerID, {
    type:  'status_view',
    title: 'Nouveau spectateur',
    body:  `${viewerName} a vu votre statut`,
  });
};

const notifyMeetingInvite = async (participantId, organiserName, meetingTitle, meetingTime) => {
  await sendToUser(participantId, {
    type:          'meeting_invite',
    title:         'Nouvelle réunion',
    body:          `${organiserName} vous invite à : ${meetingTitle}`,
    meetingTitle:  String(meetingTitle),
    organiserName: String(organiserName),
    meetingTime:   String(meetingTime),
  });
};

const notifyMeetingReminder = async (participantId, meetingTitle, organiserName) => {
  await sendToUser(participantId, {
    type:          'meeting_reminder',
    title:         'Réunion dans 10 minutes',
    body:          `${meetingTitle} démarre dans 10 minutes`,
    meetingTitle:  String(meetingTitle),
    organiserName: String(organiserName),
  });
};

module.exports = {
  sendDataOnlyNotification,
  sendToUser,
  notifyNewMessage,
  notifyIncomingCall,
  notifyGroupCall,
  notifyStatusView,
  notifyMeetingInvite,
  notifyMeetingReminder,
};