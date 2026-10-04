-- ============================================================================
-- 0076 — COM-0 : codification et déclinaisons (lot commun Articles + Production)
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot COM-0 (A4, A6, A7, D10, P2, Q-COM-1,
-- Q-SF-4, Q-SAGE-1 : 18 caractères, confirmé par l'utilisateur).
--
--   1. coding_settings : ordre des segments, longueur maximale (18), séparateur
--      (aucun). Réglé dans Paramètres > Codification.
--   2. Codes courts sur les référentiels : catégories (nouvelle table
--      product_categories), matières (nouvelle table matieres), textiles (le
--      grammage), couleurs, tailles. Valeurs initiales proposées, modifiables.
--   3. Modèle : product_models.categorie_id, matiere_id (A6 : la matière est
--      portée par le modèle), code « TS012 » (catégorie + numéro), unique et
--      figé une fois attribué. Textiles autorisés (product_model_textiles),
--      forcément de la matière du modèle : c'est l'axe grammage.
--   4. Déclinaison = modèle × textile (grammage) × couleur × taille
--      (product_variants) : code « TS012JE165BLAXL » unique, figé, jamais
--      réutilisé (une déclinaison ne se supprime pas, elle s'archive) ;
--      référence Sage facultative.
--   5. Articles stockables (variant_stock_articles), par état : vierge (sans
--      suffixe), personnalisé (P), 2e choix (D) — Q-COM-1 et P2 : un PF
--      personnalisé entre sous un article distinct du PF vierge, sinon Sage
--      compterait les t-shirts imprimés comme du stock blanc.
--   6. product_models.sage_reference est OBSOLÈTE (commentaire, non supprimé).
--   7. Natures de stock (MP, PF, Consommable) et dépôt Sage par nature (D5 :
--      les dépôts Sage sont ignorés, le dépôt se choisit à l'export).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÉGLAGES DE CODIFICATION
-- ----------------------------------------------------------------------------

create or replace function text_array_sans_doublon(p text[])
returns boolean
language sql
immutable
as $$
  select cardinality(p) = (select count(distinct x) from unnest(p) x);
$$;

create table coding_settings (
  id boolean primary key default true check (id),
  segments text[] not null default array['modele', 'matiere', 'grammage', 'couleur', 'taille'],
  longueur_max int not null default 18 check (longueur_max between 8 and 40),
  separateur text not null default '' check (char_length(separateur) <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  constraint coding_settings_segments_valides check (
    segments <@ array['modele', 'matiere', 'grammage', 'couleur', 'taille']
    and 'modele' = any(segments)
    and text_array_sans_doublon(segments)
  )
);
insert into coding_settings (id) values (true) on conflict do nothing;

comment on table coding_settings is
  'Règle de codification des articles Seritex (A4, ligne unique) : ordre des segments, longueur maximale de la référence (18 = limite Sage confirmée), séparateur. Le suffixe d''état (P, D) s''ajoute au code et compte dans la longueur.';

-- ----------------------------------------------------------------------------
-- 2. RÉFÉRENTIELS ET CODES COURTS
-- ----------------------------------------------------------------------------

-- Code court par défaut : lettres et chiffres en majuscules, sans accents.
create or replace function code_court_par_defaut(p_texte text, p_longueur int)
returns text
language sql
immutable
as $$
  select left(upper(regexp_replace(seritex_norm(coalesce(p_texte, '')), '[^a-zA-Z0-9]', '', 'g')), p_longueur);
$$;

create table product_categories (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (char_length(btrim(nom)) between 1 and 80),
  code_court text not null unique check (code_court ~ '^[A-Z0-9]{1,4}$'),
  created_at timestamptz not null default now()
);

create table matieres (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique check (char_length(btrim(nom)) between 1 and 80),
  code_court text not null unique check (code_court ~ '^[A-Z0-9]{1,4}$'),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table matieres is 'Matières (jersey, piqué…) — la matière est portée par le modèle, le grammage est un axe de déclinaison (A6).';

alter table textiles add column if not exists matiere_id uuid references matieres(id);
alter table textiles add column if not exists code_court text check (code_court is null or code_court ~ '^[A-Z0-9]{1,5}$');
update textiles set code_court = round(grammage)::text where code_court is null and grammage is not null and grammage < 100000;

alter table colors add column if not exists code_court text unique check (code_court is null or code_court ~ '^[A-Z0-9]{1,4}$');
alter table sizes add column if not exists code_court text check (code_court is null or code_court ~ '^[A-Z0-9]{1,4}$');

-- Couleurs : 3 premières lettres, numérotées en cas de doublon (BLA, BLA2…) ;
-- tailles : le libellé. Proposés à la création (et repris pour l'existant),
-- modifiables ensuite dans Paramètres > Codification.
create or replace function colors_code_court_defaut()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_code text;
  v_n int := 1;
begin
  if new.code_court is not null then
    return new;
  end if;
  v_base := coalesce(nullif(code_court_par_defaut(new.name, 3), ''), 'C');
  v_code := v_base;
  while exists (select 1 from colors where code_court = v_code and id <> new.id) loop
    v_n := v_n + 1;
    v_code := left(v_base, 4 - length(v_n::text)) || v_n;
  end loop;
  new.code_court := v_code;
  return new;
end;
$$;

create trigger trg_colors_code_court_defaut
  before insert or update on colors
  for each row execute function colors_code_court_defaut();

create or replace function sizes_code_court_defaut()
returns trigger
language plpgsql
as $$
begin
  if new.code_court is null then
    new.code_court := left(nullif(code_court_par_defaut(new.libelle, 4), ''), 4);
  end if;
  return new;
end;
$$;

create trigger trg_sizes_code_court_defaut
  before insert or update on sizes
  for each row execute function sizes_code_court_defaut();

do $$
declare
  r record;
begin
  for r in select id from colors where code_court is null order by created_at, name loop
    update colors set code_court = null where id = r.id;
  end loop;
end $$;

update sizes set code_court = null where code_court is null;

-- Catégories : reprises des catégories libres déjà saisies sur les modèles.
do $$
declare
  r record;
  v_base text;
  v_code text;
  v_n int;
begin
  for r in select distinct btrim(category) as nom from product_models where nullif(btrim(category), '') is not null loop
    v_base := coalesce(nullif(code_court_par_defaut(r.nom, 2), ''), 'XX');
    v_code := v_base;
    v_n := 1;
    while exists (select 1 from product_categories where code_court = v_code) loop
      v_n := v_n + 1;
      v_code := left(v_base, 4 - length(v_n::text)) || v_n;
    end loop;
    insert into product_categories (nom, code_court) values (r.nom, v_code) on conflict (nom) do nothing;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. MODÈLE : CATÉGORIE, MATIÈRE, CODE, TEXTILES AUTORISÉS
-- ----------------------------------------------------------------------------

alter table product_models
  add column if not exists categorie_id uuid references product_categories(id),
  add column if not exists matiere_id uuid references matieres(id),
  add column if not exists code text unique check (code is null or code ~ '^[A-Z0-9]{2,10}$');

update product_models pm
set categorie_id = pc.id
from product_categories pc
where pc.nom = btrim(pm.category) and pm.categorie_id is null;

comment on column product_models.sage_reference is
  'OBSOLÈTE (COM-0, migration 0076) : faux en production (TSM02, TSM21). Les références Sage se portent par déclinaison et par état (variant_stock_articles). Conservée pour compatibilité, à supprimer par une PR de nettoyage.';
comment on column product_models.code is
  'Code Seritex du modèle (A4, A7) : code court de la catégorie + numéro à 3 chiffres (ex. TS012). Attribué automatiquement dès que la catégorie est connue, unique, figé ensuite.';

-- Code du modèle : attribué dès que la catégorie est connue, figé ensuite.
create or replace function product_models_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next int;
begin
  if tg_op = 'UPDATE' and old.code is not null and new.code is distinct from old.code then
    raise exception 'le code d''un modèle est figé (%) : il ne change plus une fois attribué', old.code;
  end if;
  -- La catégorie libre suit la catégorie du référentiel.
  if new.categorie_id is not null then
    select nom, code_court into new.category, v_prefix from product_categories where id = new.categorie_id;
  end if;
  if new.code is null and v_prefix is not null then
    perform pg_advisory_xact_lock(hashtext('product_models_code:' || v_prefix));
    select coalesce(max(substring(code from length(v_prefix) + 1)::int), 0) + 1 into v_next
    from product_models
    where code like v_prefix || '%' and substring(code from length(v_prefix) + 1) ~ '^[0-9]+$';
    new.code := v_prefix || lpad(v_next::text, 3, '0');
  end if;
  return new;
end;
$$;

create trigger trg_product_models_code
  before insert or update on product_models
  for each row execute function product_models_code();

-- Attribue un code aux modèles déjà catégorisés (le déclencheur s'en charge).
update product_models set categorie_id = categorie_id where categorie_id is not null and code is null;

-- Clé primaire propre (id), et non (modèle, textile) : PostgREST détecte une
-- relation plusieurs-à-plusieurs à travers une table dont la clé primaire
-- contient les deux clés étrangères. Avec une telle détection, le lien
-- product_models → textiles (product_models.textile_id), embarqué par le
-- code en production (fiche ODF, PDF, prix de revient réel), deviendrait
-- ambigu et ces requêtes échoueraient. L'unicité reste garantie.
create table product_model_textiles (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  textile_id uuid not null references textiles(id),
  created_at timestamptz not null default now(),
  constraint product_model_textiles_unique unique (product_model_id, textile_id)
);

comment on table product_model_textiles is
  'Textiles autorisés pour un modèle — forcément de la matière du modèle : c''est l''axe grammage des déclinaisons (A6).';

insert into product_model_textiles (product_model_id, textile_id)
select id, textile_id from product_models where textile_id is not null
on conflict do nothing;

create or replace function product_model_textiles_meme_matiere()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model_matiere uuid;
  v_textile_matiere uuid;
begin
  select matiere_id into v_model_matiere from product_models where id = new.product_model_id;
  select matiere_id into v_textile_matiere from textiles where id = new.textile_id;
  if v_model_matiere is not null and v_textile_matiere is distinct from v_model_matiere then
    raise exception 'ce textile n''est pas de la matière du modèle : un modèle ne se décline qu''en grammages de sa propre matière';
  end if;
  return new;
end;
$$;

create trigger trg_product_model_textiles_meme_matiere
  before insert or update on product_model_textiles
  for each row execute function product_model_textiles_meme_matiere();

-- ----------------------------------------------------------------------------
-- 4. DÉCLINAISONS ET ARTICLES STOCKABLES
-- ----------------------------------------------------------------------------

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references product_models(id),
  textile_id uuid not null references textiles(id),
  color_id uuid not null references colors(id),
  size_id uuid not null references sizes(id),
  code text not null unique,
  sage_reference text,
  actif boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_variants_combinaison_unique unique (model_id, textile_id, color_id, size_id)
);

create index idx_product_variants_model on product_variants(model_id);

comment on table product_variants is
  'Déclinaison = modèle × textile (grammage) × couleur × taille (A6). Code Seritex unique, figé, jamais réutilisé : une déclinaison ne se supprime pas, elle s''archive.';

create table variant_stock_articles (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants(id),
  etat text not null check (etat in ('vierge', 'personnalise', 'deuxieme_choix')),
  code text not null unique,
  sage_reference text,
  created_at timestamptz not null default now(),
  constraint variant_stock_articles_un_par_etat unique (variant_id, etat)
);

comment on table variant_stock_articles is
  'Article stockable d''une déclinaison, par état (Q-COM-1) : vierge (code de la déclinaison), personnalisé (suffixe P), 2e choix (suffixe D). C''est lui que les mouvements de stock et l''export Sage référencent (P2).';

-- Codes figés ; rien ne se supprime.
create or replace function codes_figes()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'une déclinaison ou un article stockable ne se supprime pas (son code ne doit jamais être réutilisé) : archivez-le';
  end if;
  if new.code is distinct from old.code then
    raise exception 'le code % est figé : il ne change plus une fois attribué', old.code;
  end if;
  return new;
end;
$$;

create trigger trg_product_variants_codes_figes
  before update or delete on product_variants
  for each row execute function codes_figes();
create trigger trg_variant_stock_articles_codes_figes
  before update or delete on variant_stock_articles
  for each row execute function codes_figes();

-- ----------------------------------------------------------------------------
-- 5. NATURES DE STOCK ET DÉPÔTS SAGE
-- ----------------------------------------------------------------------------

create table stock_natures (
  cle text primary key check (cle in ('mp', 'pf', 'consommable')),
  libelle text not null,
  ordre int not null default 0
);
insert into stock_natures (cle, libelle, ordre) values
  ('mp', 'Matière première', 1), ('pf', 'Produit fini', 2), ('consommable', 'Consommable', 3)
on conflict (cle) do nothing;

create table sage_depot_by_nature (
  nature text primary key references stock_natures(cle),
  depot text,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);
insert into sage_depot_by_nature (nature) select cle from stock_natures on conflict do nothing;

comment on table sage_depot_by_nature is
  'Dépôt Sage pré-rempli à l''export selon la nature de l''article (D5 : les dépôts Sage sont ignorés dans Seritex, le dépôt se choisit à l''export). Vide par défaut.';

-- ----------------------------------------------------------------------------
-- 6. FONCTIONS
-- ----------------------------------------------------------------------------

-- Code d'une déclinaison selon la règle paramétrée. Refuse un segment
-- manquant ou un code trop long (suffixe d'état compris).
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
  v_settings coding_settings;
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
  select * into v_settings from coding_settings limit 1;
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

-- Crée les trois articles stockables (vierge, P, D) d'une déclinaison.
create or replace function ensure_variant_stock_articles(p_variant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  select code into v_code from product_variants where id = p_variant_id;
  insert into variant_stock_articles (variant_id, etat, code)
  values (p_variant_id, 'vierge', v_code),
         (p_variant_id, 'personnalise', v_code || 'P'),
         (p_variant_id, 'deuxieme_choix', v_code || 'D')
  on conflict (variant_id, etat) do nothing;
end;
$$;

-- Crée les déclinaisons cochées d'un modèle : textiles autorisés × couleurs
-- déclarées × tailles déclarées (disponibilité). Une combinaison qui n'est
-- plus cochée est désactivée, jamais supprimée. Renvoie le nombre créé.
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

-- Avertit (sans bloquer) si une référence Sage est absente du miroir.
create or replace function check_sage_reference(p_reference text)
returns table (trouvee boolean, designation text, source text)
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from sage_articles_view where sage_reference = btrim(p_reference))
         or exists (select 1 from stock_item_view where sage_reference = btrim(p_reference)),
         coalesce(
           (select a.designation from sage_articles_view a where a.sage_reference = btrim(p_reference) limit 1),
           (select s.designation from stock_item_view s where s.sage_reference = btrim(p_reference) limit 1)
         ),
         case
           when exists (select 1 from sage_articles_view where sage_reference = btrim(p_reference)) then 'articles'
           when exists (select 1 from stock_item_view where sage_reference = btrim(p_reference)) then 'stock'
           else null
         end;
$$;

revoke all on function generate_variant_code(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function ensure_variant_stock_articles(uuid) from public, anon, authenticated;
revoke all on function ensure_variants(uuid) from public, anon, authenticated;
revoke all on function check_sage_reference(text) from public, anon, authenticated;
grant execute on function generate_variant_code(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function ensure_variants(uuid) to authenticated;
grant execute on function check_sage_reference(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------

alter table coding_settings enable row level security;
alter table product_categories enable row level security;
alter table matieres enable row level security;
alter table product_model_textiles enable row level security;
alter table product_variants enable row level security;
alter table variant_stock_articles enable row level security;
alter table stock_natures enable row level security;
alter table sage_depot_by_nature enable row level security;

create policy coding_settings_select on coding_settings for select using (is_staff());
create policy coding_settings_update on coding_settings for update using (is_admin()) with check (is_admin());

do $$
declare
  t text;
begin
  foreach t in array array['product_categories', 'matieres', 'product_model_textiles', 'product_variants', 'variant_stock_articles']
  loop
    execute format('create policy %I on %I for select using (is_staff())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (is_production_manager() or has_permission(''articles'', ''modify''))', t || '_insert', t);
    execute format('create policy %I on %I for update using (is_production_manager() or has_permission(''articles'', ''modify'')) with check (is_production_manager() or has_permission(''articles'', ''modify''))', t || '_update', t);
  end loop;
end $$;

-- Retirer un textile autorisé est permis ; supprimer une catégorie ou une
-- matière seulement si rien ne s'y rattache (clé étrangère).
create policy product_model_textiles_delete on product_model_textiles for delete
  using (is_production_manager() or has_permission('articles', 'modify'));
create policy product_categories_delete on product_categories for delete using (is_admin());
create policy matieres_delete on matieres for delete using (is_admin());

create policy stock_natures_select on stock_natures for select using (is_staff());
create policy sage_depot_by_nature_select on sage_depot_by_nature for select using (is_staff());
create policy sage_depot_by_nature_update on sage_depot_by_nature for update
  using (is_admin() or current_role_name() = 'gestionnaire_stock')
  with check (is_admin() or current_role_name() = 'gestionnaire_stock');

revoke all on coding_settings, product_categories, matieres, product_model_textiles, product_variants,
  variant_stock_articles, stock_natures, sage_depot_by_nature from public, anon;
grant select, update on coding_settings to authenticated;
grant select, insert, update, delete on product_categories, matieres, product_model_textiles to authenticated;
grant select, insert, update on product_variants, variant_stock_articles to authenticated;
grant select on stock_natures to authenticated;
grant select, update on sage_depot_by_nature to authenticated;

-- Codes courts des couleurs et tailles : modifiables par qui gère déjà ces
-- référentiels (policies existantes de colors et sizes, inchangées).
