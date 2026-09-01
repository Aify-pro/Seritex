-- ============================================================
-- Module Patronnage — fiches de placement, tracés, analyses
-- Corrige et complète migration_patronnage.sql (fourni) :
--   - odf_id référençait une table inexistante ("ordres_fabrication" est la
--     clé du module dans le registre des permissions, pas une table ; la
--     table réelle des ODF est production_orders)
--   - aucune RLS/droit n'était définie sur les 3 nouvelles tables
--   - deux actions du cycle de vie (Valider, Déverrouiller) n'ont pas de
--     case dans le modèle de droits générique (Voir/Créer/Modifier/
--     Archiver/Supprimer) : on étend ce modèle plutôt que d'inventer un
--     système parallèle, pour que ces droits restent configurables depuis
--     Paramètres → Rôles & permissions comme tout le reste.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Extension générique du système de permissions : Valider / Déverrouiller
--    (réutilisable par d'autres modules à cycle de vie verrouillable)
-- ------------------------------------------------------------
alter table role_permissions
  add column if not exists can_validate boolean not null default false,
  add column if not exists can_unlock boolean not null default false;

create or replace function has_permission(p_module_key text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case p_action
        when 'view' then rp.can_view
        when 'create' then rp.can_create
        when 'modify' then rp.can_modify
        when 'archive' then rp.can_archive
        when 'delete' then rp.can_delete
        when 'validate' then rp.can_validate
        when 'unlock' then rp.can_unlock
        else false
      end
      from app_users u
      join role_permissions rp on rp.role_id = u.role_id
      join modules m on m.id = rp.module_id
      where u.id = auth.uid() and m.key = p_module_key
    ),
    false
  );
$$;

