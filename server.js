require('dotenv').config();

// ── Firebase Admin — DOIT être initialisé avant tout require de route/middleware ──
const admin = require('firebase-admin');

function loadFirebaseCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (parsed.private_key && parsed.private_key.includes('\\n')) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return admin.credential.cert(parsed);
    } catch (e) {
      console.error('[Firebase] FIREBASE_SERVICE_ACCOUNT invalide:', e.message);
      throw e;
    }
  }
  try {
    return admin.credential.cert(require('./serviceAccountKey.json'));
  } catch (e) {
    throw new Error(
      'Aucun credential Firebase trouvé : ni FIREBASE_SERVICE_ACCOUNT, ' +
      'ni serviceAccountKey.json.'
    );
  }
}

admin.initializeApp({ credential: loadFirebaseCredentials() });

// ── Express + HTTP + Socket.IO ──
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const errorHandler = require('./src/middleware/errorHandler');

const authRoutes         = require('./src/routes/auth');
const authCustomRoutes   = require('./src/routes/authCustom');
const paysRoutes         = require('./src/routes/pays');
const userRoutes         = require('./src/routes/users');
const conversationRoutes = require('./src/routes/conversations');
const messageRoutes      = require('./src/routes/messages');
const messageOpsRoutes   = require('./src/routes/messageOps');
const statusRoutes       = require('./src/routes/status');
const callRoutes         = require('./src/routes/calls');
const meetingRoutes      = require('./src/routes/meetings');
const notifyRoutes       = require('./src/routes/notify');

const registerAuthHandler = require('./src/socket/handlers/auth');
const {
  joinConversation, messageSend, typingStart, typingStop,
  presenceOnline, presenceOffline, handleDisconnect,
} = require('./src/socket/handlers/chat');

// ── Handlers appels — protocole aligné sur Flutter CallService ────────
const {
  callUser,
  answerCall,
  rejectCall,
  iceCandidate,
  endCall,
  createGroupCall,
  joinGroupCall,
  leaveGroupCall,
  endGroupCall,
  groupOffer,
  groupAnswer,
  groupIceCandidate,
} = require('./src/socket/handlers/calls');

const {
  meetingCreate, meetingJoinRequest, meetingJoinAccept, meetingJoinDecline,
  meetingStart, meetingEnd, meetingChat,
  meetingLeave, meetingOffer, meetingAnswer, meetingIceCandidate, 
} = require('./src/socket/handlers/meetings');

const { startMeetingScheduler, stopMeetingScheduler } = require('./src/services/meetingScheduler');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const userSockets = new Map();

app.set('io', io);
app.set('userSockets', userSockets);

app.use(cors());
app.use(express.json());

app.use('/api/auth',          authRoutes);
app.use('/api/auth-custom',   authCustomRoutes);
app.use('/api/pays',            paysRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/conversations', messageRoutes);
app.use('/api/messages',      messageOpsRoutes);
app.use('/api/status',        statusRoutes);
app.use('/api/calls',         callRoutes);
app.use('/api/meetings',      meetingRoutes);
app.use('/notify',            notifyRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use(errorHandler);

io.on('connection', (socket) => {
  console.log('[Socket] Client connecté:', socket.id);

  // ── Auth & présence ─────────────────────────────────────────────
  registerAuthHandler(io, socket, userSockets);
  presenceOnline(io, socket, userSockets);
  presenceOffline(io, socket, userSockets);

  // ── Messagerie ──────────────────────────────────────────────────
  joinConversation(io, socket, userSockets);
  messageSend(io, socket, userSockets);
  typingStart(io, socket, userSockets);
  typingStop(io, socket, userSockets);

  // ── Appels 1-à-1 ────────────────────────────────────────────────
  callUser(io, socket, userSockets);
  answerCall(io, socket, userSockets);
  rejectCall(io, socket, userSockets);
  iceCandidate(io, socket, userSockets);
  endCall(io, socket, userSockets);

  // ── Appels de groupe ────────────────────────────────────────────
  createGroupCall(io, socket, userSockets);
  joinGroupCall(io, socket, userSockets);
  leaveGroupCall(io, socket, userSockets);
  endGroupCall(io, socket, userSockets);
  groupOffer(io, socket, userSockets);
  groupAnswer(io, socket, userSockets);
  groupIceCandidate(io, socket, userSockets);

  // ── Meetings (API séparée des appels) ───────────────────────────
  meetingCreate(io, socket, userSockets);
  meetingJoinRequest(io, socket, userSockets);
  meetingJoinAccept(io, socket, userSockets);
  meetingJoinDecline(io, socket, userSockets);
  meetingStart(io, socket, userSockets);
  meetingEnd(io, socket, userSockets);
  meetingChat(io, socket, userSockets);
  meetingLeave(io, socket, userSockets);      
  meetingOffer(io, socket, userSockets);     
  meetingAnswer(io, socket, userSockets);    
  meetingIceCandidate(io, socket, userSockets); 
  socket.on('disconnect', async () => {
    console.log('[Socket] Client déconnecté:', socket.id);
    await handleDisconnect(io, socket, userSockets);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Talky Signaling Server on port ${PORT}`);
  // Démarrer le scheduler pour les notifications de réunion
  startMeetingScheduler();
});

process.on('SIGINT', () => {
  console.log('Arrêt du serveur...');
  stopMeetingScheduler();
  process.exit(0);
});

module.exports = { app, server, io };