-- ============================================================================
-- Seritex — Référentiel de tailles, et disponibilité tailles/couleurs par
-- modèle de produit
-- Réf. : retour métier du 13/09/2026 — « modifier Paramètres > Palette de
--        couleurs, l'appeler Couleurs et Tailles [...] ensuite dans la
--        nomenclature de chaque produit on mettra sa disponibilité en taille
--        et en couleurs »
-- ============================================================================
--
-- Les tailles étaient huit valeurs codées en dur ('XS'...'XXXL', 'Autre'),
-- imposées à la fois au patronnage (clés de repartition_par_couche) et à
-- l'ODF (contrainte CHECK posée par le lot 2). Elles deviennent un
-- référentiel alimenté depuis Paramètres, comme les couleurs.
--
-- POURQUOI UNE CLÉ COMPOSÉE ET NON LE SEUL LIBELLÉ
-- Le lot 2 avait délibérément aligné les tailles de l'ODF sur celles du
-- patronnage par une liste fixe, parce que du texte libre rendait le
-- rapprochement fragile — « Large » ne correspondrait jamais à « L », et le
-- contrôle de couverture qui conditionne la validation d'un ODF échouerait
-- en silence. Ce raisonnement reste vrai : on ne supprime pas ce garde-fou,
-- on le déplace du code vers la donnée.
--
-- Mais un simple libellé ne suffit pas : un « M » homme et un « M » femme
-- sont deux tailles différentes, et les quantités par taille voyagent
-- partout en JSON dont les clés sont du texte (repartition_par_couche,
-- mention_surplus_traces, quantités de clôture de matelas). D'où `cle`,
-- calculée « Groupe/Libellé », unique, stable, et seule valeur stockée
-- ailleurs dans le schéma. Les écrans, eux, affichent le libellé sous son
-- groupe.

-- ============================================================================
-- 1. LE RÉFÉRENTIEL DE TAILLES
-- ============================================================================
create table if not exists sizes (
  id uuid primary key default gen_random_uuid(),
  -- Groupe d'usage : Homme, Femme, Enfant, Mixte… texte libre plutôt qu'un
  -- enum, pour ne pas imposer une migration à chaque nouvelle gamme.
  groupe text not null,
  libelle text not null,
  -- Clé fonctionnelle, seule valeur reprise par production_order_sizes et par
  -- les répartitions du patronnage. Générée : jamais saisie, jamais divergente.
  cle text generated always as (groupe || '/' || libelle) stored,
  -- L'ordre d'une grille de tailles n'est ni alphabétique ni numérique
  -- (XS < S < M < L < XL) : il doit être porté explicitement.
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (groupe, libelle)
);

create unique index if not exists idx_sizes_cle on sizes(cle);
create index if not exists idx_sizes_groupe_ordre on sizes(groupe, display_order);

comment on column sizes.cle is
  'Clé fonctionnelle « Groupe/Libellé », générée et unique. C''est elle — jamais le libellé seul — que stockent production_order_sizes.taille et les répartitions par taille du patronnage : un « M » homme et un « M » femme sont deux tailles distinctes.';

alter table sizes enable row level security;

-- Mêmes droits que colors : référentiel interne, lu par tout le staff, écrit
-- par la production, supprimé par l'administrateur seul.
create policy sizes_select on sizes for select using (is_staff());
create policy sizes_write on sizes for insert with check (is_production_manager());
create policy sizes_update on sizes for update using (is_production_manager()) with check (is_production_manager());
create policy sizes_delete on sizes for delete using (is_admin());

revoke all on sizes from public, anon;
grant select, insert, update, delete on sizes to authenticated;

-- ============================================================================
-- 2. DISPONIBILITÉ PAR MODÈLE DE PRODUIT
-- ============================================================================
-- Un t-shirt homme ne se décline pas dans les tailles enfant, et tous les
-- modèles n'existent pas dans toutes les couleurs. Ces deux tables disent ce
-- qui est proposable ; l'écran de dispatching d'un ODF s'y limitera.
--
-- Absence de ligne = aucune restriction déclarée, donc tout le référentiel
-- actif est proposé. C'est volontaire : sans cette règle, la mise en service
-- du référentiel rendrait d'un coup tous les modèles existants incomplets.
create table if not exists product_model_sizes (
  product_model_id uuid not null references product_models(id) on delete cascade,
  size_id uuid not null references sizes(id) on delete cascade,
  primary key (product_model_id, size_id)
);

create table if not exists product_model_colors (
  product_model_id uuid not null references product_models(id) on delete cascade,
  color_id uuid not null references colors(id) on delete cascade,
  primary key (product_model_id, color_id)
);

create index if not exists idx_product_model_sizes_model on product_model_sizes(product_model_id);
create index if not exists idx_product_model_colors_model on product_model_colors(product_model_id);

comment on table product_model_sizes is
  'Tailles dans lesquelles un modèle existe. Aucune ligne pour un modèle = aucune restriction déclarée : tout le référentiel actif reste proposable.';

alter table product_model_sizes enable row level security;
alter table product_model_colors enable row level security;

create policy product_model_sizes_select on product_model_sizes for select using (is_staff());
create policy product_model_sizes_write on product_model_sizes for insert with check (is_production_manager());
create policy product_model_sizes_delete on product_model_sizes for delete using (is_production_manager());

create policy product_model_colors_select on product_model_colors for select using (is_staff());
create policy product_model_colors_write on product_model_colors for insert with check (is_production_manager());
create policy product_model_colors_delete on product_model_colors for delete using (is_production_manager());

revoke all on product_model_sizes from public, anon;
revoke all on product_model_colors from public, anon;
grant select, insert, delete on product_model_sizes to authenticated;
grant select, insert, delete on product_model_colors to authenticated;

-- ============================================================================
-- 3. LE MODULE DE DROITS SUIT
-- ============================================================================
-- L'écran « Palette de couleurs » devient « Couleurs et tailles ». Le module
-- de droits n'existait pas pour les couleurs (l'écran était ouvert à
-- responsable_production/administrateur en dur) : on n'en crée pas un
-- aujourd'hui pour ne pas masquer l'entrée de menu à des rôles qui y ont
-- accès. Ce commentaire tient lieu de trace de la décision.
