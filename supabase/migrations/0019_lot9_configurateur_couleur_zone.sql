-- ============================================================================
-- Seritex — Module Production, lot 9 : configurateur couleur par zone +
-- palette + visuel produit
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (sections 8 et 9),
--        claude_cahier-des-charges-technique-production.md (lot 9)
-- ============================================================================
--
-- Ce lot ajoute, sur l'écran ODF :
--   - un choix de modèle de produit (product_models), nécessaire pour savoir
--     quel gabarit de zones appliquer ;
--   - un gabarit de zones par modèle de produit (product_zone_templates),
--     fixe pour un modèle donné (7 zones pour le t-shirt, section 8) ;
--   - une couleur par zone, choisie dans une palette de référence unique
--     (colors), indépendante du tissu (section 9) ;
--   - un commentaire libre de disponibilité (achats/stock, jamais validé par
--     le logiciel, section 9) ;
--   - le rattachement d'un visuel/maquette à l'ODF via MEDIA_FILE.
--
-- V1 actée par la section 8 : pas de détection de clic géométrique sur un
-- visuel vectoriel — la sélection se fait via une liste de zones nommées
-- (formulaire), le visuel étant une simple pièce jointe non cliquable.
--
-- Décisions pas explicitement tranchées, actées ici après vérification de
-- l'état réel du schéma et du code — à discuter si besoin :
--   - Rattachement du visuel : le cahier des charges propose une table de
--     jointure `product_model_media_files` (visuel par MODÈLE), mais la
--     section 8 du document de logique est plus précise et dit explicitement
--     que la maquette est jointe à l'ODF lui-même (chaque commande a sa
--     propre maquette client, un modèle générique "T-shirt" n'en a pas une
--     seule) — le document de logique fait autorité sur ce point, donc la
--     table de jointure créée ici est `production_order_media_files`
--     (même pattern que `sample_request_media_files`, 0003_media_library.sql).
--   - `production_orders.product_model_id` : colonne absente du schéma
--     actuel (aucun lot précédent ne l'a ajoutée — `product_model_id`
--     n'existe aujourd'hui que sur `quote_lines`, un devis pouvant en théorie
--     mélanger plusieurs modèles). Ajoutée ici, nullable, et remplie
--     automatiquement dans `accept_quote()` uniquement quand toutes les
--     lignes du devis pointent vers le même modèle ; sinon laissée null et à
--     renseigner manuellement sur l'écran ODF avant de pouvoir configurer les
--     zones. Backfill identique appliqué aux ODF déjà existants.
--   - Aucune page de gestion des `product_models` n'existait avant ce lot
--     (seulement consommés en lecture pour les devis et le catalogue Sage) —
--     une gestion minimale (nom, catégorie, actif) est ajoutée dans
--     Paramètres, nécessaire pour rattacher un gabarit de zones à un modèle.
--   - Table `colors` volontairement vide au démarrage : la vraie palette de
--     l'entreprise (30 à 40 couleurs avec code, section 9) n'est pas
--     inventée ici — à peupler depuis Paramètres > Palette de couleurs.
--   - Les 7 zones du t-shirt, elles, sont explicitement spécifiées par la
--     section 8 : seedées ici pour un modèle "T-shirt" (créé s'il n'existe
--     pas encore), de façon idempotente.
--   - Écriture directe (pas de RPC dédiée) pour zone colors / média / modèle
--     produit sur l'ODF, même pattern que `production_order_sections`/
--     `production_order_sizes` (lot 1) : autorisation via RLS
--     (`is_production_manager()`), pas de `has_permission()`/module RBAC —
--     cohérent avec le traitement existant des autres champs saisis en
--     brouillon.

-- ============================================================================
-- 1. PALETTE DE COULEURS (référentiel simple, section 9)
-- ============================================================================

create table colors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name)
);

-- ============================================================================
-- 2. GABARIT DE ZONES PAR MODÈLE DE PRODUIT (section 8)
-- ============================================================================

create table product_zone_templates (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  zone_key text not null,
  zone_label text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (product_model_id, zone_key)
);

create index idx_product_zone_templates_model on product_zone_templates(product_model_id);

-- ============================================================================
-- 3. RATTACHEMENT MODÈLE DE PRODUIT + NOTE DE DISPONIBILITÉ SUR L'ODF
-- ============================================================================

alter table production_orders
  add column product_model_id uuid references product_models(id),
  add column note_disponibilite_couleurs text;

-- Backfill des ODF existants : uniquement quand le devis d'origine ne
-- mélange qu'un seul modèle de produit sur ses lignes.
update production_orders po
set product_model_id = sub.only_model_id
from (
  select ql.quote_id, min(ql.product_model_id) as only_model_id
  from quote_lines ql
  where ql.product_model_id is not null
  group by ql.quote_id
  having count(distinct ql.product_model_id) = 1
) sub
where po.quote_id = sub.quote_id
  and po.product_model_id is null;

create index idx_production_orders_product_model on production_orders(product_model_id);

