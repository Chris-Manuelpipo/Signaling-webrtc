// server.js — Talky Signaling Server (WebRTC)
// Déployer sur Render.com (gratuit)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const admin = require('firebase-admin');

// Initialiser Firebase Admin avec le Service Account
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/', (_, res) => res.send('Talky Signaling Server en marche✅'));

// ── Map userId → socketId ──────────────────────────────────────────────
const users = new Map(); // userId → socketId

// ── Group calls: roomId → Set<userId> ──────────────────────────────────────
const groupCallRooms = new Map(); // roomId → {participants: Map<userId, socketId>, creatorId: String}

app.use(express.json());

app.post('/notify', async (req, res) => {
  try {
    const { toUserId, title, body, type, conversationId, callerId } = req.body;

    // Lire le fcmToken du destinataire dans Firestore
    const userDoc = await db.collection('users').doc(toUserId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) return res.status(400).json({ error: 'No FCM token' });

    // Construire le message FCM
    const message = {
      token: fcmToken,
      notification: { title, body },
      data: {
        type:           type ?? 'message',
        conversationId: conversationId ?? '',
        callerId:       callerId ?? '',
        callerName:     title ?? '',
        roomId:         req.body.roomId ?? '',
        isVideo:        req.body.isVideo ?? false,
      },
      android: {
        priority: (type === 'call' || type === 'group_call') ? 'high' : 'normal',
        notification: {
          sound:       'default',
          channelId:   (type === 'call' || type === 'group_call') ? 'talky_calls' : 'talky_messages',
          priority:    (type === 'call' || type === 'group_call') ? 'max' : 'high',
          visibility:  'public',
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

    // ── Enregistrement de l'utilisateur ───────────────────────────────
    socket.on('register', (userId) => {
        users.set(userId, socket.id);
        socket.userId = userId;
        console.log(`[register] ${userId} → ${socket.id}`);
    });

    // ── Appel sortant ──────────────────────────────────────────────────
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

    // ── Réponse à l'appel ──────────────────────────────────────────────
    socket.on('answer_call', ({ callerId, answer }) => {
        const callerSocket = users.get(callerId);
        if (callerSocket) {
            io.to(callerSocket).emit('call_answered', { answer });
        }
    });

    // ── Refus de l'appel ──────────────────────────────────────────────
    socket.on('reject_call', ({ callerId }) => {
        const callerSocket = users.get(callerId);
        if (callerSocket) {
            io.to(callerSocket).emit('call_rejected');
        }
    });

    // ── ICE Candidates ─────────────────────────────────────────────────
    socket.on('ice_candidate', ({ targetUserId, candidate }) => {
        const targetSocket = users.get(targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('ice_candidate', { candidate });
        }
    });

    // ── Fin d'appel ────────────────────────────────────────────────────
    socket.on('end_call', ({ targetUserId }) => {
        const targetSocket = users.get(targetUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('call_ended');
        }
    });


    // ── Créer un appel de groupe ──────────────────────────────────────────
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

        // Inviter les participants ciblés
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

    // ── Rejoindre un appel de groupe ──────────────────────────────────────
    socket.on('join_group_call', ({ roomId, userId, userName, userPhoto }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) {
            socket.emit('group_call_error', { reason: 'room_not_found' });
            return;
        }

        room.participants.set(userId, socket.id);

        // Notifier les autres participants
        room.participants.forEach((participantSocketId, participantUserId) => {
            if (participantUserId !== userId) {
                io.to(participantSocketId).emit('group_user_joined', {
                    roomId,
                    userId,
                    userName,
                    userPhoto,
                });
            }
        });

        // Envoyer la liste des participants actuels au nouveau participant
        const participants = [];
        room.participants.forEach((_, participantUserId) => {
            if (participantUserId !== userId) {
                participants.push(participantUserId);
            }
        });
        socket.emit('group_participants', { roomId, participants });

        console.log(`[group_call] ${userId} joined room ${roomId} (${room.participants.size} participants)`);
    });

    // ── Offre ciblée (group) ───────────────────────────────────────────────
    socket.on('group_offer', ({ roomId, fromUserId, toUserId, offer }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_offer', {
                roomId,
                fromUserId,
                offer,
            });
        }
    });

    // ── Réponse ciblée (group) ─────────────────────────────────────────────
    socket.on('group_answer', ({ roomId, fromUserId, toUserId, answer }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_answer', {
                roomId,
                fromUserId,
                answer,
            });
        }
    });

    // ── ICE Candidates pour groupe (ciblé) ────────────────────────────────
    socket.on('group_ice_candidate', ({ roomId, fromUserId, toUserId, candidate }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;
        const targetSocket = room.participants.get(toUserId);
        if (targetSocket) {
            io.to(targetSocket).emit('group_ice_candidate', {
                roomId,
                fromUserId,
                candidate,
            });
        }
    });

    // ── Quitter un appel de groupe ────────────────────────────────────────
    socket.on('leave_group_call', ({ roomId }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;

        const userId = socket.userId;
        room.participants.delete(userId);

        room.participants.forEach((participantSocketId) => {
            io.to(participantSocketId).emit('group_user_left', {
                roomId,
                userId,
            });
        });

        if (room.participants.size === 0) {
            groupCallRooms.delete(roomId);
        }

        console.log(`[group_call] ${userId} left room ${roomId}`);
    });

    // ── Fin d'appel de groupe ────────────────────────────────────────────
    socket.on('end_group_call', ({ roomId }) => {
        const room = groupCallRooms.get(roomId);
        if (!room) return;

        room.participants.forEach((participantSocketId) => {
            io.to(participantSocketId).emit('group_call_ended', { roomId });
        });

        groupCallRooms.delete(roomId);
        console.log(`[group_call] Room ${roomId} ended`);
    });

    // ── Déconnexion ────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        if (socket.userId) {
            // Ne supprimer que si ce socket est encore le socket actif de l'user
            // (évite de supprimer quand une reconnexion a déjà eu lieu)
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
