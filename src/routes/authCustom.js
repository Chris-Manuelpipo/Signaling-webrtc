const express = require('express');
const router = express.Router();
const {
  register,
  login,
  resetPassword,
  getMe,
  updateMe,
  authCustom,
} = require('../controllers/authCustomController');

router.post('/register', register);
router.post('/login', login);
router.post('/reset-password', resetPassword);
router.get('/me', authCustom, getMe);
router.put('/me', authCustom, updateMe);

module.exports = router;