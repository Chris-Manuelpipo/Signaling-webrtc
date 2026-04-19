// src/routes/status.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  getStatus,
  getMyStatus,
  getStatusViews,
  createStatus,
  deleteStatus,
  viewStatus,
  likeStatus,
  unlikeStatus,
} = require('../controllers/statutController');

router.get('/',           auth, getStatus);      // Statuts des contacts actifs
router.get('/me',         auth, getMyStatus);    // Mes statuts
router.post('/',          auth, createStatus);   // Créer un statut
router.delete('/:id',     auth, deleteStatus);   // Supprimer mon statut
router.post('/:id/view',  auth, viewStatus);     // Marquer comme vu
router.post('/:id/like',  auth, likeStatus);    // Liker
router.delete('/:id/like', auth, unlikeStatus);  // Retirer le like
router.get('/:id/views',  auth, getStatusViews); // Liste des vues (pour le propriétaire)

module.exports = router;