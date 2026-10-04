-- ============================================================================
-- 0079 — LIV-2 : écran livreur, tournées, preuve de livraison, notifications
--               et confirmation de réception par le client
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot LIV-2 (L4, L7, L8, Q-LIV-3, Q-LIV-4).
--
--   1. Tournées : delivery_rounds (date, livreur, véhicule, départ / retour,
--      km) et leurs arrêts ordonnés (delivery_round_stops). Le responsable
--      livraison les compose (Q-LIV-6).
--   2. Preuve de livraison : shipment_documents (photo du BL signé — L7 :
--      décharge MANUSCRITE, le livreur ne tend jamais son téléphone au
--      client —, photo, autre) dans le bucket privé « livraisons ».
--      « Livrée » EXIGE désormais la photo de la décharge (Q-LIV-3).
--   3. Confirmation de réception (L8) : shipment_confirmations, jeton
--      aléatoire stocké HACHÉ (sha256), expiration, réponse confirme /
--      probleme. Page publique sans connexion ; « signaler un problème »
--      passe l'expédition en litige et alerte le service livraison. Aucun
--      secret à ajouter dans Vercel : le jeton ne sert qu'une fois et seul
--      son haché est en base.
--   4. Événements d'e-mail : livraison préparée, en route, livrée (avec la
--      demande de confirmation), prête à enlever, litige (interne).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TOURNÉES
-- ----------------------------------------------------------------------------

create table delivery_rounds (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  livreur_id uuid not null references app_users(id),
  vehicle_id uuid references vehicles(id),
  statut text not null default 'preparee' check (statut in ('preparee', 'en_cours', 'terminee')),
  depart_at timestamptz,
  retour_at timestamptz,
  km_depart int check (km_depart is null or km_depart >= 0),
  km_retour int check (km_retour is null or km_retour >= 0),
  notes text,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint delivery_rounds_km check (km_retour is null or km_depart is null or km_retour >= km_depart)
);

create index idx_delivery_rounds_livreur_date on delivery_rounds(livreur_id, date);

create table delivery_round_stops (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references delivery_rounds(id) on delete cascade,
  ordre int not null check (ordre >= 1),
  shipment_id uuid not null unique references shipments(id),
  created_at timestamptz not null default now()
);

create index idx_delivery_round_stops_round on delivery_round_stops(round_id, ordre);

alter table delivery_rounds enable row level security;
alter table delivery_round_stops enable row level security;

create policy delivery_rounds_select on delivery_rounds for select
  using (is_staff() or (is_livreur() and livreur_id = auth.uid()));
create policy delivery_rounds_insert on delivery_rounds for insert with check (is_delivery_manager() or is_admin());
create policy delivery_rounds_update on delivery_rounds for update
  using (is_delivery_manager() or is_admin() or (is_livreur() and livreur_id = auth.uid()))
  with check (is_delivery_manager() or is_admin() or (is_livreur() and livreur_id = auth.uid()));
create policy delivery_rounds_delete on delivery_rounds for delete using (is_delivery_manager() or is_admin());

create policy delivery_round_stops_select on delivery_round_stops for select
  using (is_staff() or exists (select 1 from delivery_rounds r where r.id = round_id and r.livreur_id = auth.uid()));
create policy delivery_round_stops_insert on delivery_round_stops for insert with check (is_delivery_manager() or is_admin());
create policy delivery_round_stops_update on delivery_round_stops for update using (is_delivery_manager() or is_admin()) with check (is_delivery_manager() or is_admin());
create policy delivery_round_stops_delete on delivery_round_stops for delete using (is_delivery_manager() or is_admin());

revoke all on delivery_rounds, delivery_round_stops from public, anon;
grant select, insert, update, delete on delivery_rounds, delivery_round_stops to authenticated;

-- Le livreur ne met à jour que l'état de SA tournée (départ, retour, km).
revoke update on delivery_rounds from authenticated;
grant update (statut, depart_at, retour_at, km_depart, km_retour, notes, vehicle_id, date, livreur_id) on delivery_rounds to authenticated;

