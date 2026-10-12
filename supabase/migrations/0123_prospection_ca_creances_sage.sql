-- ============================================================================
-- 0123 — Prospection : chiffre d'affaires et créances par client (miroir Sage)
-- ============================================================================
-- Lot PR-1a (plan : Seritex-plans/prospection-commerciale.md). Le planning des
-- visites classe les clients comme l'Excel PLANNING_FINAL : score d'importance
-- = CA de l'année, CA de l'année précédente, devis en cours, créance à
-- recouvrer. Les devis en cours sont déjà copiés (sage_quotes_view, 0071) ;
-- ce lot ajoute :
--
--   1. sage_client_ca : CA facturé par client et par année civile (les trois
--      dernières années), factures et factures comptabilisées de Sage, avoirs
--      déduits.
--   2. sage_client_creances : reste à encaisser par client (net à payer −
--      montant réglé des factures Sage). Négatif = client créditeur.
--   3. prospection_indicateurs_clients : une ligne par client Sage avec CA de
--      l'année, CA de l'année précédente, devis en cours, dernier devis,
--      créance et dernière facture — ce que lira le moteur de planning.
--
-- Même principe que les autres miroirs Sage : alimentés uniquement par le job
-- du NAS (scripts/sage-nas-sync, clé service_role), remplacés à chaque passage,
-- jamais écrits par Seritex. Montants en F CFA. Lecture réservée au module
-- Prospection (données financières).
-- ============================================================================

-- 1. CA par client et par année ------------------------------------------------
create table if not exists sage_client_ca (
  client_sage_code text not null,             -- DO_Tiers = companies.sage_code
  annee int not null check (annee between 2000 and 2100),
  ca_ht numeric(16,2) not null default 0,
  ca_ttc numeric(16,2) not null default 0,
  nb_factures int not null default 0,
  derniere_facture date,
  last_sync_at timestamptz not null default now(),
  primary key (client_sage_code, annee)
);

comment on table sage_client_ca is
  'Miroir Sage (0123) : CA facturé par client et par année civile (factures DO_Type 6/7, avoirs déduits), trois dernières années. Alimenté par scripts/sage-nas-sync.';

-- 2. Créances par client --------------------------------------------------------
create table if not exists sage_client_creances (
  client_sage_code text primary key,          -- DO_Tiers = companies.sage_code
  montant_ttc numeric(16,2) not null,         -- négatif = client créditeur
  nb_factures int not null default 0,         -- factures non soldées
  plus_ancienne date,                         -- date de la plus ancienne facture non soldée
  last_sync_at timestamptz not null default now()
);

comment on table sage_client_creances is
  'Miroir Sage (0123) : reste à encaisser par client (net à payer − montant réglé des factures). Alimenté par scripts/sage-nas-sync.';

alter table sage_client_ca enable row level security;
alter table sage_client_creances enable row level security;

create policy sage_client_ca_select on sage_client_ca for select using (has_permission('prospection', 'view'));
create policy sage_client_creances_select on sage_client_creances for select using (has_permission('prospection', 'view'));

revoke all on sage_client_ca, sage_client_creances from public, anon;
grant select on sage_client_ca, sage_client_creances to authenticated;

-- 3. Indicateurs par client -------------------------------------------------------
-- security_invoker : la vue applique les droits du lecteur sur chaque table
-- (companies, miroirs Sage). « Année » = année civile à Abidjan.
create or replace view prospection_indicateurs_clients
with (security_invoker = on) as
with an as (
  select extract(year from (now() at time zone 'Africa/Abidjan'))::int as n
),
devis as (
  select client_sage_code, sum(total_ttc) as total_ttc, count(*) as nb, max(doc_date) as dernier
  from sage_quotes_view
  group by client_sage_code
)
select
  c.id as company_id,
  c.sage_code,
  coalesce(ca_n.ca_ttc, 0) as ca_annee_ttc,
  coalesce(ca_p.ca_ttc, 0) as ca_annee_precedente_ttc,
  coalesce(d.total_ttc, 0) as devis_en_cours_ttc,
  coalesce(d.nb, 0)::int as nb_devis_en_cours,
  d.dernier as dernier_devis,
  coalesce(cr.montant_ttc, 0) as creance_ttc,
  cr.plus_ancienne as creance_plus_ancienne,
  greatest(ca_n.derniere_facture, ca_p.derniere_facture) as derniere_facture
from companies c
cross join an
left join sage_client_ca ca_n on ca_n.client_sage_code = c.sage_code and ca_n.annee = an.n
left join sage_client_ca ca_p on ca_p.client_sage_code = c.sage_code and ca_p.annee = an.n - 1
left join devis d on d.client_sage_code = c.sage_code
left join sage_client_creances cr on cr.client_sage_code = c.sage_code
where c.sage_code is not null;

revoke all on prospection_indicateurs_clients from public, anon;
grant select on prospection_indicateurs_clients to authenticated;

comment on view prospection_indicateurs_clients is
  'Par client Sage (0123) : CA de l''année et de l''année précédente, devis Sage en cours, créance, dernière facture. Entrées du score d''importance du planning.';
