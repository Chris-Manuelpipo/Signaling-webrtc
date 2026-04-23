const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getMeetings,
  createMeeting,
  getMeetingById,
  updateMeeting,
  deleteMeeting,
  joinMeeting,
  acceptJoinRequest,
  declineJoinRequest,
  inviteParticipants,
} = require('../controllers/meetingController');

router.get('/', auth, getMeetings);
router.post('/', auth, createMeeting);
router.get('/:id', auth, getMeetingById);
router.put('/:id', auth, updateMeeting);
router.delete('/:id', auth, deleteMeeting);
router.post('/:id/join', auth, joinMeeting);
router.post('/:id/invite', auth, inviteParticipants);
router.post('/:id/accept/:userId', auth, acceptJoinRequest);
router.post('/:id/decline/:userId', auth, declineJoinRequest);

module.exports = router;