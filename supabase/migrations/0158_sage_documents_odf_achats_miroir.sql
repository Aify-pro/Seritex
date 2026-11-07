-- ============================================================================
-- 0158 — Miroir Sage : ODF en cours et factures d'achat
-- ============================================================================
--
-- Objectif : voir dans Seritex (Paramètres > Intégration Sage) les pièces Sage
-- qui pilotent la fabrication et les achats, avant de décider comment les
-- exploiter. Système provisoire, en lecture seule, même principe que les
-- miroirs existants (0005, 0058, 0059, 0071).
--
-- Deux familles de pièces, dans deux tables génériques (une pièce par ligne
-- de `sage_documents_view`, ses lignes dans `sage_document_lines_view`) :
--
--   kind = 'odf'            Ordres de fabrication en cours. Dans Sage, un ODF est
--                           un bon de commande de vente (DO_Domaine 0, DO_Type 1)
--                           dont le numéro commence par « ODF ». Le commercial
--                           transforme le devis en ODF ; à la fin de la
--                           fabrication l'ODF est transformé en BL puis en
--                           facture, et disparaît alors de Sage (donc du miroir).
--   kind = 'facture_achat'  Factures fournisseurs (DO_Domaine 1, DO_Type 16 =
--                           facture, 17 = facture comptabilisée), sur une période
--                           récente seulement (voir scripts/sage-nas-sync).
--
-- Un troisième genre de pièce se branchera plus tard sans nouvelle table :
-- il suffit d'ajouter une valeur à la contrainte `kind` et une entrée dans
-- sync.js.
--
-- Droits : deux nouveaux modules de la matrice « Rôles & permissions »,
-- `odf_sage` et `achats_sage`, lecture seule. Les factures d'achat sont des
-- données financières : ouvertes à l'administrateur seulement au départ (à
-- élargir dans la matrice si besoin). Seul le job NAS écrit (service_role).
--
-- Montants en monnaie locale (F CFA).
-- ============================================================================

-- 1. Modules de droits -------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('odf_sage',    'ODF Sage',                'Vue des ordres de fabrication en cours (lecture Sage)', 174),
  ('achats_sage', 'Factures d''achat Sage',  'Vue des factures fournisseurs (lecture Sage)',          175)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id
from roles r
cross join modules m
where m.key in ('odf_sage', 'achats_sage')
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id
  and (
       (m.key = 'odf_sage'    and r.base_role in ('commercial', 'responsable_production', 'administrateur'))
    or (m.key = 'achats_sage' and r.base_role in ('administrateur'))
  );

-- 2. Pièces ------------------------------------------------------------------
create table if not exists sage_documents_view (
  kind text not null check (kind in ('odf', 'facture_achat')),
  sage_piece text not null,                    -- DO_Piece
  doc_type smallint not null,                  -- DO_Type brut (1 = bon de commande, 16/17 = factures d'achat)
  doc_date date,
  tiers_code text not null,                    -- DO_Tiers : client (ODF) ou fournisseur (achat)
  tiers_name text,                             -- F_COMPTET.CT_Intitule, copié pour éviter une jointure
  doc_ref text,                                -- DO_Ref : référence du client, ou n° de BL du fournisseur
  representant_no int,                         -- CO_No (sage_representants)
  total_ht numeric(14,2) not null default 0,
  total_ttc numeric(14,2) not null default 0,
  montant_regle numeric(14,2) not null default 0,
  reste_a_payer numeric(14,2) not null default 0,  -- net à payer − réglé (factures d'achat)
  date_livraison date,
  statut int,                                  -- DO_Statut brut, informatif
  cloture boolean not null default false,      -- DO_Cloture
  sage_modified_at timestamptz,                -- cbModification : sert au mode « données du jour »
  last_sync_at timestamptz not null default now(),
  primary key (kind, sage_piece)
);

create index if not exists idx_sage_documents_tiers on sage_documents_view (kind, tiers_code);
create index if not exists idx_sage_documents_date on sage_documents_view (kind, doc_date desc);

create table if not exists sage_document_lines_view (
  kind text not null,
  sage_piece text not null,
  line_no int not null,                        -- DL_No (identifiant Sage), à défaut DL_Ligne
  position int not null default 0,             -- DL_Ligne : ordre d'affichage
  ar_ref text,
  designation text not null,
  quantity numeric(14,3) not null default 0,   -- peut valoir 0 : ligne d'instruction (impression, broderie…)
  unit_price numeric(14,2) not null default 0,
  remise_pct numeric(5,2) not null default 0,
  tva_rate numeric(5,2),
  total_ht numeric(14,2) not null default 0,
  piece_devis text,                            -- DL_PieceDE : devis d'origine, quand Sage l'a conservé
  piece_commande text,                         -- DL_PieceBC : ODF d'origine (sur BL et factures)
  piece_bl text,                               -- DL_PieceBL : BL d'origine
  primary key (kind, sage_piece, line_no),
  foreign key (kind, sage_piece) references sage_documents_view (kind, sage_piece) on delete cascade
);

-- 3. Sécurité ----------------------------------------------------------------
alter table sage_documents_view enable row level security;
alter table sage_document_lines_view enable row level security;

create policy sage_documents_view_select on sage_documents_view for select using (
     (kind = 'odf'           and has_permission('odf_sage', 'view'))
  or (kind = 'facture_achat' and has_permission('achats_sage', 'view'))
);

create policy sage_document_lines_view_select on sage_document_lines_view for select using (
     (kind = 'odf'           and has_permission('odf_sage', 'view'))
  or (kind = 'facture_achat' and has_permission('achats_sage', 'view'))
);

revoke all on sage_documents_view, sage_document_lines_view from public, anon;
grant select on sage_documents_view, sage_document_lines_view to authenticated;

comment on table sage_documents_view is
  'Miroir des ODF en cours et des factures d''achat Sage (alimenté par scripts/sage-nas-sync). Lecture seule. ODF : remplacé à chaque passage ; factures d''achat : données du jour toutes les 15 min, rapprochement complet la nuit.';
comment on table sage_document_lines_view is
  'Lignes des pièces de sage_documents_view. Les lignes à quantité 0 (instructions d''impression, de broderie) sont conservées.';
