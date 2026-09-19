-- ============================================================================
-- Seritex — Gestion du compte utilisateur (fiche, mot de passe, notifications)
-- ============================================================================
--
-- 1. app_users : coordonnées de contact (téléphone, fonction) et deux
--    marqueurs de sécurité du mot de passe.
-- 2. Verrou de colonne : l'e-mail d'un compte n'est plus modifiable par le
--    compte lui-même (voir plus bas).
-- 3. Quatre événements de notification e-mail (Resend) pour le cycle de vie
--    d'un compte : création/invitation, modification, réinitialisation et
--    confirmation de changement de mot de passe.

-- ============================================================================
-- 1. app_users — nouvelles colonnes
-- ============================================================================

alter table app_users
  add column phone text,
  add column job_title text,
  add column must_change_password boolean not null default false,
  add column password_changed_at timestamptz;

comment on column app_users.phone is
  'Téléphone professionnel — modifiable par le titulaire (Mon compte) ou par l''administrateur de plateforme.';
comment on column app_users.job_title is
  'Fonction affichée sur la fiche (texte libre, distincte du rôle qui gouverne les accès).';
comment on column app_users.must_change_password is
  'true tant que l''utilisateur n''a pas choisi lui-même son mot de passe (compte créé avec un mot de passe provisoire, ou réinitialisation exigée par l''administrateur) : l''application l''envoie alors sur l''écran de changement de mot de passe avant tout autre écran. Remis à false uniquement côté serveur (client service_role) après un changement réussi.';
comment on column app_users.password_changed_at is
  'Date du dernier changement de mot de passe par l''utilisateur lui-même (null = jamais depuis la création du compte).';

-- Le titulaire peut compléter ses coordonnées. `must_change_password` et
-- `password_changed_at` restent volontairement HORS de ce grant : sans quoi un
-- compte pourrait se dispenser lui-même du changement de mot de passe exigé.
grant update (phone, job_title) on app_users to authenticated;

-- ============================================================================
-- 2. Verrou de l'e-mail
-- ============================================================================
-- La migration 0026 a laissé `email` modifiable par le titulaire (policy
-- « id = auth.uid() »). Or cette colonne sert d'adresse de destination pour
-- les notifications, dont désormais les liens de connexion : un compte qui
-- pourrait la réécrire détournerait ces messages. Le changement d'adresse
-- passe donc par l'administrateur de plateforme (client service_role, qui
-- synchronise aussi auth.users). Aucun écran n'écrit `email` avec le client
-- authentifié.
revoke update (email) on app_users from authenticated;

-- ============================================================================
-- 3. Notifications — cycle de vie du compte
-- ============================================================================

insert into notification_events (event_key, label, description, category, subject_template, body_template, available_variables) values
(
  'compte_cree',
  'Compte créé — invitation à définir son mot de passe',
  'Déclenché à la création d''un compte (Paramètres > Utilisateurs) et par « Renvoyer l''invitation » depuis la fiche utilisateur. Le lien est à usage unique et expire (durée réglée dans Supabase Auth > « Email OTP Expiration »).',
  'compte',
  'Votre compte Seritex est prêt',
  '<p>Bonjour {{nom_utilisateur}},</p><p>Un compte Seritex vient d''être créé pour vous avec le rôle <strong>{{role}}</strong>.</p><p>Pour l''activer, choisissez votre mot de passe :</p><p><a href="{{lien_action}}">Définir mon mot de passe</a></p><p>Ce lien est personnel, à usage unique et limité dans le temps. S''il a expiré, utilisez « Mot de passe oublié ? » sur la page de connexion.</p>',
  'nom_utilisateur, role, lien_action'
),
(
  'compte_modifie',
  'Compte modifié par un administrateur',
  'Déclenché depuis la fiche utilisateur (Paramètres > Utilisateurs) quand l''identité, le rôle, le rattachement ou l''état (activé/désactivé) d''un compte change. Le détail des changements est fourni dans {{modifications}}.',
  'compte',
  'Votre compte Seritex a été modifié',
  '<p>Bonjour {{nom_utilisateur}},</p><p>Un administrateur a modifié votre compte Seritex :</p><p>{{modifications}}</p><p>Si ces changements vous surprennent, contactez votre administrateur.</p>',
  'nom_utilisateur, modifications'
),
(
  'mot_de_passe_reinitialisation',
  'Réinitialisation du mot de passe',
  'Déclenché par « Mot de passe oublié ? » (page de connexion) ou par « Envoyer un lien de réinitialisation » depuis la fiche utilisateur. Jamais envoyé pour un compte désactivé ou inconnu (l''écran répond toujours la même chose, pour ne pas révéler quelles adresses existent).',
  'compte',
  'Réinitialisation de votre mot de passe Seritex',
  '<p>Bonjour {{nom_utilisateur}},</p><p>Vous (ou un administrateur) avez demandé la réinitialisation de votre mot de passe.</p><p><a href="{{lien_action}}">Choisir un nouveau mot de passe</a></p><p>Ce lien est à usage unique et limité dans le temps. Si vous n''êtes pas à l''origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p>',
  'nom_utilisateur, lien_action'
),
(
  'mot_de_passe_modifie',
  'Confirmation de changement de mot de passe',
  'Déclenché après chaque changement de mot de passe réussi (Mon compte, ou réinitialisation par lien). Alerte de sécurité : le titulaire est prévenu si ce n''est pas lui.',
  'compte',
  'Votre mot de passe Seritex a été modifié',
  '<p>Bonjour {{nom_utilisateur}},</p><p>Le mot de passe de votre compte Seritex vient d''être modifié ({{date_heure}}).</p><p>Si vous n''êtes pas à l''origine de ce changement, contactez immédiatement votre administrateur.</p>',
  'nom_utilisateur, date_heure'
)
on conflict (event_key) do nothing;
