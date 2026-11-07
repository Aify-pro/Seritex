-- ============================================================================
-- 0159 — Prix de revient calculé, lot 1b : livre de paie, liste Excel, alertes
-- ============================================================================
-- Suite de 0157 (Paramètres > Personnel). Décisions du 2026-11-07 (plan
-- ~/Projects/Seritex-plans/prix-de-revient-personnel-charges.md, §10) :
--
--   1. employes             + prénom, type de contrat (CDI/CDD), type de salaire
--                           (mensuel/horaire, déduit du livre de paie) et
--                           atelier d'origine (application Fiche de tâches).
--   2. paies_mensuelles     + indemnités, coût total et brut Sage, heures sup.
--                           en nombre, heures/jours travaillés, détail par
--                           rubrique, et cout_mois (coût du mois, calculé).
--   3. paie_rubriques       table de correspondance rubrique Sage → catégorie
--                           de coût. Une rubrique inconnue reste « à classer »
--                           (categorie nulle) : jamais ignorée en silence.
--   4. ateliers_vers_sections  atelier de la Fiche de tâches → section de la
--                           plateforme, ou « structure » (bureau, direction…).
--   5. alertes              table générique (livre de paie identique, écart
--                           anormal…) : alimentera la zone « alertes » du futur
--                           tableau de bord. Visible selon le droit du module
--                           concerné.
--   6. imports_personnel    + comparatif avec le livre précédent, empreinte du
--                           contenu (détecter deux livres identiques), motif de
--                           validation, rubriques à classer.
--
-- Le livre de paie fait foi : tout ce qui est payé dans le mois est un coût du
-- mois (indemnités et fin de contrat compris), aucune séparation « exceptionnel ».
-- ============================================================================

-- 1. Fiches ---------------------------------------------------------------------
alter table employes
  add column if not exists prenom text check (prenom is null or length(prenom) <= 120),
  add column if not exists type_contrat text check (type_contrat is null or type_contrat in ('CDI', 'CDD')),
  add column if not exists type_salaire text check (type_salaire is null or type_salaire in ('mensuel', 'horaire')),
  add column if not exists atelier_source text check (atelier_source is null or length(atelier_source) <= 80);

comment on column employes.atelier_source is
  'Atelier d''origine de l''employé (application Fiche de tâches, 0159). Sert à retrouver sa section via ateliers_vers_sections.';

-- 2. Paie du mois ----------------------------------------------------------------
alter table paies_mensuelles
  add column if not exists indemnites numeric(14, 2) not null default 0 check (indemnites >= 0),
  add column if not exists cout_total_sage numeric(14, 2),
  add column if not exists brut_sage numeric(14, 2),
  add column if not exists heures_sup_nb numeric(8, 2),
  add column if not exists heures_travaillees numeric(8, 2),
  add column if not exists jours_travailles numeric(6, 2),
  add column if not exists detail jsonb not null default '{}'::jsonb;

-- Coût du mois : le coût total calculé par Sage s'il est fourni, sinon la somme
-- des composantes. C'est cette colonne qui alimente le coût des sections.
alter table paies_mensuelles
  add column if not exists cout_mois numeric(14, 2)
  generated always as (
    coalesce(cout_total_sage, salaire_base + primes + heures_sup + indemnites + avantages + charges_patronales)
  ) stored;

comment on column paies_mensuelles.detail is
  'Montants du mois par code de rubrique Sage, retenues comprises (0159) : sert à expliquer l''écart entre le coût total de Sage et la somme des composantes (prêts, congés, taxes patronales…).';
comment on column paies_mensuelles.cout_mois is
  'Coût du mois de l''employé (0159) : coût total Sage, sinon somme des composantes. Tout ce qui est payé dans le mois est un coût du mois.';

