-- ============================================================================
-- 0157 — Prix de revient calculé, lot 1 : Paramètres > Personnel
-- ============================================================================
-- Plan : ~/Projects/Seritex-plans/prix-de-revient-personnel-charges.md (§4, lot 1).
-- Le prix de revient se calculera à partir des salaires et des charges réels.
-- Ce lot pose le PERSONNEL : fiches, paie du mois, présence jour par jour, et
-- l'import mensuel (format fixe produit par le programme pointage-drh) avec
-- aperçu avant application — rien n'est appliqué sans validation humaine.
--
--   1. employes             fiche : matricule, fonction, type, salaire, statut,
--                           drapeau « confidentiel » (aucun montant stocké).
--   2. employes_sections    section de l'employé, ou répartition en %.
--   3. paies_mensuelles     paie du mois par employé (coût chargé).
--   4. presences_employes   présence jour par jour (pointage).
--   5. imports_personnel    lots d'import : aperçu (jsonb) puis application.
--   6. Droits               module « Personnel » (Paramètres), réservé par
--                           défaut aux rôles de base administrateur.
--
-- Confidentialité : ces tables contiennent des salaires. Elles ne sont lisibles
-- QUE par un rôle ayant le droit « Personnel » (pas is_staff()), et un employé
-- « confidentiel » ne peut porter aucun montant (contrainte en base) : son coût
-- entre dans un poste de structure global (lot 2, onglet Charges).
-- ============================================================================

-- 1. Fiches ---------------------------------------------------------------------
create table if not exists employes (
  id uuid primary key default gen_random_uuid(),
  matricule text not null check (length(btrim(matricule)) between 1 and 30),
  nom text not null check (length(btrim(nom)) between 1 and 120),
  fonction text check (fonction is null or length(fonction) <= 120),
  type_emploi text not null default 'production_directe'
    check (type_emploi in ('production_directe', 'encadrement_production', 'structure')),
  -- Montants mensuels en F CFA.
  salaire_base numeric(14, 2) check (salaire_base is null or salaire_base >= 0),
  primes_fixes numeric(14, 2) check (primes_fixes is null or primes_fixes >= 0),
  avantages numeric(14, 2) check (avantages is null or avantages >= 0),
  charges_patronales numeric(14, 2) check (charges_patronales is null or charges_patronales >= 0),
  date_entree date,
  date_sortie date,
  statut text not null default 'actif' check (statut in ('actif', 'suspendu', 'sorti')),
  confidentiel boolean not null default false,
  source text not null default 'manuel' check (source in ('manuel', 'import')),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employes_sortie_apres_entree check (date_sortie is null or date_entree is null or date_sortie >= date_entree),
  -- Un employé confidentiel n'apporte aucun montant.
  constraint employes_confidentiel_sans_montant check (
    not confidentiel
    or (salaire_base is null and primes_fixes is null and avantages is null and charges_patronales is null)
  )
);

create unique index if not exists employes_matricule_unique on employes (upper(btrim(matricule)));
create index if not exists idx_employes_statut on employes (statut);

comment on table employes is
  'Personnel (0157) : une fiche par employé, saisie une fois puis tenue à jour par l''import mensuel de pointage-drh. confidentiel = aucun montant stocké (contrainte), le coût passe dans un poste de structure global.';
comment on column employes.type_emploi is
  'production_directe (couturière, coupeur…), encadrement_production (chef de section…), structure (administration, direction).';

-- 2. Sections de l'employé ------------------------------------------------------
create table if not exists employes_sections (
  employe_id uuid not null references employes(id) on delete cascade,
  section_id uuid not null references sections(id),
  -- 100 = affecté à une seule section ; sinon répartition (la somme fait 100,
  -- contrôlé par l'application et par employes_sections_total() ci-dessous).
  pourcentage numeric(5, 2) not null default 100 check (pourcentage > 0 and pourcentage <= 100),
  primary key (employe_id, section_id)
);

create index if not exists idx_employes_sections_section on employes_sections (section_id);

comment on table employes_sections is
  'Affectation d''un employé aux sections d''atelier (0157), en % : 100 pour une seule section, sinon répartition. Le coût de la section en découle (lot 3).';

-- Somme des % d'un employé (sert aux contrôles et à l'écran).
create or replace function employes_sections_total(p_employe uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(pourcentage), 0) from employes_sections where employe_id = p_employe;
$$;

