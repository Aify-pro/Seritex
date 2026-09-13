-- ============================================================================
-- Seritex — Référentiel de textiles, rattaché au catalogue Sage
-- Réf. : lot C1 du chantier ODF — préalable aux ordres de tracé par textile
-- ============================================================================
--
-- POURQUOI UN RÉFÉRENTIEL PLUTÔT QU'UNE DÉTECTION AUTOMATIQUE
-- Dans Sage, un tissu est référencé par coloris : un jersey 180g décliné en
-- huit couleurs, ce sont huit codes articles. Pour le placement, c'est UN
-- textile — même composition, même laize, même comportement au traçage.
-- La relation est donc N articles Sage → 1 textile.
--
-- C'est ce qui condamne la détection purement automatique : elle sait repérer
-- les articles de catégorie 'tissu' (stock_item_view le dit déjà), mais rien
-- dans un code article ne dit que huit références sont le même tissu en huit
-- coloris. Une synchro qui créerait un textile par article rendrait huit
-- ordres de tracé là où il en faut un — exactement l'incohérence que le
-- regroupement par textile vise à éviter.
--
-- D'où : liaison manuelle, assistée par la détection. La synchro ne crée
-- rien, elle signale — l'écran met en avant les articles 'tissu' non encore
-- rattachés, pour que rien ne se perde en silence ni ne se crée à l'insu de
-- personne.

-- ============================================================================
-- 1. LES TEXTILES
-- ============================================================================
create table if not exists textiles (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  composition text,
  -- Les trois caractéristiques qui gouvernent le placement, et que la fiche
  -- de placement porte aujourd'hui en saisie libre (tissu_type, grammage,
  -- laize_utile_cm) : les tenir ici permettra de les pré-remplir plutôt que
  -- de les redemander à chaque ordre de tracé.
  grammage numeric,
  laize_cm numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table textiles enable row level security;

create policy textiles_select on textiles for select using (is_staff());
create policy textiles_write on textiles for insert with check (is_production_manager());
create policy textiles_update on textiles for update using (is_production_manager()) with check (is_production_manager());
create policy textiles_delete on textiles for delete using (is_admin());

revoke all on textiles from public, anon;
grant select, insert, update, delete on textiles to authenticated;

-- ============================================================================
-- 2. LES CODES ARTICLES SAGE RATTACHÉS
-- ============================================================================
-- `sage_reference` sans clé étrangère vers stock_item_view : ce miroir est
-- reconstruit à chaque synchronisation, et une contrainte le rendrait
-- impossible à rafraîchir. Le rapprochement se fait à l'affichage.
--
-- `color_id` facultatif : c'est lui qui, une fois renseigné, permettra de
-- savoir quel rouleau consommer pour une ligne d'ODF donnée — et de
-- pré-remplir les mouvements de stock du lot 10 comme les pesées du lot 7,
-- aujourd'hui rattachés à un article choisi à la main.
create table if not exists textile_sage_articles (
  textile_id uuid not null references textiles(id) on delete cascade,
  sage_reference text not null,
  color_id uuid references colors(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (textile_id, sage_reference)
);

-- Un article Sage n'appartient qu'à un seul textile : sans cette unicité, le
-- regroupement des ordres de tracé deviendrait ambigu au premier doublon.
create unique index if not exists idx_textile_sage_articles_reference
  on textile_sage_articles(sage_reference);

create index if not exists idx_textile_sage_articles_textile
  on textile_sage_articles(textile_id);

alter table textile_sage_articles enable row level security;

create policy textile_sage_articles_select on textile_sage_articles for select using (is_staff());
create policy textile_sage_articles_write on textile_sage_articles for insert with check (is_production_manager());
create policy textile_sage_articles_update on textile_sage_articles for update using (is_production_manager()) with check (is_production_manager());
create policy textile_sage_articles_delete on textile_sage_articles for delete using (is_production_manager());

revoke all on textile_sage_articles from public, anon;
grant select, insert, update, delete on textile_sage_articles to authenticated;

-- ============================================================================
-- 3. LE TEXTILE D'UN MODÈLE
-- ============================================================================
-- Un modèle a un tissu principal et un seul : un polo en piqué avec col
-- côtelé reste « piqué », le col relevant de la nomenclature (lot 12) et non
-- du placement. C'est ce champ qui déterminera, au lot C3, dans quel ordre de
-- tracé tombe chaque ligne d'un ODF.
alter table product_models
  add column if not exists textile_id uuid references textiles(id);

comment on column product_models.textile_id is
  'Tissu principal du modèle. Détermine le regroupement des ordres de tracé : une commande mêlant plusieurs textiles donne un ordre de tracé par textile, jamais un seul mêlant des géométries incompatibles.';