-- accept_quote() : reprise à l'identique (0009_odf_cycle_de_vie_sections_
-- dynamiques.sql) + calcul du modèle de produit unique le cas échéant.
create or replace function accept_quote(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_total_qty int;
  v_product_model_id uuid;
  v_po_id uuid;
  v_ref text;
begin
  select * into v_quote from quotes where id = p_quote_id;
  if not found then
    raise exception 'devis introuvable';
  end if;

  if not (is_commercial_or_above() or is_client_of(v_quote.company_id)) then
    raise exception 'accès refusé : ce devis ne vous appartient pas';
  end if;

  if v_quote.status <> 'envoye' then
    raise exception 'ce devis n''est pas en attente de validation (statut actuel : %)', v_quote.status;
  end if;

  select coalesce(sum(quantity), 0) into v_total_qty from quote_lines where quote_id = p_quote_id;

  -- Modèle de produit rempli automatiquement seulement si le devis ne
  -- mélange pas plusieurs modèles (lot 9) — sinon laissé null, à choisir
  -- manuellement sur l'écran ODF avant de configurer les zones/couleurs.
  select min(product_model_id) into v_product_model_id
  from quote_lines
  where quote_id = p_quote_id and product_model_id is not null
  having count(distinct product_model_id) = 1;

  v_ref := 'OF-' || to_char(now(), 'YYYYMMDD') || '-' || substr(p_quote_id::text, 1, 4);

  update quotes set status = 'accepte' where id = p_quote_id;
  update requests set status = 'acceptee' where id = v_quote.request_id;

  -- L'ordre de fabrication est créé au statut 'brouillon' (défaut de la
  -- colonne) : à charge du responsable production de choisir les sections
  -- et les quantités par taille, puis de le soumettre (submit_production_
  -- order()) avant validation (validate_production_order()) — plus de
  -- gamme opératoire figée par produit.
  insert into production_orders (reference, quote_id, company_id, total_quantity, product_model_id)
  values (v_ref, p_quote_id, v_quote.company_id, v_total_qty, v_product_model_id)
  returning id into v_po_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, 'envoye', 'accepte', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'accept_quote', 'quote', p_quote_id, jsonb_build_object('production_order_id', v_po_id));

  return v_po_id;
end;
$$;

-- ============================================================================
-- 4. COULEUR CHOISIE PAR ZONE, PAR ODF (section 8)
-- ============================================================================

create table production_order_zone_colors (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  zone_key text not null,
  color_id uuid not null references colors(id),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (production_order_id, zone_key)
);

create index idx_production_order_zone_colors_odf on production_order_zone_colors(production_order_id);
create index idx_production_order_zone_colors_color on production_order_zone_colors(color_id);

-- ============================================================================
-- 5. VISUEL/MAQUETTE JOINT À L'ODF (MEDIA_FILE, section 8)
-- ============================================================================

create table production_order_media_files (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  media_file_id uuid not null references media_files(id) on delete cascade,
  added_by uuid references app_users(id),
  added_at timestamptz not null default now(),
  unique (production_order_id, media_file_id)
);

create index idx_production_order_media_files_odf on production_order_media_files(production_order_id);
create index idx_production_order_media_files_media on production_order_media_files(media_file_id);

-- ============================================================================
-- 6. SÉCURITÉ : RLS
-- ============================================================================

alter table colors enable row level security;
alter table product_zone_templates enable row level security;
alter table production_order_zone_colors enable row level security;
alter table production_order_media_files enable row level security;

-- colors / product_zone_templates : référentiel interne (comme sections,
-- routing_templates) — lisible par tout le staff, écrit par
-- responsable_production/administrateur, supprimé par administrateur
-- uniquement (même prudence que product_zones_delete, 0002_rls.sql).
create policy colors_select on colors for select using (is_staff());
create policy colors_write on colors for insert with check (is_production_manager());
create policy colors_update on colors for update using (is_production_manager()) with check (is_production_manager());
create policy colors_delete on colors for delete using (is_admin());

create policy product_zone_templates_select on product_zone_templates for select using (is_staff());
create policy product_zone_templates_write on product_zone_templates for insert with check (is_production_manager());
create policy product_zone_templates_update on product_zone_templates for update using (is_production_manager()) with check (is_production_manager());
create policy product_zone_templates_delete on product_zone_templates for delete using (is_admin());

-- production_order_zone_colors / production_order_media_files : même
-- lecture que production_order_sections/sizes (lot 1), écriture réservée à
-- responsable_production/administrateur.
create policy production_order_zone_colors_select on production_order_zone_colors for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_zone_colors_write on production_order_zone_colors for insert
  with check (is_production_manager());
create policy production_order_zone_colors_delete on production_order_zone_colors for delete
  using (is_production_manager());

create policy production_order_media_files_select on production_order_media_files for select
  using (is_production_manager() or current_role_name() = 'commercial');
create policy production_order_media_files_write on production_order_media_files for insert
  with check (is_production_manager());
create policy production_order_media_files_delete on production_order_media_files for delete
  using (is_production_manager());

-- ============================================================================
-- 7. SEED : GABARIT DE ZONES DU T-SHIRT (7 zones, section 8 — idempotent)
-- ============================================================================

insert into product_models (name, active)
select 'T-shirt', true
where not exists (select 1 from product_models where name = 'T-shirt');

with tshirt as (
  select id from product_models where name = 'T-shirt' limit 1
)
insert into product_zone_templates (product_model_id, zone_key, zone_label, display_order)
select tshirt.id, z.zone_key, z.zone_label, z.ord
from tshirt,
  (values
    ('corps_avant', 'Corps avant', 1),
    ('corps_arriere', 'Corps arrière', 2),
    ('col', 'Col', 3),
    ('manche_gauche', 'Manche gauche', 4),
    ('manche_droite', 'Manche droite', 5),
    ('bout_manche_gauche', 'Bout de manche gauche', 6),
    ('bout_manche_droit', 'Bout de manche droit', 7)
  ) as z(zone_key, zone_label, ord)
where not exists (
  select 1 from product_zone_templates pzt where pzt.product_model_id = tshirt.id
);