-- 3. Paie du mois ------------------------------------------------------------------
create table if not exists paies_mensuelles (
  employe_id uuid not null references employes(id) on delete cascade,
  mois date not null check (mois = date_trunc('month', mois)::date),
  salaire_base numeric(14, 2) not null default 0 check (salaire_base >= 0),
  primes numeric(14, 2) not null default 0 check (primes >= 0),
  heures_sup numeric(14, 2) not null default 0 check (heures_sup >= 0),
  avantages numeric(14, 2) not null default 0 check (avantages >= 0),
  charges_patronales numeric(14, 2) not null default 0 check (charges_patronales >= 0),
  import_id uuid,
  created_at timestamptz not null default now(),
  primary key (employe_id, mois)
);

create index if not exists idx_paies_mensuelles_mois on paies_mensuelles (mois);

comment on table paies_mensuelles is
  'Paie du mois par employé (0157), importée de pointage-drh. Coût chargé = somme des colonnes. Jamais de ligne pour un employé confidentiel. Sert au coût des sections (lot 3) et au contrôle contre la paie Sage (lot 2).';

-- 4. Présence ------------------------------------------------------------------------
create table if not exists presences_employes (
  employe_id uuid not null references employes(id) on delete cascade,
  jour date not null,
  statut text not null check (statut in ('present', 'absent', 'conge', 'maladie', 'ferie', 'repos')),
  heures numeric(4, 2) check (heures is null or (heures >= 0 and heures <= 24)),
  import_id uuid,
  primary key (employe_id, jour)
);

create index if not exists idx_presences_employes_jour on presences_employes (jour);

comment on table presences_employes is
  'Présence jour par jour (0157), importée de pointage-drh. Sert au rendement par section (pièces sorties ÷ présents, lots 3 et 5).';

-- 5. Lots d'import ---------------------------------------------------------------------
create table if not exists imports_personnel (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('fiches', 'paie', 'presence')),
  nom_fichier text check (nom_fichier is null or length(nom_fichier) <= 200),
  -- Mois concerné (paie) ; null pour les fiches.
  mois date,
  statut text not null default 'apercu' check (statut in ('apercu', 'applique', 'abandonne')),
  -- Lignes lues : [{ ligne, action, donnees, erreurs[], avertissements[] }].
  apercu jsonb not null default '[]'::jsonb,
  nb_lignes int not null default 0,
  nb_erreurs int not null default 0,
  nb_creations int not null default 0,
  nb_modifications int not null default 0,
  cree_par uuid references app_users(id) on delete set null,
  cree_le timestamptz not null default now(),
  applique_par uuid references app_users(id) on delete set null,
  applique_le timestamptz
);

create index if not exists idx_imports_personnel_cree on imports_personnel (cree_le desc);

comment on table imports_personnel is
  'Lots d''import du personnel (0157) : le fichier est lu et enregistré en aperçu ; il n''est appliqué qu''après validation humaine (statut applique). Garde la trace de qui a importé quoi.';

-- 6. Droits ------------------------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('personnel', 'Personnel', 'Fiches du personnel, sections, paie du mois, présence et import mensuel (salaires : accès restreint)', 177)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key = 'personnel'
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true, can_create = true, can_modify = true, can_delete = true, can_validate = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'personnel'
  and r.base_role::text = 'administrateur';

-- Sécurité : lecture ET écriture réservées au droit « Personnel » (salaires).
-- valider = appliquer un import (droit validate).
do $$
declare
  t text;
begin
  foreach t in array array['employes', 'employes_sections', 'paies_mensuelles', 'presences_employes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (has_permission(''personnel'', ''view''))', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''personnel'', ''create'') or has_permission(''personnel'', ''validate''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''personnel'', ''modify'') or has_permission(''personnel'', ''validate'')) with check (has_permission(''personnel'', ''modify'') or has_permission(''personnel'', ''validate''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''personnel'', ''delete'') or has_permission(''personnel'', ''validate''))', t || '_delete', t);
  end loop;
end $$;

alter table imports_personnel enable row level security;
drop policy if exists imports_personnel_select on imports_personnel;
create policy imports_personnel_select on imports_personnel for select
  using (has_permission('personnel', 'view'));
drop policy if exists imports_personnel_insert on imports_personnel;
create policy imports_personnel_insert on imports_personnel for insert
  with check (has_permission('personnel', 'create'));
drop policy if exists imports_personnel_update on imports_personnel;
create policy imports_personnel_update on imports_personnel for update
  using (has_permission('personnel', 'create') or has_permission('personnel', 'validate'))
  with check (has_permission('personnel', 'create') or has_permission('personnel', 'validate'));
drop policy if exists imports_personnel_delete on imports_personnel;
create policy imports_personnel_delete on imports_personnel for delete
  using (has_permission('personnel', 'delete'));

drop trigger if exists trg_set_updated_at on employes;
create trigger trg_set_updated_at before update on employes
  for each row execute function set_updated_at();
