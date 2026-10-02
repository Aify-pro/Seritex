-- ============================================================================
-- 0071 — Devis Sage en cours (miroir) et récupération dans une demande
-- ============================================================================
--
-- Objectif : éviter la double saisie. Les devis se créent dans Sage ; depuis
-- une demande, Seritex liste les devis Sage EN COURS du client et préremplit le
-- formulaire de devis à partir de celui qu'on choisit.
--
-- « En cours » = devis Sage (documents de vente, type devis) qui existent
-- encore comme devis : tant qu'il n'est pas transformé en commande (ou purgé
-- après refus par le service commercial), il reste dans le miroir. Le job de
-- synchronisation du NAS (scripts/sage-nas-sync, toutes les 15 minutes) remplace
-- le miroir à chaque passage : un devis qui disparaît de Sage disparaît ici.
--
-- Même principe que les autres miroirs Sage (0005, 0058, 0059) : Seritex ne
-- les écrit jamais, seul le job technique y écrit (service_role) ; lecture pour
-- le commercial et au-dessus.
--
-- Montants toujours en monnaie locale (F CFA) : pour un devis Sage en devise
-- étrangère, devise_no signale la devise d'origine mais les prix repris sont
-- ceux convertis par Sage.
--
-- quotes.sage_piece garde le lien vers le devis Sage d'origine : empêche de
-- l'importer deux fois et permet de l'afficher dans la demande et la fiche
-- devis. Le numéro Sage n'est PAS imprimé sur la proforma PDF. Le lien survit à
-- la disparition du devis du miroir (transformation en commande côté Sage) :
-- c'est une simple référence texte, sans clé étrangère.
-- ============================================================================

create table if not exists sage_quotes_view (
  sage_piece text primary key,                 -- DO_Piece
  doc_date date,
  client_ref text,                             -- DO_Ref : référence du client (bon de commande…)
  client_sage_code text not null,              -- DO_Tiers = companies.sage_code
  representant_no int,                         -- CO_No (sage_representants)
  devise_no int,                               -- DO_Devise (0 = devise locale)
  total_ht numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  date_livraison date,
  statut int,                                  -- DO_Statut brut, informatif
  last_sync_at timestamptz not null default now()
);

create index if not exists idx_sage_quotes_client on sage_quotes_view (client_sage_code);

create table if not exists sage_quote_lines_view (
  sage_piece text not null references sage_quotes_view(sage_piece) on delete cascade,
  line_no int not null,
  position int not null default 0,             -- ordre d'affichage dans le devis
  ar_ref text,
  designation text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,           -- prix unitaire HT avant remise
  remise_pct numeric(5,2) not null default 0,  -- remise effective déduite du montant HT de la ligne
  tva_rate numeric(5,2),
  total_ht numeric(14,2) not null default 0,
  primary key (sage_piece, line_no)
);

alter table sage_quotes_view enable row level security;
alter table sage_quote_lines_view enable row level security;

create policy sage_quotes_view_select on sage_quotes_view for select using (is_commercial_or_above());
create policy sage_quote_lines_view_select on sage_quote_lines_view for select using (is_commercial_or_above());

revoke all on sage_quotes_view, sage_quote_lines_view from public, anon;
grant select on sage_quotes_view, sage_quote_lines_view to authenticated;

comment on table sage_quotes_view is
  'Miroir des devis Sage en cours (alimenté par scripts/sage-nas-sync). Lecture seule ; remplacé à chaque synchronisation.';

-- ----------------------------------------------------------------------------
-- Lien devis Seritex → devis Sage d'origine
-- ----------------------------------------------------------------------------

alter table quotes add column if not exists sage_piece text;

create unique index if not exists quotes_sage_piece_unique on quotes (sage_piece) where sage_piece is not null;

comment on column quotes.sage_piece is
  'N° du devis Sage dont ce devis a été récupéré (référence texte, sans clé étrangère : le devis peut disparaître de Sage). Non imprimé sur le PDF.';
