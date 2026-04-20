# 🚀 Talky Backend — Serveur d'Instant Messaging + WebRTC

## 📋 Vue d'ensemble

**Talky Backend** est une plateforme complète d'instant messaging avec support WebRTC pour appels vidéo/audio 1-à-1 et groupe, réunions programmées, et statuts éphémères.

- **Authentification** : Firebase (OTP/Google) + JWT
- **Base de données** : MySQL
- **Communication temps réel** : Socket.IO
- **Appels vidéo** : WebRTC signaling
- **Notifications** : Firebase Cloud Messaging (FCM)
- **API** : REST + WebSocket

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│         Application Flutter (Talky)             │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
   REST API             Socket.IO
  (HTTP)        (WebSocket temps réel)
        │                     │
        └──────────┬──────────┘
                   ▼
        ┌──────────────────────┐
        │   Express.js Server  │
        └──────────┬───────────┘
                   │
        ┌──────────┴──────────────────┐
        ▼                             ▼
   ┌─────────────┐            ┌──────────────┐
   │   MySQL     │            │  Firebase    │
   │   Database  │            │  (Auth+FCM)  │
   └─────────────┘            └──────────────┘
```

---

## ⚙️ Installation

### 1. Prérequis
- Node.js 16+ 
- MySQL 5.7+
- Compte Firebase (talky-2026)

### 2. Clone et setup
```bash
git clone url du dépot
cd Serveur
npm install
```

### 3. Configuration `.env`
```env
# MySQL
DB_HOST=163.123.183.89
DB_PORT=3306
DB_NAME=alanyBD2027
DB_USER=Chris
DB_PASSWORD=KENDRA2026

# Server
PORT=3000
NODE_ENV=production

# JWT
JWT_SECRET=nmpexO60gYH7AtkxpcMu8oipT5SDxfxOu85ZbfxQ1Xg=

# Firebase (API HTTP v1 avec compte de service)
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

### 4. Démarrage
```bash
npm start          # Démarrage normal
npm run dev        # Avec nodemon (développement)
```

Le serveur démarre sur `http://localhost:3000`

---

## 🎯 Fonctionnalités principales

### 🔐 Authentification & Profil
- Inscription via Firebase (OTP ou Google)
- Mapping Firebase ↔ MySQL via numéro de téléphone
- Gestion du profil (nom, pseudo, avatar, FCM token)
- Support biométrique

### 💬 Messagerie
- Conversations 1-à-1 et groupes
- Messages texte + médias (images, vidéos, audio, fichiers)
- Édition et suppression de messages
- Suppression pour moi vs suppression totale
- Réponses en chaîne (`replyTo`)
- Statut de lecture (sent/delivered/read)
- Marquage automatique comme lu

### 📞 Appels Vidéo/Audio
- **Appels 1-à-1** : Audio et vidéo
- **Appels de groupe** : Connexions P2P multiples
- **Signaling WebRTC** : SDP offers/answers + ICE candidates
- **Historique** : Durée, type, statut (manqué/répondu/rejeté)

### 📅 Réunions programmées
- Création avec heure/durée/objet
- Invitations aux participants
- Demandes de participation (accept/decline)
- Types : audio, vidéo, screen share

### 📸 Statuts (Stories)
- Texte, image, ou vidéo
- Expiration automatique 24h
- Couleur de fond personnalisée
- Tracking des vues
- Liste des spectateurs

### 👥 Contacts & Blocage
- Recherche par nom/pseudo/téléphone
- Blocage/déblocage
- Exclusion de la plateforme
- Online/offline status avec last_seen

### 🔔 Notifications Push
- Firebase Cloud Messaging (FCM)
- Data-only : Flutter reçoit via `onMessage()`
- Appels entrants
- Nouveaux messages
- Statuts vus

---

## 📡 API REST Endpoints

### Authentication
```
POST   /api/auth/register                 - Créer/mettre à jour user
POST   /api/auth/verify                   - Vérifier token
GET    /api/auth/me                       - Profil courant
PUT    /api/auth/me                       - Mettre à jour profil
GET    /api/auth/phone-exists/:phone      - Check si phone existe
```

