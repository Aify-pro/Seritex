-- ============================================================================
-- Seritex — Adresse expéditeur par défaut des notifications (noreply@seritex.ci)
-- ============================================================================
-- Jusqu'ici sender_email restait vide (migration 0046) : sendNotification()
-- journalisait un échec de configuration sans jamais tenter d'envoi tant que
-- personne ne renseignait l'adresse depuis Paramètres > Notifications. On
-- fixe ici la valeur par défaut sur le domaine vérifié Resend, sans écraser
-- une adresse déjà configurée manuellement par un administrateur.

update notification_style_settings
set sender_email = 'noreply@seritex.ci'
where sender_email is null;
