-- ============================================================================
-- Seritex — Notifications email (Resend), configurables depuis Paramètres
-- ============================================================================
--
-- Trois tables :
--   1. notification_events         — un registre EXTENSIBLE d'événements
--      déclenchables (une ligne = un point d'envoi câblé dans le code).
--      L'écran Paramètres > Notifications ne fait qu'activer/désactiver et
--      éditer le message d'une ligne EXISTANTE — câbler un NOUVEAU point de
--      déclenchement dans une nouvelle partie du code reste un petit ajout
--      de code (un appel à sendNotification) + une ligne de seed ici, jamais
--      automatique depuis l'écran seul (pas de bouton "créer un événement").
--   2. notification_style_settings — réglages globaux d'image de marque
--      (une seule ligne, même pattern que fabrication_settings /
--      sage_connection_configs).
--   3. notification_log            — historique d'envoi, append-only, jamais
--      modifié ni supprimé par l'application.
--
-- Particularité RLS notable : sendNotification() tourne dans le contexte de
-- l'utilisateur qui a déclenché l'action métier (le client acceptant SON
-- devis via acceptQuote() en fait partie) — pas seulement le staff. Les
-- policies de lecture/écriture ci-dessous couvrent donc `authenticated` au
-- sens large pour SELECT sur les deux tables de configuration et INSERT sur
-- le journal, contrairement au pattern plus étroit is_staff() de
-- status_history : ici, un client déclenche aussi un envoi.

-- ============================================================================
-- 1. NOTIFICATION_EVENTS — registre des événements déclenchables
-- ============================================================================

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  label text not null,
  description text,
  -- Texte libre, volontairement sans check constraint : de nouvelles
  -- catégories arriveront avec chaque nouveau point de déclenchement câblé,
  -- sans devoir modifier cette contrainte à chaque fois.
  category text not null default 'general',
  enabled boolean not null default true,
  subject_template text not null,
  body_template text not null,
  -- Documentation pure (affichée dans le formulaire d'édition), pas utilisée
  -- par le code d'envoi : liste des {{variables}} que CE point de
  -- déclenchement fournit réellement.
  available_variables text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table notification_events is
  'Registre des événements email déclenchables (Paramètres > Notifications). Une ligne = un point de déclenchement câblé dans le code via sendNotification(event_key, ...). L''écran ne permet que d''activer/désactiver et d''éditer le message d''une ligne existante — ajouter un NOUVEAU point de déclenchement exige un petit ajout de code + une ligne de seed ici, ce n''est jamais automatique depuis l''écran seul.';
comment on column notification_events.available_variables is
  'Documentation pure : liste (séparée par des virgules) des {{variables}} fournies par ce point de déclenchement précis, affichée dans le formulaire d''édition pour guider la rédaction du message.';

alter table notification_events enable row level security;

create policy notification_events_select on notification_events for select using (auth.uid() is not null);
create policy notification_events_admin_write on notification_events for all
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on notification_events from public, anon;
grant select, insert, update, delete on notification_events to authenticated;

-- ============================================================================
-- 2. NOTIFICATION_STYLE_SETTINGS — image de marque, une seule ligne
-- ============================================================================

create table notification_style_settings (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null default 'Seritex',
  sender_email text,
  brand_color text not null default '#0f172a',
  logo_url text,
  footer_text text default 'Seritex — Confection textile',
  -- URL de base de l'application, utilisée pour reconstituer un lien absolu
  -- dans les emails ({{lien_base}}{{chemin_lien}} dans un modèle) — pas de
  -- variable d'environnement dédiée : même logique que Sage/stockage, ce
  -- réglage est piloté depuis la base, pas .env.
  app_base_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table notification_style_settings is
  'Réglages globaux d''image de marque des emails de notification (Paramètres > Notifications). Une seule ligne, même pattern que fabrication_settings/sage_connection_configs.';
comment on column notification_style_settings.sender_email is
  'Adresse d''expéditeur (doit appartenir au domaine vérifié dans Resend). Tant que ce champ est vide, sendNotification() journalise un échec de configuration sans jamais tenter d''envoyer.';

insert into notification_style_settings (sender_name, brand_color, footer_text)
select 'Seritex', '#0f172a', 'Seritex — Confection textile'
where not exists (select 1 from notification_style_settings);

alter table notification_style_settings enable row level security;

create policy notification_style_settings_select on notification_style_settings for select using (auth.uid() is not null);
create policy notification_style_settings_update on notification_style_settings for update
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on notification_style_settings from public, anon;
grant select, update on notification_style_settings to authenticated;

-- ============================================================================
-- 3. NOTIFICATION_LOG — historique d'envoi, append-only
-- ============================================================================
-- event_key en texte libre, SANS clé étrangère vers notification_events :
-- l'historique doit rester lisible même si la ligne de configuration a été
-- modifiée depuis — même logique que entity_type/entity_id sur
-- status_history/audit_log (polymorphe, jamais contraint par FK).

create table notification_log (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  recipient_email text not null,
  recipient_label text,
  subject text not null,
  status text not null check (status in ('envoye', 'simule', 'echec', 'desactive', 'ignore_pas_de_destinataire')),
  is_test boolean not null default false,
  provider_message_id text,
  error_message text,
  related_entity_type text,
  related_entity_id uuid,
  triggered_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

comment on table notification_log is
  'Historique d''envoi (Paramètres > Notifications), append-only — jamais modifié ni supprimé par l''application. Une ligne par destinataire tenté, y compris les cas non envoyés (désactivé, aucun destinataire résolu, échec).';
comment on column notification_log.status is
  'envoye = accepté par Resend ; simule = RESEND_API_KEY absent (mode simulation, dev/CI) ; echec = erreur Resend ou configuration manquante (ex. sender_email vide) ; desactive = événement désactivé, aucun envoi tenté ; ignore_pas_de_destinataire = aucune adresse email résolue pour ce destinataire.';

create index idx_notification_log_event_key on notification_log(event_key);
create index idx_notification_log_created_at on notification_log(created_at desc);
create index idx_notification_log_status on notification_log(status);

alter table notification_log enable row level security;

create policy notification_log_select on notification_log for select using (is_platform_admin());
create policy notification_log_insert on notification_log for insert with check (auth.uid() is not null);

revoke all on notification_log from public, anon;
grant select, insert on notification_log to authenticated;
-- Pas de grant update/delete : append-only, appliqué au niveau des grants en
-- plus des policies (aucune policy update/delete = refusé par défaut, mais
-- retirer aussi le grant documente l'intention sans ambiguïté).

-- ============================================================================
-- 4. MODULE "notifications" (menu Paramètres > Rôles & permissions)
-- ============================================================================
-- Même schéma que fabrication (migration 0045) : administrateur = tout par
-- défaut. La page reste verrouillée à requirePlatformAdmin() indépendamment
-- de ce module — celui-ci ne pilote que la visibilité dans le menu.

insert into modules (key, label, description, display_order)
values ('notifications', 'Paramètres notifications',
        'Événements déclenchant un email, messages, image de marque et historique d''envoi', 170)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id, (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'),
       (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur')
from roles r, modules m
where m.key = 'notifications'
  and not exists (
    select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id
  );

-- ============================================================================
-- 5. SEED — premier lot d'événements câblés
-- ============================================================================

insert into notification_events (event_key, label, description, category, subject_template, body_template, available_variables) values
(
  'devis_envoye',
  'Devis envoyé au client',
  'Déclenché dans createQuote() (src/app/(app)/commercial/actions.ts) dès qu''un devis est créé et envoyé au contact de la demande d''origine (ou au contact principal de l''entreprise à défaut).',
  'commercial',
  'Votre devis {{numero_devis}} est disponible',
  '<p>Bonjour,</p><p>Le devis <strong>{{numero_devis}}</strong> ({{montant_total}} MAD) est disponible sur votre espace client.</p><p><a href="{{lien_base}}{{chemin_lien}}">Consulter le devis</a></p>',
  'numero_devis, nom_client, montant_total, chemin_lien'
),
(
  'demande_visuel_infographe',
  'Nouvelle demande visuel → infographe',
  'Déclenché dans createRequest() (src/app/(app)/commercial/actions.ts) quand une demande est créée avec needs_graphics=true — diffusé à tous les utilisateurs actifs du rôle infographiste (visibilité d''équipe, pas d''affectation nominative).',
  'infographie',
  'Nouvelle demande visuel — {{numero_demande}}',
  '<p>Bonjour,</p><p>Une nouvelle demande de {{nom_client}} nécessite un visuel : <strong>{{numero_demande}}</strong>.</p><p>{{description}}</p>',
  'numero_demande, nom_client, description'
),
(
  'ot_assigne_chef_section',
  'Ordre de travail assigné à un chef de section',
  'Déclenché dans reassignSectionChief() (src/app/(app)/atelier/production/actions.ts) quand un ordre de travail est affecté à un utilisateur précis.',
  'production',
  'Nouvel ordre de travail — {{numero_ot}}',
  '<p>Bonjour,</p><p>L''ordre de travail <strong>{{numero_ot}}</strong> (section {{section}}, ODF {{numero_odf}}) vous a été affecté.</p>',
  'numero_ot, numero_odf, section'
),
(
  'devis_accepte',
  'Devis accepté',
  'Déclenché dans acceptQuote() (src/app/(app)/commercial/actions.ts) quand un devis est accepté et génère un nouvel ordre de fabrication — diffusé aux responsables de production.',
  'commercial',
  'Devis accepté — nouvel ordre de fabrication {{numero_odf}}',
  '<p>Bonjour,</p><p>Le devis <strong>{{numero_devis}}</strong> de {{nom_client}} a été accepté. L''ordre de fabrication <strong>{{numero_odf}}</strong> attend votre configuration.</p>',
  'numero_devis, nom_client, numero_odf'
),
(
  'nouvelle_demande_client_portail',
  'Nouvelle demande déposée depuis le portail client',
  'Déclenché dans createClientRequest() (src/lib/actions/requests.ts) quand un client dépose une demande depuis son portail — diffusé aux utilisateurs actifs du rôle commercial.',
  'commercial',
  'Nouvelle demande client — {{numero_demande}}',
  '<p>Bonjour,</p><p>{{nom_client}} a déposé une nouvelle demande depuis le portail client : <strong>{{numero_demande}}</strong>.</p><p>{{description}}</p>',
  'numero_demande, nom_client, description'
);
