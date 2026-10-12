-- ============================================================================
-- 0124 — Prospection : journal des visites et fiches prospects (lot PR-1b)
-- ============================================================================
-- Plan : Seritex-plans/prospection-commerciale.md.
--
--   1. visites : le journal des passages chez un client ou un prospect, quel
--      que soit le canal (module, puis WhatsApp / Telegram avec l'API
--      d'ingestion, reprise de l'Excel). C'est la « dernière visite » qui règle
--      la rotation du planning, et le fil de suivi de chaque client.
--      company_id NULL = visite à rattacher (nom libre dans tiers_libelle) :
--      un prospect pas encore fiché, ou un code client inconnu de la reprise.
--   2. prospects_fiches : ce que l'étude de ciblage sait d'un prospect
--      (famille, axe d'offre, notes de potentiel / récurrence / besoins /
--      accessibilité…). Le prospect lui-même reste une fiche companies sans
--      sage_code (0122) : son étape (suspect → … → client) est
--      companies.prospection_etape, sa commerciale companies.commercial_attitre_id.
--
-- Droits (module Prospection) : tout le personnel du module lit le journal
-- (suivi par client, données professionnelles) ; chacun saisit et corrige ses
-- propres visites ; la direction (validate) saisit et corrige pour tous.
-- Fiches prospects : lecture module Prospection, écriture create / modify.
-- ============================================================================

-- 1. Journal des visites -------------------------------------------------------------
create table if not exists visites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  tiers_libelle text check (tiers_libelle is null or length(tiers_libelle) <= 200),
  app_user_id uuid not null references app_users(id) on delete restrict,
  jour date not null,
  nature text not null default 'visite'
    check (nature in ('visite', 'prospection', 'relance', 'appel', 'autre')),
  compte_rendu text not null check (length(compte_rendu) between 1 and 4000),
  resultat text check (resultat is null or length(resultat) <= 1000),
  prochaine_action text check (prochaine_action is null or length(prochaine_action) <= 500),
  montant_encaisse numeric(14,2) check (montant_encaisse is null or montant_encaisse >= 0),
  source text not null default 'application'
    check (source in ('application', 'whatsapp', 'telegram', 'email', 'reprise_excel')),
  -- Clé d'idempotence d'une reprise ou d'une ingestion (« AMY:123 »…).
  ref_externe text unique check (ref_externe is null or length(ref_externe) <= 120),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_id is not null or tiers_libelle is not null)
);

create index if not exists idx_visites_company_jour on visites (company_id, jour desc);
create index if not exists idx_visites_user_jour on visites (app_user_id, jour desc);
create index if not exists idx_visites_a_rattacher on visites (jour desc) where company_id is null;

create trigger trg_set_updated_at before update on visites
  for each row execute function set_updated_at();

-- Le nom du client est mémorisé sur la visite : si la fiche est supprimée
-- (prospect abandonné), la visite redevient « à rattacher » sous ce nom au
-- lieu de bloquer la suppression.
create or replace function visites_memoriser_tiers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is not null and new.tiers_libelle is null then
    select left(name, 200) into new.tiers_libelle from companies where id = new.company_id;
  end if;
  return new;
end;
$$;

create trigger trg_visites_memoriser_tiers before insert or update of company_id on visites
  for each row execute function visites_memoriser_tiers();

comment on table visites is
  'Journal des visites (0124) : un passage chez un client ou un prospect. company_id NULL = à rattacher (tiers_libelle). Source : module, WhatsApp, Telegram, e-mail, reprise Excel.';

alter table visites enable row level security;

create policy visites_select on visites for select
  using (has_permission('prospection', 'view'));

create policy visites_insert on visites for insert
  with check (
    has_permission('prospection', 'validate')
    or (app_user_id = auth.uid() and has_permission('prospection', 'create'))
  );

create policy visites_update on visites for update
  using (
    has_permission('prospection', 'validate')
    or (app_user_id = auth.uid() and has_permission('prospection', 'modify'))
  )
  with check (
    has_permission('prospection', 'validate')
    or (app_user_id = auth.uid() and has_permission('prospection', 'modify'))
  );

create policy visites_delete on visites for delete
  using (
    has_permission('prospection', 'validate')
    or (app_user_id = auth.uid() and has_permission('prospection', 'delete'))
  );

revoke all on visites from public, anon;
grant select, insert, update, delete on visites to authenticated;

-- 2. Fiches prospects ------------------------------------------------------------------
create table if not exists prospects_fiches (
  company_id uuid primary key references companies(id) on delete cascade,
  code text unique check (code is null or code ~ '^[A-Z0-9-]{2,20}$'),   -- PSP001…
  priorite smallint check (priorite between 1 and 5),                    -- 1 = la plus haute
  activite text check (activite is null or length(activite) <= 120),     -- « Mine d'or », « Banque »…
  famille text check (famille is null or length(famille) <= 80),         -- famille de l'étude de ciblage
  axe_offre text check (axe_offre in ('tenues_normees', 'tenues_goodies', 'goodies')),
  taille text check (taille in ('grand_compte', 'moyen_compte', 'petit_compte')),
  zone text check (zone is null or length(zone) <= 80),                  -- commune / zone, comme sage_sous_famille
  localisation text check (localisation is null or length(localisation) <= 200),
  pourquoi text check (pourquoi is null or length(pourquoi) <= 1000),
  offre text check (offre is null or length(offre) <= 1000),             -- tenues / produits à proposer
  contact_cible text check (contact_cible is null or length(contact_cible) <= 200),
  potentiel_libelle text check (potentiel_libelle is null or length(potentiel_libelle) <= 60),
  note_potentiel smallint check (note_potentiel between 0 and 5),
  note_recurrence smallint check (note_recurrence between 0 and 5),
  note_tenues smallint check (note_tenues between 0 and 5),
  note_goodies smallint check (note_goodies between 0 and 5),
  note_accessibilite smallint check (note_accessibilite between 0 and 5),
  fiabilite text check (fiabilite is null or length(fiabilite) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospects_fiches_zone on prospects_fiches (zone);

create trigger trg_set_updated_at before update on prospects_fiches
  for each row execute function set_updated_at();

comment on table prospects_fiches is
  'Fiche de ciblage d''un prospect (0124) : famille, axe d''offre, notes /5 (potentiel, récurrence, tenues normées, goodies, accessibilité). Le prospect est une fiche companies sans sage_code.';

alter table prospects_fiches enable row level security;

create policy prospects_fiches_select on prospects_fiches for select using (has_permission('prospection', 'view'));
create policy prospects_fiches_insert on prospects_fiches for insert with check (has_permission('prospection', 'create'));
create policy prospects_fiches_update on prospects_fiches for update
  using (has_permission('prospection', 'modify')) with check (has_permission('prospection', 'modify'));
create policy prospects_fiches_delete on prospects_fiches for delete using (has_permission('prospection', 'delete'));

revoke all on prospects_fiches from public, anon;
grant select, insert, update, delete on prospects_fiches to authenticated;
