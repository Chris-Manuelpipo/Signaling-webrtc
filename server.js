// server.js — Talky Signaling Server (WebRTC)
// Déployer sur Render.com (gratuit)

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.get('/', (_, res) => res.send('Talky Signaling Server ✅'));

// ── Map userId → socketId ──────────────────────────────────────────────
const users = new Map(); // userId → socketId

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
            users.delete(socket.userId);
            console.log(`[-] Disconnected: ${socket.userId}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Talky Signaling Server on port ${PORT}`));