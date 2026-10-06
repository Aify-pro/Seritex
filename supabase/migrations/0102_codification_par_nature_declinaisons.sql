-- ============================================================================
-- 0102 — Codification par nature et déclinaisons de tous les articles
-- ============================================================================
--
-- Décisions du 2026-10-06 : matières premières et consommables se vendent,
-- ils ont donc des déclinaisons et une codification propres.
--
--   1. coding_rules : une règle de codification par nature (pf, mp,
--      consommable) — segments, longueur maximale, séparateur. La règle des
--      produits finis reprend coding_settings (conservée, plus lue).
--        pf          : modèle, matière, grammage, couleur, taille (inchangé)
--        mp          : matière, grammage, couleur   (ex. JE180BLA)
--        consommable : modèle, couleur, dimension   (ex. COBO0001BLA12)
--   2. Un article tissu porte plusieurs grammages (textiles.product_model_id
--      n'est plus unique) : « Jersey » se décline en 160 / 180 / 200 g. Le
--      regroupement des tissus existants viendra ensuite (proposition
--      validée par l'utilisateur).
--   3. article_dimensions : axe libre d'un consommable (12 mm, 50 m, S…).
--   4. product_variants accepte d'autres axes : textile, couleur, taille
--      deviennent facultatifs, dimension s'ajoute ; les axes requis
--      dépendent de la nature (contrôle par déclencheur). Produits finis :
--      rien ne change.
--   5. ensure_variants() délègue les natures mp et consommable à
--      ensure_article_variants() : tissu = grammages × couleurs, consommable
--      = couleurs × dimensions (un axe vide est ignoré).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÈGLES DE CODIFICATION PAR NATURE
-- ----------------------------------------------------------------------------

create table if not exists coding_rules (
  nature text primary key check (nature in ('pf', 'mp', 'consommable')),
  segments text[] not null,
  longueur_max int not null default 18 check (longueur_max between 8 and 40),
  separateur text not null default '' check (char_length(separateur) <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint coding_rules_segments_valides check (
    text_array_sans_doublon(segments)
    and cardinality(segments) > 0
    and case nature
      when 'pf' then segments <@ array['modele', 'matiere', 'grammage', 'couleur', 'taille'] and 'modele' = any(segments)
      when 'mp' then segments <@ array['modele', 'matiere', 'grammage', 'couleur']
      else segments <@ array['modele', 'couleur', 'dimension'] and 'modele' = any(segments)
    end
  )
);

insert into coding_rules (nature, segments, longueur_max, separateur)
select 'pf', segments, longueur_max, separateur from coding_settings limit 1
on conflict (nature) do nothing;
insert into coding_rules (nature, segments) values
  ('pf', array['modele', 'matiere', 'grammage', 'couleur', 'taille']),
  ('mp', array['matiere', 'grammage', 'couleur']),
  ('consommable', array['modele', 'couleur', 'dimension'])
on conflict (nature) do nothing;

comment on table coding_rules is
  'Règle de codification des déclinaisons, par nature d''article (pf, mp, consommable) : segments dans l''ordre, longueur maximale (18 = limite Sage), séparateur. Remplace coding_settings (règle unique des produits finis).';

alter table coding_rules enable row level security;
drop policy if exists coding_rules_select on coding_rules;
create policy coding_rules_select on coding_rules for select using (is_staff());
drop policy if exists coding_rules_update on coding_rules;
create policy coding_rules_update on coding_rules for update using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- 2. PLUSIEURS GRAMMAGES PAR ARTICLE TISSU
-- ----------------------------------------------------------------------------

alter table textiles drop constraint if exists textiles_product_model_id_key;
create index if not exists idx_textiles_product_model on textiles(product_model_id);

comment on column textiles.product_model_id is
  'Article (fiche commune) de ce tissu. Un article tissu peut porter plusieurs grammages (une ligne par grammage) : « Jersey » → 160, 180, 200 g.';

create or replace function product_models_sync_technique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name or new.active is distinct from old.active or new.unite is distinct from old.unite then
    update textiles t
    set nom = case when (select count(*) from textiles x where x.product_model_id = new.id) > 1
                   then new.name || coalesce(' ' || trim(to_char(t.grammage, 'FM99990')) || ' g', '')
                   else new.name end,
        active = new.active
    where t.product_model_id = new.id;
    update consumables set designation = new.name, actif = new.active, unite = new.unite
    where product_model_id = new.id
      and (designation is distinct from new.name or actif is distinct from new.active or unite is distinct from new.unite);
  end if;
  return new;
end;
$$;



-- Ajoute un grammage à un article tissu : une ligne textile de plus, qui
-- reprend la composition et la matière de l'article.
create or replace function add_textile_grammage(p_model_id uuid, p_grammage numeric, p_code_court text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model product_models;
  v_ref textiles;
  v_id uuid;
  v_code text := upper(nullif(btrim(coalesce(p_code_court, '')), ''));
begin
  if not (is_production_manager() or has_permission('articles', 'modify')) then
    raise exception 'accès refusé : modification des articles non autorisée';
  end if;
  select * into v_model from product_models where id = p_model_id;
  if v_model.id is null or v_model.nature <> 'mp' then
    raise exception 'un grammage s''ajoute à un article tissu (matière première)';
  end if;
  if p_grammage is null or p_grammage <= 0 then
    raise exception 'grammage invalide';
  end if;
  if exists (select 1 from textiles where product_model_id = p_model_id and grammage = p_grammage) then
    raise exception 'ce grammage existe déjà pour cet article';
  end if;
  select * into v_ref from textiles where product_model_id = p_model_id order by created_at limit 1;
  insert into textiles (nom, composition, grammage, matiere_id, code_court, product_model_id, active)
  values (v_model.name || ' ' || trim(to_char(p_grammage, 'FM99990')) || ' g', v_ref.composition, p_grammage,
          coalesce(v_ref.matiere_id, v_model.matiere_id), coalesce(v_code, trim(to_char(p_grammage, 'FM99990'))), p_model_id, true)
  returning id into v_id;
  -- Le premier grammage garde son nom d'origine ; dès le deuxième, tous
  -- prennent « Article N g ».
  update textiles t set nom = v_model.name || coalesce(' ' || trim(to_char(t.grammage, 'FM99990')) || ' g', '')
  where t.product_model_id = p_model_id;
  return v_id;
end;
$$;

revoke all on function add_textile_grammage(uuid, numeric, text) from public, anon;
grant execute on function add_textile_grammage(uuid, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. DIMENSIONS D'UN CONSOMMABLE
-- ----------------------------------------------------------------------------

create table if not exists article_dimensions (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  libelle text not null check (btrim(libelle) <> ''),
  code_court text not null check (code_court ~ '^[A-Z0-9]{1,4}$'),
  ordre int not null default 0,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint article_dimensions_code_unique unique (product_model_id, code_court)
);

create unique index if not exists article_dimensions_libelle_unique on article_dimensions(product_model_id, lower(libelle));

comment on table article_dimensions is
  'Axe libre de déclinaison d''un consommable (12 mm, 15 mm pour un bouton ; 50 m, 100 m pour une bobine ; S, M, L pour un sachet). Le code court entre dans le code de la déclinaison.';

alter table article_dimensions enable row level security;
drop policy if exists article_dimensions_select on article_dimensions;
create policy article_dimensions_select on article_dimensions for select using (is_staff());
drop policy if exists article_dimensions_write on article_dimensions;
create policy article_dimensions_write on article_dimensions for all
  using (is_production_manager() or has_permission('articles', 'modify'))
  with check (is_production_manager() or has_permission('articles', 'modify'));

-- ----------------------------------------------------------------------------
-- 4. DÉCLINAISONS DE TOUTES LES NATURES
-- ----------------------------------------------------------------------------

alter table product_variants
  alter column textile_id drop not null,
  alter column color_id drop not null,
  alter column size_id drop not null,
  add column if not exists dimension_id uuid references article_dimensions(id);

alter table product_variants drop constraint if exists product_variants_combinaison_unique;
create unique index if not exists product_variants_combinaison_unique
  on product_variants (
    model_id,
    coalesce(textile_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(color_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(size_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(dimension_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on table product_variants is
  'Déclinaison d''un article (A6, migration 0102) : produit fini = grammage × couleur × taille ; tissu = grammage × couleur ; consommable = couleur × dimension. Code unique, figé, jamais réutilisé.';

-- Axes requis selon la nature de l'article.
create or replace function product_variants_axes()
returns trigger
language plpgsql
as $$
declare
  v_nature text;
begin
  select nature into v_nature from product_models where id = new.model_id;
  if v_nature = 'pf' and (new.textile_id is null or new.color_id is null or new.size_id is null or new.dimension_id is not null) then
    raise exception 'une déclinaison de produit fini est un grammage × une couleur × une taille';
  elsif v_nature = 'mp' and (new.textile_id is null or new.size_id is not null or new.dimension_id is not null) then
    raise exception 'une déclinaison de tissu est un grammage × une couleur';
  elsif v_nature = 'consommable' and (new.textile_id is not null or new.size_id is not null
                                       or (new.color_id is null and new.dimension_id is null)) then
    raise exception 'une déclinaison de consommable est une couleur et/ou une dimension';
  end if;
  return new;
end;
$$;

drop trigger if exists product_variants_axes on product_variants;
create trigger product_variants_axes before insert or update of model_id, textile_id, color_id, size_id, dimension_id on product_variants
  for each row execute function product_variants_axes();

create or replace function generate_variant_code(
  p_model_id uuid,
  p_textile_id uuid,
  p_color_id uuid,
  p_size_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings coding_rules;
  v_model product_models;
  v_matiere text;
  v_grammage text;
  v_couleur text;
  v_taille text;
  v_parts text[] := '{}';
  v_seg text;
  v_val text;
  v_code text;
begin
  select * into v_settings from coding_rules where nature = 'pf';
  select * into v_model from product_models where id = p_model_id;
  select m.code_court into v_matiere
  from textiles t left join matieres m on m.id = coalesce(t.matiere_id, v_model.matiere_id)
  where t.id = p_textile_id;
  select code_court into v_grammage from textiles where id = p_textile_id;
  select code_court into v_couleur from colors where id = p_color_id;
  select code_court into v_taille from sizes where id = p_size_id;

  foreach v_seg in array v_settings.segments loop
    v_val := case v_seg
      when 'modele' then v_model.code
      when 'matiere' then v_matiere
      when 'grammage' then v_grammage
      when 'couleur' then v_couleur
      when 'taille' then v_taille
    end;
    if v_val is null or v_val = '' then
      raise exception 'code impossible pour « % » : segment « % » sans code court (%)', v_model.name, v_seg,
        case v_seg
          when 'modele' then 'choisissez la catégorie du modèle'
          when 'matiere' then 'renseignez la matière et son code court'
          when 'grammage' then 'renseignez le code court (grammage) du textile'
          when 'couleur' then 'renseignez le code court de la couleur'
          else 'renseignez le code court de la taille'
        end;
    end if;
    v_parts := v_parts || v_val;
  end loop;

  v_code := array_to_string(v_parts, v_settings.separateur);
  if char_length(v_code) + 1 > v_settings.longueur_max then
    raise exception 'le code % (suffixe d''état compris : % caractères) dépasse la longueur maximale de % caractères',
      v_code, char_length(v_code) + 1, v_settings.longueur_max;
  end if;
  return v_code;
end;
$$;



-- Code d'une déclinaison de matière première ou de consommable, selon la
-- règle de sa nature. Pas de suffixe d'état (vierge / P / D) : propre aux
-- produits finis.
create or replace function generate_article_variant_code(
  p_model_id uuid,
  p_textile_id uuid,
  p_color_id uuid,
  p_dimension_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_model product_models;
  v_rule coding_rules;
  v_seg text;
  v_val text;
  v_parts text[] := '{}';
  v_code text;
begin
  select * into v_model from product_models where id = p_model_id;
  select * into v_rule from coding_rules where nature = v_model.nature;
  foreach v_seg in array v_rule.segments loop
    v_val := case v_seg
      when 'modele' then coalesce(v_model.code, (select c.code from consumables c where c.product_model_id = p_model_id))
      when 'matiere' then (select m.code_court from matieres m
                           where m.id = coalesce((select t.matiere_id from textiles t where t.id = p_textile_id), v_model.matiere_id))
      when 'grammage' then (select t.code_court from textiles t where t.id = p_textile_id)
      when 'couleur' then (select c.code_court from colors c where c.id = p_color_id)
      when 'dimension' then (select d.code_court from article_dimensions d where d.id = p_dimension_id)
    end;
    -- Un axe absent de la déclinaison (consommable sans couleur…) est sauté ;
    -- un axe présent sans code court est une erreur.
    if v_val is null or v_val = '' then
      if (v_seg = 'couleur' and p_color_id is null) or (v_seg = 'dimension' and p_dimension_id is null) then
        continue;
      end if;
      raise exception 'code impossible pour « % » : segment « % » sans code court (%)', v_model.name, v_seg,
        case v_seg
          when 'modele' then 'code de l''article'
          when 'matiere' then 'renseignez la matière du tissu et son code court'
          when 'grammage' then 'renseignez le code court du grammage'
          when 'couleur' then 'renseignez le code court de la couleur'
          else 'renseignez le code court de la dimension'
        end;
    end if;
    v_parts := v_parts || v_val;
  end loop;
  v_code := array_to_string(v_parts, v_rule.separateur);
  if char_length(v_code) > v_rule.longueur_max then
    raise exception 'le code % (% caractères) dépasse la longueur maximale de % caractères', v_code, char_length(v_code), v_rule.longueur_max;
  end if;
  return v_code;
end;
$$;

revoke all on function generate_article_variant_code(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Déclinaisons d'un tissu (grammages × couleurs) ou d'un consommable
-- (couleurs × dimensions, un axe vide ignoré). Les combinaisons retirées
-- sont désactivées, jamais supprimées.
create or replace function ensure_article_variants(p_model_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nature text;
  r record;
  v_count int := 0;
  v_code text;
  v_has_colors boolean;
  v_has_dims boolean;
begin
  if not (is_production_manager() or has_permission('articles', 'modify')) then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les déclinaisons';
  end if;
  select nature into v_nature from product_models where id = p_model_id;
  v_has_colors := exists (select 1 from product_model_colors where product_model_id = p_model_id);
  v_has_dims := exists (select 1 from article_dimensions where product_model_id = p_model_id and actif);

  if v_nature = 'mp' then
    if not exists (select 1 from textiles where product_model_id = p_model_id and active) then
      raise exception 'aucun grammage pour ce tissu : ajoutez-en un';
    end if;
    if not v_has_colors then
      raise exception 'aucune couleur déclarée pour ce tissu';
    end if;
    for r in
      select t.id as textile_id, c.color_id, null::uuid as dimension_id
      from textiles t cross join product_model_colors c
      where t.product_model_id = p_model_id and t.active and c.product_model_id = p_model_id
    loop
      if not exists (select 1 from product_variants v where v.model_id = p_model_id and v.textile_id = r.textile_id and v.color_id = r.color_id) then
        v_code := generate_article_variant_code(p_model_id, r.textile_id, r.color_id, null);
        begin
          insert into product_variants (model_id, textile_id, color_id, code, sage_reference)
          values (p_model_id, r.textile_id, r.color_id, v_code,
                  (select tsa.sage_reference from textile_sage_articles tsa where tsa.textile_id = r.textile_id and tsa.color_id = r.color_id limit 1));
        exception when unique_violation then
          raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts dans Paramètres > Codification', v_code;
        end;
        v_count := v_count + 1;
      end if;
    end loop;
    update product_variants v set actif = false
    where v.model_id = p_model_id and v.actif
      and not (exists (select 1 from textiles t where t.id = v.textile_id and t.product_model_id = p_model_id and t.active)
               and exists (select 1 from product_model_colors c where c.product_model_id = p_model_id and c.color_id = v.color_id));

  elsif v_nature = 'consommable' then
    if not v_has_colors and not v_has_dims then
      raise exception 'déclarez des couleurs et/ou des dimensions pour décliner ce consommable';
    end if;
    for r in
      select c.color_id, d.id as dimension_id
      from (select color_id from product_model_colors where product_model_id = p_model_id
            union all select null where not v_has_colors) c
      cross join (select id from article_dimensions where product_model_id = p_model_id and actif
                  union all select null where not v_has_dims) d
    loop
      if not exists (select 1 from product_variants v where v.model_id = p_model_id
                     and v.color_id is not distinct from r.color_id and v.dimension_id is not distinct from r.dimension_id) then
        v_code := generate_article_variant_code(p_model_id, null, r.color_id, r.dimension_id);
        begin
          insert into product_variants (model_id, color_id, dimension_id, code)
          values (p_model_id, r.color_id, r.dimension_id, v_code);
        exception when unique_violation then
          raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts', v_code;
        end;
        v_count := v_count + 1;
      end if;
    end loop;
    update product_variants v set actif = false
    where v.model_id = p_model_id and v.actif
      -- Une déclinaison reste active si elle suit les axes déclarés : avec des
      -- couleurs déclarées, une déclinaison sans couleur ne l'est plus (idem
      -- pour les dimensions).
      and not ((case when v_has_colors
                     then v.color_id is not null and exists (select 1 from product_model_colors c where c.product_model_id = p_model_id and c.color_id = v.color_id)
                     else v.color_id is null end)
               and (case when v_has_dims
                         then v.dimension_id is not null and exists (select 1 from article_dimensions d where d.id = v.dimension_id and d.actif)
                         else v.dimension_id is null end));
  else
    raise exception 'nature inconnue';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ensure_variants', 'product_model', p_model_id, jsonb_build_object('creees', v_count, 'nature', v_nature));
  return v_count;
end;
$$;

revoke all on function ensure_article_variants(uuid) from public, anon, authenticated;

create or replace function ensure_variants(p_model_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
  v_id uuid;
begin
  if not (is_production_manager() or has_permission('articles', 'modify')) then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les déclinaisons';
  end if;
  -- Matières premières et consommables : leurs propres axes (migration 0102).
  if (select nature from product_models where id = p_model_id) <> 'pf' then
    return ensure_article_variants(p_model_id);
  end if;
  if not exists (select 1 from product_model_textiles where product_model_id = p_model_id) then
    raise exception 'aucun textile autorisé pour ce modèle : choisissez au moins un grammage';
  end if;
  if not exists (select 1 from product_model_colors where product_model_id = p_model_id) then
    raise exception 'aucune couleur déclarée pour ce modèle (onglet Général, disponibilité)';
  end if;
  if not exists (select 1 from product_model_sizes where product_model_id = p_model_id) then
    raise exception 'aucune taille déclarée pour ce modèle (onglet Général, disponibilité)';
  end if;

  for r in
    select pmt.textile_id, pmc.color_id, pms.size_id
    from product_model_textiles pmt
    cross join product_model_colors pmc
    cross join product_model_sizes pms
    where pmt.product_model_id = p_model_id and pmc.product_model_id = p_model_id and pms.product_model_id = p_model_id
      and not exists (
        select 1 from product_variants pv
        where pv.model_id = p_model_id and pv.textile_id = pmt.textile_id
          and pv.color_id = pmc.color_id and pv.size_id = pms.size_id
      )
  loop
    begin
      insert into product_variants (model_id, textile_id, color_id, size_id, code)
      values (p_model_id, r.textile_id, r.color_id, r.size_id,
              generate_variant_code(p_model_id, r.textile_id, r.color_id, r.size_id))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'le code % est déjà pris par une autre déclinaison : différenciez les codes courts (ex. deux tailles « M » de groupes différents) dans Paramètres > Codification',
        generate_variant_code(p_model_id, r.textile_id, r.color_id, r.size_id);
    end;
    perform ensure_variant_stock_articles(v_id);
    v_count := v_count + 1;
  end loop;

  -- Combinaisons décochées : désactivées.
  update product_variants pv set actif = false
  where pv.model_id = p_model_id and pv.actif
    and not (
      exists (select 1 from product_model_textiles x where x.product_model_id = p_model_id and x.textile_id = pv.textile_id)
      and exists (select 1 from product_model_colors x where x.product_model_id = p_model_id and x.color_id = pv.color_id)
      and exists (select 1 from product_model_sizes x where x.product_model_id = p_model_id and x.size_id = pv.size_id)
    );

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ensure_variants', 'product_model', p_model_id, jsonb_build_object('creees', v_count));
  return v_count;
end;
$$;



-- Couleurs déjà connues d'un tissu (coloris Sage) : déclarées sur l'article.
insert into product_model_colors (product_model_id, color_id)
select distinct t.product_model_id, tsa.color_id
from textile_sage_articles tsa join textiles t on t.id = tsa.textile_id
where t.product_model_id is not null and tsa.color_id is not null
on conflict do nothing;

create or replace function stock_articles_overview()
returns table (
  product_model_id uuid,
  nature text,
  code text,
  nom text,
  famille text,
  unite text,
  references_sage text[],
  en_stock numeric,
  reserve numeric,
  disponible numeric,
  rouleaux_stock int,
  rouleaux_kg numeric,
  rouleaux_production int,
  textile_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;

  return query
  with refs as (
    -- Références Sage de chaque article : déclinaisons (produit fini),
    -- coloris (tissu), référence du consommable, référence du modèle.
    select v.model_id as pm, stock_article_ref(a.id) as ref, a.id as stock_article_id
    from product_variants v join variant_stock_articles a on a.variant_id = v.id
    union
    select t.product_model_id, tsa.sage_reference, null::uuid
    from textiles t join textile_sage_articles tsa on tsa.textile_id = t.id
    where t.product_model_id is not null
    union
    select c.product_model_id, c.sage_reference, null::uuid
    from consumables c where c.product_model_id is not null and c.sage_reference is not null
    union
    select m.id, m.sage_reference, null::uuid from product_models m where m.sage_reference is not null
  ),
  stock as (
    select r.pm, array_agg(distinct r.ref) filter (where r.ref is not null) as refs,
           coalesce(sum(s.q), 0) as q
    from refs r
    left join lateral (select sum(si.quantity_available) as q from stock_item_view si where si.sage_reference = r.ref) s on true
    group by r.pm
  ),
  res as (
    select v.model_id as pm, sum(sr.quantite)::numeric as q
    from stock_reservations sr
    join variant_stock_articles a on a.id = sr.variant_stock_article_id
    join product_variants v on v.id = a.variant_id
    where sr.statut = 'reservee'
    group by v.model_id
  ),
  rol as (
    select t.product_model_id as pm,
           count(*) filter (where r.statut = 'en_stock')::int as n_stock,
           coalesce(sum(r.poids_kg) filter (where r.statut = 'en_stock'), 0) as kg,
           count(*) filter (where r.statut = 'en_production')::int as n_prod
    from textile_rolls r join textiles t on t.id = r.textile_id
    where t.product_model_id is not null
    group by t.product_model_id
  )
  select m.id, m.nature,
         coalesce(m.code, (select c.code from consumables c where c.product_model_id = m.id)),
         m.name,
         nullif(concat_ws(' › ', f.nom, sf.nom), ''),
         m.unite,
         coalesce(st.refs, '{}'::text[]),
         coalesce(st.q, 0),
         coalesce(res.q, 0)::numeric,
         coalesce(st.q, 0) - coalesce(res.q, 0),
         coalesce(rol.n_stock, 0), coalesce(rol.kg, 0), coalesce(rol.n_prod, 0),
         (select t.id from textiles t where t.product_model_id = m.id order by t.grammage nulls last limit 1)
  from product_models m
  left join article_families f on f.id = m.famille_id
  left join article_families sf on sf.id = m.sous_famille_id
  left join stock st on st.pm = m.id
  left join res on res.pm = m.id
  left join rol on rol.pm = m.id
  where m.active
  order by m.nature, m.name;
end;
$$;


grant select, update on coding_rules to authenticated;
grant select, insert, update, delete on article_dimensions to authenticated;
