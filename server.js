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

app.get('/', (_, res) => res.send('Talky Signaling Server ✅'));

// ── Map userId → socketId ──────────────────────────────────────────────
const users = new Map(); // userId → socketId

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
      },
      android: {
        priority: type === 'call' ? 'high' : 'normal',
        notification: {
          sound:       'default',
          channelId:   type === 'call' ? 'talky_calls' : 'talky_messages',
          priority:    type === 'call' ? 'max' : 'high',
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