### Users
```
GET    /api/users/:id                     - Récupérer user par ID
GET    /api/users/phone/:phone            - Récupérer user par numéro
GET    /api/users/search?q=               - Rechercher users
POST   /api/users/:id/block               - Bloquer user
DELETE /api/users/:id/block               - Débloquer user
```

### Conversations & Messages
```
GET    /api/conversations                 - Lister conversations
POST   /api/conversations                 - Créer conversation
GET    /api/conversations/:id             - Détails conversation
PUT    /api/conversations/:id             - Éditer (pin/archive)
DELETE /api/conversations/:id             - Quitter conversation
POST   /api/conversations/:id/leave       - Quitter conversation
POST   /api/conversations/:id/read        - Marquer comme lu

GET    /api/conversations/:id/messages    - Historique messages (pagination)
POST   /api/conversations/:id/messages    - Envoyer message
PUT    /api/messages/:id                  - Éditer message
DELETE /api/messages/:id                  - Supprimer message
```

### Status (Stories)
```
GET    /api/status                        - Statuts des contacts
GET    /api/status/:id                    - Détails d'un statut
POST   /api/status                        - Créer statut
DELETE /api/status/:id                    - Supprimer statut
POST   /api/status/:id/view               - Marquer comme vu
```

### Calls
```
GET    /api/calls                         - Historique appels
POST   /api/calls                         - Enregistrer appel
PUT    /api/calls/:id/end                 - Terminer appel (durée)
```

### Meetings
```
GET    /api/meetings                      - Lister réunions
POST   /api/meetings                      - Créer réunion
GET    /api/meetings/:id                  - Détails réunion
PUT    /api/meetings/:id                  - Éditer réunion
DELETE /api/meetings/:id                  - Supprimer réunion
POST   /api/meetings/:id/join             - Rejoindre réunion
POST   /api/meetings/:id/accept/:userId   - Accepter invitation
POST   /api/meetings/:id/decline/:userId  - Refuser invitation
```

---

## 🔌 Socket.IO Events

### Authentication
```javascript
socket.on('auth', { token })               // Authentifier socket
socket.on('authenticated', { user_id })    // Retour auth réussi
```

### Chat (Messagerie temps réel)
```javascript
socket.emit('join_conversation', { conversationID })
socket.emit('message:send', { conversationID, content, type, mediaUrl })
socket.on('message:received', message)

socket.emit('typing:start', { conversationID })
socket.emit('typing:stop', { conversationID })

socket.emit('presence:online', { userID })
socket.emit('presence:offline', { userID })
socket.on('presence:updated', { userID, is_online })
```

### WebRTC Signaling (Appels 1-à-1)
```javascript
// Appelant
socket.emit('call_user', {
  targetUserId, callerId, callerName, callerPhoto, isVideo, offer
})

// Appelé
socket.on('incoming_call', { callerId, callerName, offer })
socket.emit('answer_call', { callerId, answer })

// Les deux
socket.emit('ice_candidate', { to, from, candidate })
socket.emit('end_call', { to, from })
```

### WebRTC Group Calls
```javascript
socket.emit('create_group_call', { roomId })
socket.emit('join_group_call', { roomId })
socket.emit('group_offer', { roomId, offer })
socket.emit('group_answer', { roomId, answer })
socket.emit('group_ice_candidate', { roomId, candidate })
socket.emit('leave_group_call', { roomId })
```

### Meetings
```javascript
socket.emit('meeting:create', { meetingId, title, participants })
socket.emit('meeting:join_request', { meetingId })
socket.emit('meeting:join_accept', { meetingId, userId })
socket.emit('meeting:join_decline', { meetingId, userId })
socket.emit('meeting:start', { meetingId })
socket.emit('meeting:end', { meetingId })
socket.emit('meeting:chat', { meetingId, message })
```

---

## 📊 Schéma Base de Données

