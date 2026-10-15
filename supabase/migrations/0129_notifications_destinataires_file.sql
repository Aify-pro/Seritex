-- ============================================================================
-- Seritex — Notifications : destinataires configurables + file d'attente
-- ============================================================================
--
-- Deux besoins :
--
-- 1. DESTINATAIRES CONFIGURABLES. Jusqu'ici, qui reçoit quel e-mail était codé en
--    dur dans l'application (« tous les responsables de production », « le contact
--    du client »…). Paramètres > Notifications permet désormais, pour chaque
--    événement, de choisir les destinataires : des personnes précises, un rôle
--    entier (ex. Direction), le commercial en charge du dossier, le contact client.
--    Un événement SANS destinataire configuré garde son comportement d'avant.
--
-- 2. ÉVÉNEMENTS DÉCLENCHÉS PAR LA BASE. Les e-mails ne partaient que du code de
--    l'application. Or le client agit désormais depuis www.seritex.ci/espace-client,
--    directement sur la base (accepter un devis, écrire un message) : aucun code de
--    l'application ne tourne, donc personne n'était prévenu. Des déclencheurs
--    inscrivent l'événement dans une FILE D'ATTENTE (notification_outbox), que
--    l'application vide chaque minute (envoi par Resend, nouvelle tentative en cas
--    d'échec) : rien ne se perd, quelle que soit l'origine de l'action (site,
--    plateforme, script).
--
-- Les e-mails partent toujours de l'adresse configurée dans
-- notification_style_settings.sender_email (noreply@seritex.ci), via Resend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DESTINATAIRES PAR ÉVÉNEMENT
-- ----------------------------------------------------------------------------

create table notification_recipients (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references notification_events(event_key) on delete cascade,
  kind text not null check (kind in ('user', 'role', 'responsable_dossier', 'contact_client')),
  user_id uuid references app_users(id) on delete cascade,
  role_key text references roles(key) on delete cascade,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint notification_recipients_cible check (
    (kind = 'user' and user_id is not null and role_key is null)
    or (kind = 'role' and role_key is not null and user_id is null)
    or (kind in ('responsable_dossier', 'contact_client') and user_id is null and role_key is null)
  )
);

create unique index notification_recipients_user_uniq on notification_recipients (event_key, user_id) where kind = 'user';
create unique index notification_recipients_role_uniq on notification_recipients (event_key, role_key) where kind = 'role';
create unique index notification_recipients_dyn_uniq on notification_recipients (event_key, kind) where kind in ('responsable_dossier', 'contact_client');

comment on table notification_recipients is
  'Destinataires d''un événement de notification (Paramètres > Notifications). Aucune ligne pour un événement = comportement par défaut codé dans l''application. kind : user (une personne), role (tous les comptes actifs de ce rôle, par roles.key), responsable_dossier (le commercial en charge de la demande ; à défaut les commerciaux), contact_client (le contact du client concerné).';

alter table notification_recipients enable row level security;
-- Réglage de plateforme : lu et écrit par l'administrateur seulement (l'envoi lit avec la clé de service).
create policy notification_recipients_admin on notification_recipients for all
  using (is_platform_admin()) with check (is_platform_admin());
revoke all on notification_recipients from public, anon;
grant select, insert, update, delete on notification_recipients to authenticated;

-- ----------------------------------------------------------------------------
-- 2. FILE D'ATTENTE DES ÉVÉNEMENTS
-- ----------------------------------------------------------------------------

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  process_after timestamptz not null default now(),
  attempts int not null default 0,
  processed_at timestamptz,
  last_error text
);

create index notification_outbox_a_traiter on notification_outbox (process_after) where processed_at is null;

comment on table notification_outbox is
  'File d''attente des événements de notification déclenchés par la base (devis accepté, message client…). Vidée par l''application (/api/notifications/traiter, chaque minute). Jamais accessible aux comptes connectés : service_role seulement.';

alter table notification_outbox enable row level security;
revoke all on notification_outbox from public, anon, authenticated;

