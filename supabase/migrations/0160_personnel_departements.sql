-- ============================================================================
-- 0160 — Personnel : table des départements (codes de la paie Sage)
-- ============================================================================
-- Dans le bulletin de salaire exporté de Sage, chaque salarié porte un code de
-- département (001, 002…). Plutôt que d'importer à chaque fois le tableau
-- « départements » en Excel, il vit dans la plateforme (Paramètres > Personnel >
-- Départements) :
--
--   1. departements         code Sage → libellé, et section de la plateforme
--                           ou « structure » (direction, commercial…). Sans
--                           section ni structure = « à classer ».
--   2. employes             + departement_code : le département de paie de
--                           l'employé, qui détermine sa section.
--
-- Les 40 départements du tableau fourni (departement.xlsx, 07/11/2026) sont
-- chargés. Un département est rattaché automatiquement à la section qui porte
-- le même nom ; direction et commercial sont de la structure ; tous les autres
-- restent « à classer » : la RH les classe elle-même.
-- ============================================================================

create table if not exists departements (
  code text primary key check (length(btrim(code)) between 1 and 10),
  libelle text not null check (length(btrim(libelle)) between 1 and 80),
  section_id uuid references sections(id) on delete set null,
  structure boolean not null default false,
  created_at timestamptz not null default now(),
  constraint departement_section_ou_structure check (not (structure and section_id is not null))
);

comment on table departements is
  'Départements de la paie Sage (0160) : code → libellé, et section de la plateforme ou structure. Ni section ni structure = à classer.';

alter table employes
  add column if not exists departement_code text references departements(code) on update cascade on delete set null;

create index if not exists idx_employes_departement on employes (departement_code);

comment on column employes.departement_code is
  'Département de paie Sage de l''employé (0160) : détermine sa section via la table departements.';

create temporary table _departements_depart (code text, libelle text, cle text);
insert into _departements_depart (code, libelle, cle) values
  ('001', 'Confection', 'confection'),
  ('002', 'Sérigraphie', 'serigraphie'),
  ('003', 'Teinture', 'teinture'),
  ('004', 'Tricotage', 'tricotage'),
  ('005', 'Coupe', 'coupe'),
  ('006', 'Administration', 'administration'),
  ('007', 'Broderie', 'broderie'),
  ('008', 'Magasinier', 'magasinier'),
  ('009', 'Gardien', 'gardien'),
  ('010', 'Recouvrement', 'recouvrement'),
  ('011', 'Secrétariat', 'secretariat'),
  ('012', 'Transit', 'transit'),
  ('013', 'Agent de sécurité', 'agent de securite'),
  ('014', 'Ressources humaines', 'ressources humaines'),
  ('015', 'Coursier', 'coursier'),
  ('016', 'Gestion des stocks', 'gestion des stocks'),
  ('017', 'Chauffeur', 'chauffeur'),
  ('018', 'Mécanique', 'mecanique'),
  ('019', 'Entretien de surface', 'entretien de surface'),
  ('020', 'Finition', 'finition'),
  ('021', 'Production', 'production'),
  ('022', 'Direction', 'direction'),
  ('023', 'Bonnetterie', 'bonnetterie'),
  ('024', 'Livraison', 'livraison'),
  ('025', 'Pao', 'pao'),
  ('026', 'Polo', 'polo'),
  ('027', 'Cuisinier', 'cuisinier'),
  ('028', 'Stock', 'stock'),
  ('029', 'Caméra sécurité', 'camera securite'),
  ('030', 'Chaudière', 'chaudiere'),
  ('031', 'Nettoyage', 'nettoyage'),
  ('032', 'Commercial', 'commercial'),
  ('033', 'Chimiste', 'chimiste'),
  ('034', 'Qualiticien', 'qualiticien'),
  ('035', 'Agent de recouvrement', 'agent de recouvrement'),
  ('036', 'Maquetiste', 'maquetiste'),
  ('037', 'Achats', 'achats'),
  ('038', 'Planification', 'planification'),
  ('039', 'Maintenance', 'maintenance'),
  ('040', 'Imprimerie', 'imprimerie');

insert into departements (code, libelle)
select code, libelle from _departements_depart
on conflict (code) do nothing;

-- Rattachement automatique : même nom qu'une section de la plateforme.
update departements d
set section_id = s.id
from _departements_depart t, sections s
where t.code = d.code and d.section_id is null and not d.structure
  and translate(lower(s.name), 'éèêëàâîïôöùûç', 'eeeeaaiioouuc') = t.cle;

-- Direction et commercial sont de la structure (décision du 2026-11-07).
update departements set structure = true, section_id = null where code in ('022', '032');

drop table _departements_depart;

alter table departements enable row level security;

drop policy if exists departements_select on departements;
create policy departements_select on departements for select using (has_permission('personnel', 'view'));
drop policy if exists departements_insert on departements;
create policy departements_insert on departements for insert
  with check (has_permission('personnel', 'create') or has_permission('personnel', 'modify'));
drop policy if exists departements_update on departements;
create policy departements_update on departements for update
  using (has_permission('personnel', 'modify')) with check (has_permission('personnel', 'modify'));
drop policy if exists departements_delete on departements;
create policy departements_delete on departements for delete using (has_permission('personnel', 'delete'));
