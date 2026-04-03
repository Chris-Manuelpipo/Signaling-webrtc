// server.js — Talky Signaling Server (WebRTC)

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io'); 
const admin = require('firebase-admin');

// Initialiser Firebase Admin avec le Service Account
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawServiceAccount) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT is missing. Set it to the JSON string of your Firebase service account.'
  );
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(rawServiceAccount);
} catch (err) {
  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT is not valid JSON. Ensure it is a JSON string (not undefined, not a file path).'
  );
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/', (_, res) => res.send('Talky Signaling : Serveur en marche✅'));

const users = new Map();
const groupCallRooms = new Map();

app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const { toUserId, title, body, type, conversationId, callerId } = req.body;

    const userDoc = await db.collection('users').doc(toUserId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return res.status(400).json({ error: 'No FCM token' });

    const isCall = type === 'call' || type === 'group_call';

    // ── DATA-ONLY message ──────────────────────────────────────────────
    // PAS de champ "notification" → Android ne génère pas de notif système.
    // Flutter reçoit tout via onMessage / onMessageOpenedApp / getInitialMessage
    // et flutter_local_notifications affiche la notif avec le bon payload JSON.
    const message = {
      token: fcmToken,
      data: {
        type:           String(type           ?? 'message'),
        title:          String(title          ?? 'Talky'),
        body:           String(body           ?? ''),
        conversationId: String(conversationId ?? ''),
        callerId:       String(callerId       ?? ''),
        callerName:     String(title          ?? ''),
        roomId:         String(req.body.roomId  ?? ''),
        isVideo:        String(req.body.isVideo ?? 'false'),
        name:           String(req.body.name    ?? title ?? ''),
        photo:          String(req.body.photo   ?? ''),
      },
      android: {
        priority: isCall ? 'high' : 'normal',
        // Pas de notification android ici — on laisse Flutter tout gérer
      },
      apns: {
        payload: {
          aps: {
            // iOS : nécessite content-available pour reveiller l'app en background
            'content-available': 1,
          },
        },
      },
    };

    await admin.messaging().send(message);
    res.json({ success: true });

  } catch (e) {
    console.error('[notify] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    socket.on('register', (userId) => {
        users.set(userId, socket.id);
        socket.userId = userId;
        console.log(`[register] ${userId} → ${socket.id}`);
    });

    socket.on('call_user', ({ targetUserId, callerId, callerName, callerPhoto, isVideo, offer }) => {
        const targetSocket = users.get(targetUserId);
        if (!targetSocket) {
            socket.emit('call_failed', { reason: 'user_offline' });
            return;
        }
        io.to(targetSocket).emit('incoming_call', {
            callerId,
            callerName,
            callerPhoto,
            isVideo,
            offer,
        });
        console.log(`[call] ${callerId} → ${targetUserId} (${isVideo ? 'vidéo' : 'audio'})`);
    });

    socket.on('answer_call', ({ callerId, answer }) => {
        const callerSocket = users.get(callerId);
        if (callerSocket) {
            io.to(callerSocket).emit('call_answered', { answer });
        }
    });

    socket.on('reject_call', ({ callerId }) => {
        const callerSocket = users.get(callerId);
        if (callerSocket) {
            io.to(callerSocket).emit('call_rejected');
        }
    });

    socket.on('ice_candidate', ({ targetUserId, candidate }) => {
        const targetSocket = users.get(targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('ice_candidate', { candidate });
        }
    });

    socket.on('end_call', ({ targetUserId }) => {
        const targetSocket = users.get(targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call_ended');
        }
    });

    socket.on('create_group_call', ({ roomId, callerId, callerName, callerPhoto, isVideo, targetUserIds }) => {
        if (!groupCallRooms.has(roomId)) {
            groupCallRooms.set(roomId, {
                creatorId: callerId,
                participants: new Map(),
                isVideo: isVideo,
            });
        }
        const room = groupCallRooms.get(roomId);
        room.participants.set(callerId, socket.id);

        if (Array.isArray(targetUserIds)) {
            targetUserIds.forEach((uid) => {
                const targetSocket = users.get(uid);
                if (targetSocket) {
                    io.to(targetSocket).emit('group_call_invite', {
                        roomId,
                        callerId,
                        callerName,
                        callerPhoto,
                        isVideo,
                    });
                }
            });
        }
        console.log(`[group_call] ${callerId} created room ${roomId}`);
    });

    socket.on('join_group_call', ({ roomId, userId, userName, userPhoto }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) {
            socket.emit('group_call_error', { reason: 'room_not_found' });
            return;
        }
        room.participants.set(userId, socket.id);

        room.participants.forEach((participantSocketId, participantUserId) => {
            if (participantUserId !== userId) {
                io.to(participantSocketId).emit('group_user_joined', {
                    roomId, userId, userName, userPhoto,
                });
            }
        });

        const participants = [];
        room.participants.forEach((_, participantUserId) => {
            if (participantUserId !== userId) participants.push(participantUserId);
        });
        socket.emit('group_participants', { roomId, participants });

        console.log(`[group_call] ${userId} joined room ${roomId} (${room.participants.size} participants)`);
    });

    socket.on('group_offer', ({ roomId, fromUserId, toUserId, offer }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_offer', { roomId, fromUserId, offer });
        }
    });

    socket.on('group_answer', ({ roomId, fromUserId, toUserId, answer }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_answer', { roomId, fromUserId, answer });
        }
    });

    socket.on('group_ice_candidate', ({ roomId, fromUserId, toUserId, candidate }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_ice_candidate', { roomId, fromUserId, candidate });
        }
    });

    socket.on('leave_group_call', ({ roomId }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const userId = socket.userId;
        room.participants.delete(userId);
        room.participants.forEach((participantSocketId) => {
            io.to(participantSocketId).emit('group_user_left', { roomId, userId });
        });
        if (room.participants.size === 0) groupCallRooms.delete(roomId);
        console.log(`[group_call] ${userId} left room ${roomId}`);
    });

    socket.on('end_group_call', ({ roomId }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        room.participants.forEach((participantSocketId) => {
            io.to(participantSocketId).emit('group_call_ended', { roomId });
        });
        groupCallRooms.delete(roomId);
        console.log(`[group_call] Room ${roomId} ended`);
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            if (users.get(socket.userId) === socket.id) {
                users.delete(socket.userId);
                console.log(`[-] Disconnected: ${socket.userId}`);
            } else {
                console.log(`[-] Stale disconnect ignored for: ${socket.userId}`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Talky Signaling Server on port ${PORT}`));