-- ----------------------------------------------------------------------------
-- 2. PREUVE DE LIVRAISON
-- ----------------------------------------------------------------------------

create table shipment_documents (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  type text not null check (type in ('decharge_bl', 'photo', 'autre')),
  path text not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index idx_shipment_documents_shipment on shipment_documents(shipment_id);

alter table shipment_documents enable row level security;
create policy shipment_documents_select on shipment_documents for select using (voit_expedition(shipment_id));
revoke all on shipment_documents from public, anon;
grant select on shipment_documents to authenticated;

-- Enregistre un document déposé (le fichier est envoyé par l'application
-- dans le bucket « livraisons », après ce contrôle d'accès).
create or replace function record_shipment_document(
  p_shipment_id uuid,
  p_type text,
  p_path text,
  p_latitude numeric default null,
  p_longitude numeric default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (is_delivery_manager() or is_admin() or livreur_voit_expedition(p_shipment_id)) then
    raise exception 'accès refusé : cette livraison ne vous est pas confiée';
  end if;
  if p_type not in ('decharge_bl', 'photo', 'autre') then
    raise exception 'type de document invalide';
  end if;
  if p_path is null or p_path not like 'expeditions/' || p_shipment_id::text || '/%' then
    raise exception 'chemin de fichier invalide';
  end if;
  insert into shipment_documents (shipment_id, type, path, latitude, longitude, created_by)
  values (p_shipment_id, p_type, p_path, p_latitude, p_longitude, auth.uid())
  returning id into v_id;
  perform log_shipment_event(p_shipment_id, (select statut from shipments where id = p_shipment_id),
    case p_type when 'decharge_bl' then 'Photo du BL signé déposée' when 'photo' then 'Photo déposée' else 'Document déposé' end,
    case when is_livreur() then 'livreur' else 'app' end, p_latitude, p_longitude);
  return v_id;
end;
$$;

-- Vérifie qu'un chemin de stockage peut être lu par l'utilisateur (URL signée).
create or replace function can_read_shipment_document(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from shipment_documents d where d.path = p_path and voit_expedition(d.shipment_id));
$$;

revoke all on function record_shipment_document(uuid, text, text, numeric, numeric) from public, anon, authenticated;
revoke all on function can_read_shipment_document(text) from public, anon, authenticated;
grant execute on function record_shipment_document(uuid, text, text, numeric, numeric) to authenticated;
grant execute on function can_read_shipment_document(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. STATUTS : « LIVRÉE » EXIGE LA PHOTO DE LA DÉCHARGE (Q-LIV-3)
-- ----------------------------------------------------------------------------
-- Reprise de 0078 ; seul ajout : contrôle de la décharge avant « livree ».

create or replace function set_shipment_status(
  p_shipment_id uuid,
  p_statut text,
  p_commentaire text default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_receptionnaire text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s shipments;
  v_livreur boolean;
  v_source text;
begin
  select * into v_s from shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'expédition introuvable';
  end if;
  v_livreur := is_livreur() and v_s.livreur_id = auth.uid();
  if not (is_delivery_manager() or is_admin() or v_livreur) then
    raise exception 'accès refusé : cette livraison ne vous est pas confiée';
  end if;
  v_source := case when v_livreur then 'livreur' else 'app' end;

  if p_statut = 'en_route' and v_s.statut = 'planifiee' then
    null;
  elsif p_statut in ('livree', 'echec') and v_s.statut = 'en_route' then
    if p_statut = 'echec' and nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif de l''échec obligatoire';
    end if;
    if p_statut = 'livree' and not exists (
      select 1 from shipment_documents where shipment_id = p_shipment_id and type = 'decharge_bl'
    ) then
      raise exception 'photo du BL signé obligatoire pour passer en « livrée »';
    end if;
  elsif p_statut = 'enlevee' and v_s.statut = 'prete_a_enlever' and not v_livreur then
    if nullif(btrim(coalesce(p_receptionnaire, '')), '') is null then
      raise exception 'nom de la personne qui enlève obligatoire (elle signe le BL)';
    end if;
  elsif p_statut = 'litige' and v_s.statut in ('livree', 'enlevee', 'reception_confirmee') and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'décrivez le litige';
    end if;
  elsif p_statut = 'annulee' and v_s.statut in ('a_preparer', 'preparee', 'validee_compta', 'planifiee', 'prete_a_enlever', 'echec')
        and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif d''annulation obligatoire';
    end if;
  else
    raise exception 'passage de « % » à « % » impossible', v_s.statut, p_statut;
  end if;

  update shipments set
    statut = p_statut,
    livree_at = case when p_statut in ('livree', 'enlevee') then now() else livree_at end,
    receptionnaire_nom = case when p_statut in ('livree', 'enlevee') then coalesce(nullif(btrim(p_receptionnaire), ''), receptionnaire_nom) else receptionnaire_nom end,
    motif_echec = case when p_statut = 'echec' then btrim(p_commentaire) else motif_echec end
  where id = p_shipment_id;

  if p_statut in ('livree', 'enlevee') then
    update shipment_lines set quantite_livree = coalesce(quantite_livree, quantite) where shipment_id = p_shipment_id;
    perform on_shipment_delivered(p_shipment_id);
  end if;

  -- Une expédition annulée ou en échec quitte sa tournée.
  if p_statut in ('annulee', 'echec') then
    delete from delivery_round_stops where shipment_id = p_shipment_id;
  end if;

  perform log_shipment_event(p_shipment_id, p_statut, p_commentaire, v_source, p_latitude, p_longitude);
end;
$$;

revoke all on function set_shipment_status(uuid, text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function set_shipment_status(uuid, text, text, numeric, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. CONFIRMATION DE RÉCEPTION PAR LE CLIENT (L8)
-- ----------------------------------------------------------------------------

create table shipment_confirmations (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  reponse text check (reponse is null or reponse in ('confirme', 'probleme')),
  commentaire text,
  repondu_at timestamptz,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index idx_shipment_confirmations_shipment on shipment_confirmations(shipment_id);

alter table shipment_confirmations enable row level security;
create policy shipment_confirmations_select on shipment_confirmations for select using (is_staff());
revoke all on shipment_confirmations from public, anon;
grant select on shipment_confirmations to authenticated;

-- Crée la demande de confirmation d'une expédition livrée ou enlevée et
-- renvoie le jeton EN CLAIR (une seule fois, pour l'e-mail) ; seul son haché
-- est conservé.
create or replace function create_shipment_confirmation(p_shipment_id uuid, p_jours int default 30)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_s shipments;
  v_token text;
begin
  select * into v_s from shipments where id = p_shipment_id;
  if not found then
    raise exception 'expédition introuvable';
  end if;
  if not (is_delivery_manager() or is_admin() or (is_livreur() and v_s.livreur_id = auth.uid())) then
    raise exception 'accès refusé';
  end if;
  if v_s.statut not in ('livree', 'enlevee') then
    raise exception 'la confirmation de réception se demande une fois l''expédition livrée ou enlevée';
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into shipment_confirmations (shipment_id, token_hash, expires_at, created_by)
  values (p_shipment_id, encode(digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => greatest(p_jours, 1)), auth.uid());
  return v_token;
end;
$$;

-- Informations minimales affichées sur la page publique de confirmation.
create or replace function shipment_confirmation_info(p_token text)
returns table (reference text, client_nom text, livree_at timestamptz, pieces int, reponse text, expire boolean)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.reference, s.client_nom, s.livree_at,
         (select coalesce(sum(coalesce(quantite_livree, quantite)), 0)::int from shipment_lines where shipment_id = s.id),
         c.reponse, c.expires_at < now()
  from shipment_confirmations c join shipments s on s.id = c.shipment_id
  where c.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Réponse du client (page publique, sans connexion) : « confirmé » passe
-- l'expédition en reception_confirmee ; « problème » la passe en litige.
-- Horodatée au journal, source « client ». Un jeton ne sert qu'une fois.
create or replace function answer_shipment_confirmation(p_token text, p_reponse text, p_commentaire text default null)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_c shipment_confirmations;
  v_s shipments;
begin
  select * into v_c from shipment_confirmations
  where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if not found then
    raise exception 'lien de confirmation invalide';
  end if;
  if v_c.reponse is not null then
    raise exception 'cette livraison a déjà reçu une réponse';
  end if;
  if v_c.expires_at < now() then
    raise exception 'ce lien de confirmation a expiré';
  end if;
  if p_reponse not in ('confirme', 'probleme') then
    raise exception 'réponse invalide';
  end if;
  if p_reponse = 'probleme' and nullif(btrim(coalesce(p_commentaire, '')), '') is null then
    raise exception 'décrivez le problème rencontré';
  end if;

  select * into v_s from shipments where id = v_c.shipment_id for update;
  update shipment_confirmations
  set reponse = p_reponse, commentaire = nullif(btrim(coalesce(p_commentaire, '')), ''), repondu_at = now()
  where id = v_c.id;

  if p_reponse = 'confirme' and v_s.statut in ('livree', 'enlevee') then
    update shipments set statut = 'reception_confirmee' where id = v_s.id;
    insert into shipment_events (shipment_id, statut, source, commentaire)
    values (v_s.id, 'reception_confirmee', 'client', nullif(btrim(coalesce(p_commentaire, '')), ''));
  elsif p_reponse = 'probleme' and v_s.statut in ('livree', 'enlevee', 'reception_confirmee') then
    update shipments set statut = 'litige' where id = v_s.id;
    insert into shipment_events (shipment_id, statut, source, commentaire)
    values (v_s.id, 'litige', 'client', btrim(p_commentaire));
  else
    insert into shipment_events (shipment_id, statut, source, commentaire)
    values (v_s.id, v_s.statut, 'client', 'Réponse du client : ' || p_reponse || coalesce(' — ' || btrim(p_commentaire), ''));
  end if;
  return case when p_reponse = 'confirme' then 'reception_confirmee' else 'litige' end;
end;
$$;

revoke all on function create_shipment_confirmation(uuid, int) from public, anon, authenticated;
revoke all on function shipment_confirmation_info(text) from public, anon, authenticated;
revoke all on function answer_shipment_confirmation(text, text, text) from public, anon, authenticated;
grant execute on function create_shipment_confirmation(uuid, int) to authenticated;
-- Page publique : accessibles sans connexion, protégées par le jeton.
grant execute on function shipment_confirmation_info(text) to anon, authenticated;
grant execute on function answer_shipment_confirmation(text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. TOURNÉES : COMPOSITION
-- ----------------------------------------------------------------------------

-- Ajoute une expédition planifiée à une tournée (même livreur et même date
-- reportés sur l'expédition).
create or replace function add_round_stop(p_round_id uuid, p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r delivery_rounds;
  v_s shipments;
begin
  perform assert_delivery_manager();
  select * into v_r from delivery_rounds where id = p_round_id;
  select * into v_s from shipments where id = p_shipment_id for update;
  if v_r.id is null or v_s.id is null then
    raise exception 'tournée ou expédition introuvable';
  end if;
  if v_r.statut = 'terminee' then
    raise exception 'tournée terminée';
  end if;
  if v_s.mode <> 'livraison' or v_s.statut not in ('validee_compta', 'planifiee') then
    raise exception 'seule une livraison validée par la comptabilité entre dans une tournée (statut : %)', v_s.statut;
  end if;
  insert into delivery_round_stops (round_id, ordre, shipment_id)
  values (p_round_id, (select coalesce(max(ordre), 0) + 1 from delivery_round_stops where round_id = p_round_id), p_shipment_id)
  on conflict (shipment_id) do update set round_id = excluded.round_id, ordre = excluded.ordre;
  update shipments set livreur_id = v_r.livreur_id, vehicle_id = coalesce(v_r.vehicle_id, vehicle_id),
                       date_planifiee = v_r.date, statut = 'planifiee',
                       carrier_id = coalesce(carrier_id, (select id from carriers where type = 'interne' and actif order by nom limit 1))
  where id = p_shipment_id;
  perform log_shipment_event(p_shipment_id, 'planifiee', 'Ajoutée à la tournée du ' || to_char(v_r.date, 'DD/MM/YYYY'));
end;
$$;

revoke all on function add_round_stop(uuid, uuid) from public, anon, authenticated;
grant execute on function add_round_stop(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. ÉVÉNEMENTS D'E-MAIL (Q-LIV-4)
-- ----------------------------------------------------------------------------
-- Destinataires (application) : le contact de la demande, à défaut le
-- contact principal du client, plus les contacts qui ont un compte portail.
-- « livraison_litige » est interne : il va au service livraison.

insert into notification_events (event_key, label, description, category, subject_template, body_template, available_variables) values
(
  'livraison_preparee',
  'Livraison préparée',
  'Déclenché à la préparation d''une expédition (BL numéroté) — envoyé au contact client.',
  'livraison',
  'Votre livraison {{numero_bl}} est en préparation',
  '<p>Bonjour,</p><p>La livraison <strong>{{numero_bl}}</strong> ({{pieces}} pièces) de votre commande {{numero_odf}} est préparée. Livraison prévue : {{date_prevue}}.</p>',
  'numero_bl, numero_odf, nom_client, pieces, date_prevue'
),
(
  'livraison_en_route',
  'Livraison en route',
  'Déclenché quand le livreur part (statut « en route ») — envoyé au contact client.',
  'livraison',
  'Votre livraison {{numero_bl}} est en route',
  '<p>Bonjour,</p><p>Votre livraison <strong>{{numero_bl}}</strong> est en route vers {{lieu}}. Contact livreur : {{livreur}}.</p>',
  'numero_bl, nom_client, lieu, livreur'
),
(
  'livraison_livree_confirmer',
  'Livraison effectuée — confirmation de réception',
  'Déclenché quand l''expédition est livrée ou enlevée — envoyé au contact client avec un lien sécurisé (sans connexion) pour confirmer la réception ou signaler un problème.',
  'livraison',
  'Livraison {{numero_bl}} effectuée — merci de confirmer la réception',
  '<p>Bonjour,</p><p>La livraison <strong>{{numero_bl}}</strong> ({{pieces}} pièces) a été remise le {{date_livraison}}.</p><p><a href="{{lien_base}}{{chemin_lien}}">Confirmer la réception ou signaler un problème</a></p>',
  'numero_bl, nom_client, pieces, date_livraison, chemin_lien'
),
(
  'livraison_prete_a_enlever',
  'Commande prête à enlever',
  'Déclenché quand un retrait sur place est prêt — envoyé au contact client.',
  'livraison',
  'Votre commande {{numero_bl}} est prête à enlever',
  '<p>Bonjour,</p><p>Votre commande <strong>{{numero_bl}}</strong> ({{pieces}} pièces) est prête : vous pouvez venir l''enlever. Merci de vous munir de votre cachet pour signer le bon de livraison.</p>',
  'numero_bl, nom_client, pieces'
),
(
  'livraison_litige',
  'Litige signalé sur une livraison (interne)',
  'Déclenché quand le client signale un problème depuis le lien de confirmation, ou qu''un litige est ouvert — envoyé au service livraison.',
  'livraison',
  'Litige sur la livraison {{numero_bl}} — {{nom_client}}',
  '<p>Bonjour,</p><p>Un problème a été signalé sur la livraison <strong>{{numero_bl}}</strong> ({{nom_client}}) :</p><p>{{commentaire}}</p>',
  'numero_bl, nom_client, commentaire'
)
on conflict (event_key) do nothing;