-- Réserve des événements à traiter. Le délai avant la prochaine tentative s'allonge
-- à chaque réservation (2, 4, 6… minutes) : une réservation vaut aussi verrou léger
-- (deux traitements simultanés ne prennent pas la même ligne), et l'échec d'un envoi
-- est repris plus tard sans rien faire de plus. Abandon après 6 tentatives (reste visible).
create or replace function claim_notification_outbox(p_limit int default 20)
returns setof notification_outbox
language sql
security definer
set search_path = public
as $$
  update notification_outbox o
     set attempts = o.attempts + 1,
         process_after = now() + (o.attempts + 1) * interval '2 minutes'
   where o.id in (
     select id from notification_outbox
      where processed_at is null and process_after <= now() and attempts < 6
      order by created_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked
   )
  returning o.*;
$$;

revoke all on function claim_notification_outbox(int) from public, anon, authenticated;
grant execute on function claim_notification_outbox(int) to service_role;

-- ----------------------------------------------------------------------------
-- 3. DÉCLENCHEURS
-- ----------------------------------------------------------------------------

-- Devis accepté, quelle que soit l'origine (client sur le site, client ou commercial dans la plateforme).
create or replace function notification_devis_accepte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_outbox (event_key, entity_type, entity_id, payload)
  values ('devis_accepte', 'quote', new.id, jsonb_build_object('quote_id', new.id));
  return new;
end;
$$;

create trigger quotes_notifier_acceptation
  after update of status on quotes
  for each row
  when (new.status = 'accepte' and old.status is distinct from 'accepte')
  execute function notification_devis_accepte();

-- Message écrit par un CLIENT dans le fil d'une demande (les messages du personnel ne notifient personne).
create or replace function notification_message_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from app_users where id = new.sender_id and role = 'client') then
    insert into notification_outbox (event_key, entity_type, entity_id, payload)
    values ('message_client', 'request', new.request_id, jsonb_build_object('message_id', new.id));
  end if;
  return new;
end;
$$;

create trigger messages_notifier_client
  after insert on messages
  for each row
  execute function notification_message_client();

-- ----------------------------------------------------------------------------
-- 4. ÉVÉNEMENTS ET DESTINATAIRES PAR DÉFAUT
-- ----------------------------------------------------------------------------

-- « Devis accepté » ne part plus du code de acceptQuote() mais de la file (ci-dessus) : une seule
-- source, donc jamais de doublon, et l'acceptation faite depuis le site notifie aussi.
update notification_events
   set description = 'Déclenché par la base dès qu''un devis passe à « accepté » (depuis le site, le portail ou la plateforme), puis envoyé par la file d''attente. Destinataires : voir ci-dessous.'
 where event_key = 'devis_accepte';

insert into notification_events (event_key, label, description, category, subject_template, body_template, available_variables) values
(
  'message_client',
  'Message d''un client sur une demande',
  'Déclenché par la base quand un client écrit dans le fil d''une demande (depuis le site ou le portail), puis envoyé par la file d''attente. Par défaut : le commercial en charge de la demande.',
  'commercial',
  'Nouveau message de {{nom_client}} — {{numero_demande}}',
  '<p>Bonjour,</p><p><strong>{{nom_client}}</strong> a écrit sur la demande <strong>{{numero_demande}}</strong> :</p><blockquote style="margin:12px 0;padding:8px 12px;border-left:3px solid #cbd5e1;white-space:pre-line">{{extrait}}</blockquote><p><a href="{{lien_base}}{{chemin_lien}}">Ouvrir la demande</a></p>',
  'nom_client, numero_demande, extrait, chemin_lien'
)
on conflict (event_key) do nothing;

-- Direction d'abord (décision) ; à défaut de rôle « direction », l'administrateur.
insert into notification_recipients (event_key, kind, role_key)
values ('devis_accepte', 'role', coalesce((select key from roles where key = 'direction' and active), 'administrateur'))
on conflict do nothing;

insert into notification_recipients (event_key, kind)
values ('message_client', 'responsable_dossier')
on conflict do nothing;
