-- ============================================================================
-- 0174 — Module Véhicules, lot VEH-8 : alertes GPS paramétrables
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/module-vehicules.md (§0 D3, §3 VEH-8).
--
-- D3 : « un maximum d'alertes qu'on puisse paramétrer sur la plateforme ».
-- Chaque règle s'allume ou s'éteint, porte ses seuils (jsonb), sa gravité et
-- les usages de véhicules concernés (vide = tous). Les règles sont évaluées
-- par Seritex à chaque synchronisation FreeTrack, à partir des positions et
-- des trajets/arrêts (0173) : les seuils restent maîtrisés chez nous.
--
--   1. vehicle_alert_rules    les règles (Paramètres > Logistique > Alertes).
--   2. vehicle_alert_events   les alertes levées ; chacune se prend en charge
--                             (vue, classée, commentaire). Une même situation
--                             ne crée qu'une alerte (clé de dédoublonnage).
--
-- Les échéances (documents, entretien) et les anomalies de carburant restent
-- calculées à l'affichage et s'ajoutent à la même vue « Alertes ».
-- ============================================================================

create table if not exists vehicle_alert_rules (
  code text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  libelle text not null,
  description text,
  actif boolean not null default true,
  gravite text not null default 'attention' check (gravite in ('info', 'attention', 'critique')),
  parametres jsonb not null default '{}'::jsonb,
  usages text[] not null default '{}' check (usages <@ array['livraison', 'commercial', 'direction', 'service']::text[]),
  ordre int not null default 0,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_set_updated_at on vehicle_alert_rules;
create trigger trg_set_updated_at before update on vehicle_alert_rules
  for each row execute function set_updated_at();

comment on table vehicle_alert_rules is
  'Règles d''alerte GPS (0174). parametres = seuils propres à la règle ; usages = usages de véhicules concernés (vide = tous).';

-- Seuils par défaut : à ajuster dans Paramètres. Plage de travail commune :
-- lundi à samedi (1-6, ISO), 6 h - 20 h, heure d'Abidjan (UTC).
insert into vehicle_alert_rules (code, libelle, description, actif, gravite, parametres, ordre) values
  ('exces_vitesse', 'Excès de vitesse',
   'Un trajet dépasse la vitesse autorisée (seuil distinct pour les motos).',
   true, 'critique', '{"seuil_kmh": 90, "seuil_moto_kmh": 70}', 10),
  ('hors_heures', 'Circulation hors heures de travail',
   'Le véhicule roule en dehors de la plage de travail (soir, nuit, dimanche).',
   true, 'attention', '{"debut": "06:00", "fin": "20:00", "jours": [1, 2, 3, 4, 5, 6], "km_min": 1}', 20),
  ('traceur_muet', 'Traceur muet',
   'Aucun signal du traceur depuis trop longtemps (débranché, en panne, hors réseau).',
   true, 'critique', '{"heures": 48}', 30),
  ('arret_prolonge', 'Arrêt prolongé hors des lieux connus',
   'Pendant les heures de travail, un arrêt dure trop longtemps loin du dépôt, des lieux de livraison et des stations.',
   true, 'attention', '{"minutes": 120, "rayon_m": 300, "depot_lat": null, "depot_lng": null}', 40),
  ('sortie_zone', 'Sortie de la zone autorisée',
   'Le véhicule s''éloigne trop du centre de la zone (par défaut : Grand Abidjan).',
   true, 'critique', '{"centre_lat": 5.345, "centre_lng": -4.024, "rayon_km": 45}', 50),
  ('km_journalier', 'Kilométrage journalier anormal',
   'Distance d''une journée au-dessus du seuil, ou très au-dessus de l''habitude du véhicule.',
   true, 'attention', '{"seuil_km": 300, "ecart_pct": 150}', 60),
  ('moteur_ralenti', 'Moteur au ralenti prolongé',
   'Moteur allumé à l''arrêt trop longtemps (carburant gaspillé). Nécessite la détection moteur sur le traceur.',
   false, 'info', '{"minutes": 20}', 70)
on conflict (code) do nothing;

create table if not exists vehicle_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null references vehicle_alert_rules(code) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  survenue_le timestamptz not null,
  valeur numeric,
  message text not null check (char_length(message) <= 500),
  latitude double precision,
  longitude double precision,
  dedupe_key text not null unique,
  statut text not null default 'nouvelle' check (statut in ('nouvelle', 'vue', 'classee')),
  commentaire text check (commentaire is null or char_length(commentaire) <= 500),
  traite_par uuid references app_users(id) on delete set null,
  traite_le timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_alert_events_statut on vehicle_alert_events (statut, survenue_le desc);
create index if not exists idx_vehicle_alert_events_vehicle on vehicle_alert_events (vehicle_id, survenue_le desc);

comment on table vehicle_alert_events is
  'Alertes GPS levées (0174), écrites par la synchronisation (clé de service). Traitement à l''écran : vue, classée, commentaire. dedupe_key = une alerte par situation.';

alter table vehicle_alert_rules enable row level security;
alter table vehicle_alert_events enable row level security;

create policy vehicle_alert_rules_select on vehicle_alert_rules for select
  using (has_permission('vehicules', 'view') or has_permission('parametres_vehicules', 'view'));
create policy vehicle_alert_rules_update on vehicle_alert_rules for update
  using (has_permission('parametres_vehicules', 'modify')) with check (has_permission('parametres_vehicules', 'modify'));

create policy vehicle_alert_events_select on vehicle_alert_events for select using (has_permission('vehicules', 'view'));
create policy vehicle_alert_events_update on vehicle_alert_events for update
  using (has_permission('vehicules', 'modify')) with check (has_permission('vehicules', 'modify'));

-- Les privilèges par défaut de Supabase donnent tout à authenticated : on repart de zéro.
revoke all on vehicle_alert_rules, vehicle_alert_events from public, anon, authenticated;
grant select on vehicle_alert_rules, vehicle_alert_events to authenticated;
grant update (actif, gravite, parametres, usages) on vehicle_alert_rules to authenticated;
-- Traitement seulement : ni le message, ni la date, ni le véhicule ne se modifient.
grant update (statut, commentaire, traite_par, traite_le) on vehicle_alert_events to authenticated;