-- 3. Rubriques de paie -----------------------------------------------------------
create table if not exists paie_rubriques (
  code text primary key check (length(btrim(code)) between 1 and 30),
  libelle text,
  -- null = nouvelle rubrique « à classer ».
  categorie text check (
    categorie is null or categorie in (
      'salaire_base', 'prime', 'heures_sup', 'indemnite', 'avantage',
      'charges_patronales', 'controle', 'volume', 'retenue', 'ignore'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table paie_rubriques is
  'Correspondance rubrique Sage → catégorie de coût (0159). controle = totaux Sage (brut, coût total, net) ; volume = heures/jours/présence ; retenue = part salariale, hors coût ; categorie nulle = à classer.';

insert into paie_rubriques (code, libelle, categorie) values
  ('10', 'Salaire mensuel', 'salaire_base'),
  ('100', 'Salaire horaire', 'salaire_base'),
  ('30', 'Prime d''ancienneté mensuelle', 'prime'),
  ('130', 'Prime d''ancienneté horaire', 'prime'),
  ('50', 'Sursalaire mensuel', 'prime'),
  ('140', 'Sursalaire horaire', 'prime'),
  ('120', 'Prime de panier mensuelle', 'prime'),
  ('150', 'Prime de panier horaire', 'prime'),
  ('820', 'Prime de responsabilité', 'prime'),
  ('1310', 'Prime de responsabilité imposable', 'prime'),
  ('800', 'Indemnités de transport', 'prime'),
  ('160', 'Heures supplémentaires 15 %', 'heures_sup'),
  ('170', 'Heures supplémentaires 50 %', 'heures_sup'),
  ('180', 'Heures supplémentaires 75 %', 'heures_sup'),
  ('1990', 'Congés payés', 'indemnite'),
  ('1020', 'Gratification', 'indemnite'),
  ('1350', 'Prime de fin de contrat', 'indemnite'),
  ('AVANTUR', 'Avantages en nature', 'avantage'),
  ('COTIPAT', 'Cotisations patronales', 'charges_patronales'),
  ('BRUT', 'Brut', 'controle'),
  ('COUT_TOTAL', 'Coût total employeur', 'controle'),
  ('NETPAIE', 'Net à payer', 'controle'),
  ('NETIMPO', 'Net imposable', 'controle'),
  ('COTISAL', 'Cotisations salariales', 'controle'),
  ('PAS_NETPAI', 'Net à payer avant impôt', 'controle'),
  ('PAS_MONTAN', 'Montant d''impôt PAS', 'controle'),
  ('S_NETSOCAL', 'Net social', 'controle'),
  ('TOTALHS', 'Total des heures supplémentaires', 'volume'),
  ('TOTALHTRAV', 'Total des heures travaillées', 'volume'),
  ('10010', 'Nombre d''heures travaillées', 'volume'),
  ('10000', 'Nombre de jours travaillés', 'volume'),
  ('PRESENCE', 'Présence', 'volume'),
  ('TOTALPRES', 'Total des heures de présence', 'volume'),
  ('ETP', 'Équivalent temps plein', 'volume'),
  ('TOTALHC', 'Total des heures complémentaires', 'volume'),
  ('TOTALHA', 'Total des heures d''absence', 'volume'),
  ('ABSENCE', 'Absence', 'volume'),
  ('COACMOIS', 'Congés acquis dans le mois', 'volume'),
  ('COPRIMOI', 'Congés pris dans le mois', 'volume'),
  ('TOTHANA', 'Total des heures analytique', 'volume'),
  ('510', 'Impôts sur salaire', 'retenue'),
  ('620', 'CNPS régime de retraite', 'retenue'),
  ('650', 'CMU', 'retenue'),
  ('890', 'Prêt scolaire', 'retenue'),
  ('900', 'Prêt', 'retenue'),
  ('850', 'Prêt divers', 'retenue'),
  ('910', 'Avance du mois', 'retenue'),
  ('950', 'Avance du mois', 'retenue'),
  ('930', 'Pharmacie', 'retenue'),
  ('TOTALLEG', 'Total allègement', 'ignore')
on conflict (code) do nothing;

-- 4. Ateliers de la Fiche de tâches → sections ---------------------------------
create table if not exists ateliers_vers_sections (
  atelier text primary key check (length(btrim(atelier)) between 1 and 80),
  libelle text,
  section_id uuid references sections(id) on delete set null,
  -- Bureau, direction, commercial… : employé de structure, sans section d'atelier.
  structure boolean not null default false,
  created_at timestamptz not null default now(),
  constraint atelier_section_ou_structure check (not (structure and section_id is not null))
);

comment on table ateliers_vers_sections is
  'Atelier d''origine (Fiche de tâches) → section de la plateforme (0159). structure = employé de structure, sans section. Ni section ni structure = à classer.';

insert into ateliers_vers_sections (atelier, libelle, structure) values
  ('bureau', 'Bureau', true),
  ('direction', 'Direction', true),
  ('commercial', 'Commercial', true)
on conflict (atelier) do nothing;

insert into ateliers_vers_sections (atelier, libelle) values
  ('bonneterie', 'Bonneterie'), ('serigraphie', 'Sérigraphie'), ('finition', 'Finition'),
  ('confection', 'Confection'), ('polo', 'Polo'), ('teinture', 'Teinture'),
  ('tricotage', 'Tricotage'), ('coupe', 'Coupe'), ('stock', 'Magasin et stock'),
  ('admin-usine', 'Administration usine'), ('maintenance', 'Maintenance'), ('chaudiere', 'Chaudière')
on conflict (atelier) do nothing;

-- Rattachement automatique quand le nom de la section de la plateforme est le même.
update ateliers_vers_sections a
set section_id = s.id
from sections s
where a.section_id is null and not a.structure
  and translate(lower(s.name), 'éèêëàâîïôöùûç', 'eeeeaaiioouuc') = translate(lower(a.libelle), 'éèêëàâîïôöùûç', 'eeeeaaiioouuc');

-- 5. Alertes ---------------------------------------------------------------------------
create table if not exists alertes (
  id uuid primary key default gen_random_uuid(),
  type text not null check (length(btrim(type)) between 1 and 60),
  gravite text not null default 'attention' check (gravite in ('info', 'attention', 'critique')),
  titre text not null check (length(btrim(titre)) between 1 and 200),
  detail text check (detail is null or length(detail) <= 2000),
  lien text check (lien is null or length(lien) <= 300),
  -- Module dont le droit « voir » ouvre l'alerte (matrice Rôles & permissions).
  module_cible text not null references modules(key) on update cascade,
  statut text not null default 'ouverte' check (statut in ('ouverte', 'traitee')),
  reference jsonb not null default '{}'::jsonb,
  cree_par uuid references app_users(id) on delete set null,
  cree_le timestamptz not null default now(),
  traitee_par uuid references app_users(id) on delete set null,
  traitee_le timestamptz,
  commentaire_traitement text check (commentaire_traitement is null or length(commentaire_traitement) <= 500)
);

create index if not exists idx_alertes_statut on alertes (statut, cree_le desc);
create index if not exists idx_alertes_module on alertes (module_cible);

comment on table alertes is
  'Alertes de la plateforme (0159) : livre de paie identique au précédent, écart anormal… Visibles par les rôles qui ont le droit « voir » du module_cible ; traitées avec le droit « valider ». Alimentera la zone alertes du tableau de bord.';

-- 6. Lots d'import ---------------------------------------------------------------------
alter table imports_personnel
  add column if not exists comparatif jsonb,
  add column if not exists empreinte text,
  add column if not exists motif_validation text check (motif_validation is null or length(motif_validation) <= 500),
  add column if not exists rubriques_a_classer text[] not null default '{}';

create index if not exists idx_imports_personnel_empreinte on imports_personnel (empreinte) where empreinte is not null;

-- 7. Droits et sécurité ----------------------------------------------------------------
alter table paie_rubriques enable row level security;
alter table ateliers_vers_sections enable row level security;
alter table alertes enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['paie_rubriques', 'ateliers_vers_sections'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (has_permission(''personnel'', ''view''))', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''personnel'', ''create'') or has_permission(''personnel'', ''modify''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''personnel'', ''modify'')) with check (has_permission(''personnel'', ''modify''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''personnel'', ''delete''))', t || '_delete', t);
  end loop;
end $$;

drop trigger if exists trg_set_updated_at on paie_rubriques;
create trigger trg_set_updated_at before update on paie_rubriques
  for each row execute function set_updated_at();

drop policy if exists alertes_select on alertes;
create policy alertes_select on alertes for select
  using (has_permission(module_cible, 'view'));
drop policy if exists alertes_insert on alertes;
create policy alertes_insert on alertes for insert
  with check (has_permission(module_cible, 'create') or has_permission(module_cible, 'validate'));
drop policy if exists alertes_update on alertes;
create policy alertes_update on alertes for update
  using (has_permission(module_cible, 'validate'))
  with check (has_permission(module_cible, 'validate'));
drop policy if exists alertes_delete on alertes;
create policy alertes_delete on alertes for delete
  using (has_permission(module_cible, 'delete'));