### Tables principales
- **users** : Profils utilisateurs
- **conversation** : Conversations 1-à-1 et groupes
- **conv_participants** : Participants des conversations
- **message** : Messages avec media support
- **statut** : Statuts/stories
- **statut_views** : Qui a vu quel statut
- **callHistory** : Historique appels
- **meeting** : Réunions programmées
- **participant** : Participants des meetings
- **blocked** : Utilisateurs bloqués
- **pays** : Liste des pays
- **preferredContact** : Contacts favoris
- **userAccess** : Logs d'accès

Voir structure complète dans le dump SQL.

---

## 🔒 Sécurité

- ✅ Firebase Admin SDK pour authentification
- ✅ JWT tokens pour API
- ✅ Custom claims Firebase pour mapping phone
- ✅ CORS configuré
- ✅ Middleware d'authentification sur toutes les routes
- ✅ Validation des entrées avec express-validator
- ✅ Gestion centralisée des erreurs

### Recommandations production
- [ ] Restreindre CORS à domaines spécifiques
- [ ] Activer HTTPS/SSL en production
- [ ] Utiliser secrets manager pour credentials
- [ ] Ajouter rate limiting
- [ ] Ajouter logging & monitoring
- [ ] Configurer sauvegardes BD régulières

---

## 🚀 Déploiement

### Sur Render (gratuit)
1. Crée repo GitHub avec ce code
2. Va sur [render.com](https://render.com)
3. **New** → **Web Service**
4. Select repo `talky-backend`
5. Configure :
   - **Name** : `talky-backend`
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
6. Clique **Create Web Service**
7. Récupère l'URL : `https://talky-backend.onrender.com`

### Variables d'environnement sur Render
Ajoute dans les **Environment Variables** :
```
DB_HOST=163.123.183.89
DB_PORT=3306
DB_NAME=alanyBD2027
DB_USER=Chris
DB_PASSWORD=KENDRA2026
PORT=3000
NODE_ENV=production
JWT_SECRET=<ta-clé-secrète>
FIREBASE_SERVICE_ACCOUNT=<json-stringifié>
```

### Alternative : Railway
Plus rapide et plus fiable que le plan gratuit Render.

---

## 🧪 Tests

### Test connexion BD
```bash
mysql -h 163.123.183.89 -u Chris -p alanyBD2027 -e "SELECT COUNT(*) FROM users;"
```

### Test serveur
```bash
curl http://localhost:3000/api/users/search?q=test
# Doit retourner 401 (pas de token)
```

### Test Socket.IO
```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3000');
socket.on('connect', () => console.log('Connected!'));
```

---

## 📝 Logs & Debugging

Activer plus de logs :
```bash
DEBUG=* npm start
```

Les erreurs sont capturées par le middleware centralisé dans `src/middleware/errorHandler.js`.

---

## 📦 Dependencies principales

| Package | Version | Rôle |
|---------|---------|------|
| express | 4.22.1 | Framework HTTP |
| socket.io | 4.8.3 | WebSocket real-time |
| firebase-admin | 13.7.0 | Auth + FCM |
| mysql2 | 3.22.1 | Database |
| jsonwebtoken | 9.0.3 | JWT tokens |
| express-validator | 7.3.2 | Validation |
| cors | 2.8.6 | Cross-origin |
| dotenv | 17.3.1 | Config |

---

## ❓ FAQ

**Q: Pourquoi MySQL et pas Firestore ?**
A: Performance, coûts contrôlés, queries complexes facilitées.

**Q: Comment ça marche le mapping Firebase → MySQL ?**
A: Via custom claim `talky_phone` sur user Firebase. En header `Authorization`, on extrait le phone et on cherche l'user en BD.

**Q: Les appels fonctionnent hors ligne ?**
A: FCM les notifie. Ils doivent accepter l'appel dans les 30 secondes sinon marked comme manqué.

**Q: Comment scaler à 100k users ?**
A: Caching Redis, DB replication, load balancing, CDN pour assets.

---

## 🤝 Support

Pour issues : Crée une issue GitHub ou contacte le dev.

---

## 📄 License

MIT