-- ------------------------------------------------------------
-- 1. Enregistrement du module + droits par défaut
--    (administrateur = tout, comme pour les autres modules existants ;
--    les autres rôles démarrent à faux, Ayman configure lui-même)
-- ------------------------------------------------------------
insert into modules (key, label, description, display_order)
values ('patronnage', 'Patronnage',
        'Fiches de placement, tracés Diamino et contrôle géométrique', 55)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id, (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'),
       (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur')
from roles r, modules m
where m.key = 'patronnage'
  and not exists (
    select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id
  );

-- ------------------------------------------------------------
-- 2. Numérotation OT : séquence annuelle OT-AAAA-NNNN
--    Table verrouillée : accessible uniquement via la fonction SECURITY
--    DEFINER ci-dessous, jamais directement via PostgREST.
-- ------------------------------------------------------------
create table if not exists patronnage_compteur_ot (
  annee int primary key,
  dernier int not null default 0
);
alter table patronnage_compteur_ot enable row level security;
revoke all on patronnage_compteur_ot from public, anon, authenticated;

create or replace function patronnage_prochain_numero_ot()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a int := extract(year from now())::int;
  n int;
begin
  insert into patronnage_compteur_ot (annee, dernier)
  values (a, 1)
  on conflict (annee) do update set dernier = patronnage_compteur_ot.dernier + 1
  returning dernier into n;
  return format('OT-%s-%s', a, lpad(n::text, 4, '0'));
end;
$$;
revoke all on function patronnage_prochain_numero_ot() from public, anon;
grant execute on function patronnage_prochain_numero_ot() to authenticated;

-- ------------------------------------------------------------
-- 3. Fiches de placement
-- ------------------------------------------------------------
create table if not exists fiches_placement (
  id uuid primary key default gen_random_uuid(),
  numero_ot text not null unique default patronnage_prochain_numero_ot(),

  statut text not null default 'demande'
    check (statut in ('demande', 'traces_deposes', 'bon_pour_coupe', 'archive')),
  statut_precedent text
    check (statut_precedent in ('demande', 'traces_deposes', 'bon_pour_coupe')),

  -- Lien ODF (référentiel, optionnel). premiere_liaison_odf_le ne s'efface
  -- jamais : il conditionne l'interdiction de suppression définitive.
  odf_id uuid references production_orders (id),
  premiere_liaison_odf_le timestamptz,

  -- Client : sélection dans la réplique Sage (id + libellé figé à la sélection)
  client_code text,
  client_libelle text,

  date_emission date not null default current_date,
  date_retour_souhaitee date,

  -- Cadre 1
  designation_article text,
  reference_modele text,
  quantite_totale integer,

  -- Cadre 2 : {"XS":0,"S":0,"M":0,"L":0,"XL":0,"XXL":0,"XXXL":0,"Autre":0}
  repartition_tailles jsonb not null default '{}'::jsonb,

  -- Cadre 3
  tissu_type text,
  grammage numeric,
  couleur text,
  laize_utile_cm numeric,
  contraintes text,

  -- Cadre 4
  observations text,

  -- Validation / verrouillage / traçabilité
  cree_par uuid references app_users (id),
  valide_par uuid references app_users (id),
  valide_le timestamptz,
  deverrouille_par uuid references app_users (id),
  deverrouille_le timestamptz,
  archive_par uuid references app_users (id),
  archive_le timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fiches_placement_statut on fiches_placement (statut);
create index if not exists idx_fiches_placement_odf on fiches_placement (odf_id);

alter table fiches_placement enable row level security;

create policy fiches_placement_select on fiches_placement
  for select using (has_permission('patronnage', 'view'));
create policy fiches_placement_insert on fiches_placement
  for insert with check (has_permission('patronnage', 'create'));
create policy fiches_placement_update on fiches_placement
  for update using (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate') or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'))
  with check (has_permission('patronnage', 'modify') or has_permission('patronnage', 'validate') or has_permission('patronnage', 'unlock') or has_permission('patronnage', 'archive'));
create policy fiches_placement_delete on fiches_placement
  for delete using (has_permission('patronnage', 'delete'));

revoke all on fiches_placement from public, anon;
grant select, insert, update, delete on fiches_placement to authenticated;

-- ------------------------------------------------------------
-- 4. Tracés (enfants de la fiche) — nombre illimité
-- ------------------------------------------------------------
create table if not exists traces_placement (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references fiches_placement (id) on delete cascade,

  ordre integer not null,                     -- position d'affichage : 1, 2, 3…
  reference text not null,                    -- OT-AAAA-NNNN-Tn (dérivée côté serveur)

  reference_patron text,
  longueur_matelas_m numeric,
  largeur_matelas_cm numeric,
  nb_plis integer,

  -- Qté par couche et par taille : {"XS":0,...,"Autre":0}
  repartition_par_couche jsonb not null default '{}'::jsonb,

  -- Fichier DXF (au remplacement : suppression storage + suppression de
  -- l'analyse via on delete cascade, puis nouvelle ligne d'analyse)
  fichier_path text,
  fichier_nom text,
  fichier_taille integer,
  charge_par uuid references app_users (id),
  charge_le timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (fiche_id, ordre),
  unique (reference)
);

create index if not exists idx_traces_placement_fiche on traces_placement (fiche_id);

alter table traces_placement enable row level security;

create policy traces_placement_select on traces_placement
  for select using (has_permission('patronnage', 'view'));
create policy traces_placement_insert on traces_placement
  for insert with check (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'));
create policy traces_placement_update on traces_placement
  for update using (has_permission('patronnage', 'modify')) with check (has_permission('patronnage', 'modify'));
create policy traces_placement_delete on traces_placement
  for delete using (has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'));

revoke all on traces_placement from public, anon;
grant select, insert, update, delete on traces_placement to authenticated;

-- ------------------------------------------------------------
-- 5. Analyses : une seule analyse vivante par tracé
-- ------------------------------------------------------------
create table if not exists analyses_trace (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null unique references traces_placement (id) on delete cascade,

  nb_pieces_detectees integer not null,

  -- Pré-passe d'échelle fichier : facteur unique appliqué au fichier entier,
  -- choisi parmi {0.01, 0.1, 1, 10, 100, 1000}. Toujours affiché si != 1.
  facteur_echelle numeric not null default 1,

  -- [{ "patron_id": uuid, "article": "...", "taille": "M", "piece": "manche",
  --    "quantite": 4, "dont_en_miroir": 2 }]
  patrons_reconnus jsonb not null default '[]'::jsonb,

  -- [{ "index_piece": 7, "calque": "...", "meilleur_score": 0.91,
  --    "meilleur_candidat": { "patron_id": ..., "article": ..., "taille": ... } }]
  pieces_non_reconnues jsonb not null default '[]'::jsonb,

  taux_reconnaissance numeric not null,       -- 0..1
  reconnaissance_complete boolean not null,   -- 100 % des pièces posées reconnues

  alerte_miroir boolean not null default false,
  alerte_echelle boolean not null default false,

  moteur_version text,
  analysee_le timestamptz not null default now()
);

alter table analyses_trace enable row level security;

create policy analyses_trace_select on analyses_trace
  for select using (has_permission('patronnage', 'view'));
create policy analyses_trace_insert on analyses_trace
  for insert with check (has_permission('patronnage', 'modify') or has_permission('patronnage', 'create'));
create policy analyses_trace_delete on analyses_trace
  for delete using (has_permission('patronnage', 'modify'));

revoke all on analyses_trace from public, anon;
grant select, insert, update, delete on analyses_trace to authenticated;

-- ------------------------------------------------------------
-- Règles serveur (à faire respecter aussi dans les actions Next.js) :
--  * Fiche en statut 'bon_pour_coupe' : aucune modification des cadres,
--    aucun ajout / remplacement / retrait de tracé ou de fichier.
--    (Non modélisable en RLS pure sans dupliquer la logique de statut —
--    appliqué côté serveur dans les actions, RLS reste le filet de sécurité
--    de dernier recours par droit générique.)
--  * Suppression définitive d'une fiche : admin uniquement (can_delete), ET
--    valide_le is null ET premiere_liaison_odf_le is null — vérifié côté
--    serveur avant le DELETE.
--  * Passage 'bon_pour_coupe' : nécessite can_validate, horodaté + valide_par.
--  * 'Repasser en révision' : nécessite can_unlock, horodaté + deverrouille_par.
-- ------------------------------------------------------------
