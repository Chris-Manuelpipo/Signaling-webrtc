// src/socket/handlers/meetings.js
//
// Protocole aligné sur MeetingService Flutter.
//
// ── Gestion de salle ─────────────────────────────────────────────────
// Flutter → Serveur
//   meeting:create        { meetingID, organiserID, meetingName }
//   meeting:join_request  { meetingID, userID, userName }
//   meeting:join_accept   { meetingID, userID }
//   meeting:join_decline  { meetingID, userID }
//   meeting:start         { meetingID }
//   meeting:end           { meetingID }
//   meeting:chat          { meetingID, userID, message }
//   meeting:leave         { meetingID }
//
// ── WebRTC signaling (mesh) ───────────────────────────────────────────
// Flutter → Serveur
//   meeting:offer         { meetingID, toUserID, offer:{sdp,type} }
//   meeting:answer        { meetingID, toUserID, answer:{sdp,type} }
//   meeting:ice_candidate { meetingID, toUserID, candidate:{...} }
//
// Serveur → Flutter (WebRTC)
//   meeting:offer         { fromUserID, offer:{sdp,type}, meetingID }
//   meeting:answer        { fromUserID, answer:{sdp,type}, meetingID }
//   meeting:ice_candidate { fromUserID, candidate:{...}, meetingID }
//   meeting:user_left     { meetingID, userID }

// ── Helper ────────────────────────────────────────────────────────────
function toInt(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────────────────────────────
//  GESTION DE SALLE (handlers existants, inchangés)
// ─────────────────────────────────────────────────────────────────────

const meetingCreate = (io, socket, userSockets) => {
  socket.on('meeting:create', async (data) => {
    try {
      const { meetingID, organiserID, meetingName } = data;
      socket.join(`meeting_${meetingID}`);
      socket.currentMeetingID = meetingID;
      socket.emit('meeting:created', { meetingID, meetingName });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
};

const meetingJoinRequest = (io, socket, userSockets) => {
  socket.on('meeting:join_request', async (data) => {
    try {
      const { meetingID, userID, userName } = data;
      socket.to(`meeting_${meetingID}`).emit('meeting:join_requested', {
        meetingID,
        userID,
        userName,
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });
};

const meetingJoinAccept = (io, socket, userSockets) => {
  socket.on('meeting:join_accept', (data) => {
    const { meetingID, userID } = data;
    const userSocket = userSockets.get(toInt(userID));

    if (userSocket) {
      io.to(userSocket).emit('meeting:accepted', { meetingID });
    }
    // L'organisateur rejoint sa propre room socket (déjà fait dans meeting:create)
    // Les autres membres rejoignent dans meeting:join (côté Flutter) via REST + socket
    socket.to(`meeting_${meetingID}`).emit('meeting:user_joined', {
      meetingID,
      userID,
    });
  });
};

const meetingJoinDecline = (io, socket, userSockets) => {
  socket.on('meeting:join_decline', (data) => {
    const { meetingID, userID } = data;
    const userSocket = userSockets.get(toInt(userID));

    if (userSocket) {
      io.to(userSocket).emit('meeting:declined', { meetingID });
    }
  });
};

const meetingStart = (io, socket, userSockets) => {
  socket.on('meeting:start', (data) => {
    const { meetingID } = data;
    io.to(`meeting_${meetingID}`).emit('meeting:started', { meetingID });
  });
};

const meetingEnd = (io, socket, userSockets) => {
  socket.on('meeting:end', (data) => {
    const { meetingID } = data;
    io.to(`meeting_${meetingID}`).emit('meeting:ended', { meetingID });

    // Faire quitter tous les sockets de la room
    const roomSockets = io.sockets.adapter.rooms.get(`meeting_${meetingID}`);
    if (roomSockets) {
      for (const sid of roomSockets) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.leave(`meeting_${meetingID}`);
          s.currentMeetingID = null;
        }
      }
    }
  });
};

const meetingChat = (io, socket, userSockets) => {
  socket.on('meeting:chat', (data) => {
    const { meetingID, userID, message } = data;
    io.to(`meeting_${meetingID}`).emit('meeting:message', {
      meetingID,
      userID,
      message,
      sendAt: new Date(),
    });
  });
};

// ─────────────────────────────────────────────────────────────────────
//  HANDLERS WEBRTC  (NOUVEAUX)
// ─────────────────────────────────────────────────────────────────────

/**
 * Quitter la salle meeting côté WebRTC.
 * Notifie tous les autres participants pour qu'ils ferment
 * la PeerConnection correspondante.
 */
const meetingLeave = (io, socket, userSockets) => {
  socket.on('meeting:leave', (data) => {
    try {
      const meetingID = data?.meetingID ?? socket.currentMeetingID;
      if (!meetingID) return;

      socket.to(`meeting_${meetingID}`).emit('meeting:user_left', {
        meetingID,
        userID: String(socket.alanyaID),
      });

      socket.leave(`meeting_${meetingID}`);
      socket.currentMeetingID = null;
    } catch (error) {
      console.error('[Socket meeting:leave]', error.message);
    }
  });
};

/**
 * Relay SDP Offer d'un pair à un autre dans la même réunion.
 * { meetingID, toUserID, offer:{sdp, type} }
 */
const meetingOffer = (io, socket, userSockets) => {
  socket.on('meeting:offer', (data) => {
    try {
      const { meetingID, toUserID, offer } = data;
      const targetID = toInt(toUserID);
      if (!targetID || !offer) return;

      const targetSocketId = userSockets.get(targetID);
      if (targetSocketId) {
        io.to(targetSocketId).emit('meeting:offer', {
          fromUserID: String(socket.alanyaID),
          offer,
          meetingID,
        });
      }
    } catch (error) {
      console.error('[Socket meeting:offer]', error.message);
    }
  });
};

/**
 * Relay SDP Answer.
 * { meetingID, toUserID, answer:{sdp, type} }
 */
const meetingAnswer = (io, socket, userSockets) => {
  socket.on('meeting:answer', (data) => {
    try {
      const { meetingID, toUserID, answer } = data;
      const targetID = toInt(toUserID);
      if (!targetID || !answer) return;

      const targetSocketId = userSockets.get(targetID);
      if (targetSocketId) {
        io.to(targetSocketId).emit('meeting:answer', {
          fromUserID: String(socket.alanyaID),
          answer,
          meetingID,
        });
      }
    } catch (error) {
      console.error('[Socket meeting:answer]', error.message);
    }
  });
};

/**
 * Relay ICE Candidate.
 * { meetingID, toUserID, candidate:{candidate, sdpMid, sdpMLineIndex} }
 */
const meetingIceCandidate = (io, socket, userSockets) => {
  socket.on('meeting:ice_candidate', (data) => {
    try {
      const { meetingID, toUserID, candidate } = data;
      const targetID = toInt(toUserID);
      if (!targetID || !candidate) return;

      const targetSocketId = userSockets.get(targetID);
      if (targetSocketId) {
        io.to(targetSocketId).emit('meeting:ice_candidate', {
          fromUserID: String(socket.alanyaID),
          candidate,
          meetingID,
        });
      }
    } catch (error) {
      console.error('[Socket meeting:ice_candidate]', error.message);
    }
  });
};

module.exports = {
  meetingCreate,
  meetingJoinRequest,
  meetingJoinAccept,
  meetingJoinDecline,
  meetingStart,
  meetingEnd,
  meetingChat,
  // Nouveaux
  meetingLeave,
  meetingOffer,
  meetingAnswer,
  meetingIceCandidate,
};