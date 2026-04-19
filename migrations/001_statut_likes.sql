-- Table des likes sur statuts (un utilisateur = au plus un like par statut)
CREATE TABLE IF NOT EXISTS statut_likes (
  id BIGINT NOT NULL AUTO_INCREMENT,
  statutID INT NOT NULL,
  alanyaID INT NOT NULL,
  likedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_statut_liker (statutID, alanyaID),
  CONSTRAINT fk_sl_statut FOREIGN KEY (statutID) REFERENCES statut(ID) ON DELETE CASCADE,
  CONSTRAINT fk_sl_user FOREIGN KEY (alanyaID) REFERENCES users(alanyaID) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
