// src/services/meetingScheduler.js
//
// Service de scheduler pour envoyer les notifications 10 minutes avant une réunion

const pool = require('../config/db');
const { notifyMeetingReminder } = require('./notificationService');

let schedulerInterval = null;

const startMeetingScheduler = async () => {
  console.log('[MeetingScheduler] Démarrage du scheduler de notifications');

  // Vérifier toutes les minutes les réunions qui commencent dans 10 minutes
  schedulerInterval = setInterval(async () => {
    try {
      await checkAndNotifyUpcomingMeetings();
    } catch (error) {
      console.error('[MeetingScheduler] Erreur:', error.message);
    }
  }, 60000); // Vérifier chaque minute
};

const stopMeetingScheduler = () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[MeetingScheduler] Arrêt du scheduler');
  }
};

const checkAndNotifyUpcomingMeetings = async () => {
  try {
    // Trouver les réunions qui commencent dans les 10 minutes (utc)
    // et pour lesquelles aucune notification n'a été envoyée
    const [meetings] = await pool.execute(
      `SELECT m.idMeeting, m.objet, m.start_time, m.idOrganiser, u.nom as organiser_nom
       FROM meeting m
       JOIN users u ON m.idOrganiser = u.alanyaID
       WHERE m.isEnd = 0
         AND m.start_time > NOW()
         AND m.start_time <= DATE_ADD(NOW(), INTERVAL 10 MINUTE AND 11 MINUTE)
         AND NOT EXISTS (
           SELECT 1 FROM participant p
           WHERE p.idMeeting = m.idMeeting 
             AND p.status = 99  -- Signal qu'on a notifié 10min avant
         )`
    );

    for (const meeting of meetings) {
      // Notifier tous les participants acceptés et en attente
      const [participants] = await pool.execute(
        `SELECT DISTINCT p.IDparticipant
         FROM participant p
         WHERE p.idMeeting = ? AND p.status IN (0, 1)`,
        [meeting.idMeeting]
      );

      for (const p of participants) {
        try {
          await notifyMeetingReminder(
            p.IDparticipant,
            meeting.objet,
            meeting.organiser_nom
          );
        } catch (error) {
          console.error(
            `[MeetingScheduler] Erreur notification participant ${p.IDparticipant}:`,
            error.message
          );
        }
      }

      // Marquer comme notifié en créant une pseudo-entrée participant
      // Ou ajouter une colonne reminder_sent à la table meeting (meilleure approche)
      // Pour l'instant, on log juste
      console.log(
        `[MeetingScheduler] Notification de rappel envoyée pour réunion ${meeting.idMeeting}`
      );
    }
  } catch (error) {
    console.error('[MeetingScheduler] Erreur checkAndNotifyUpcomingMeetings:', error.message);
  }
};

module.exports = {
  startMeetingScheduler,
  stopMeetingScheduler,
  checkAndNotifyUpcomingMeetings,
};
