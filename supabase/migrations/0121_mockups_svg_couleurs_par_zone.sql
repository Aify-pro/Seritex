-- ============================================================================
-- 0121 — Mockups SVG des articles et couleurs par zone sur le site
-- ============================================================================
--
-- Chantier e-shop (plan Seritex-plans/eshop-studio.md), décisions du
-- 2026-10-09 :
--   1. product_model_mockups : un mockup SVG par vue (avant, dos), déposé dans
--      Fiche article > Technique > Zones. Le SVG est nettoyé AVANT d'arriver
--      ici (application : liste blanche d'éléments de dessin, aucun script ni
--      lien externe). Avec lui :
--        - zones : élément du SVG (id) → zone de couleur du modèle
--          (product_zone_templates.zone_key), ou '__contour' (forme du
--          vêtement sans couleur propre) ;
--        - largeur_cm + cadre : calibrage (largeur réelle du vêtement en
--          taille M et cadre du vêtement dans le SVG) → échelle cm ;
--        - reperes : position de chaque zone d'impression (poitrine, dos…)
--          posée à la main sur le mockup.
--   2. eshop_catalogue_complet (0108/0110) : ajoute les zones de couleur et
--      les mockups calibrés.
--   3. create_site_personnalisation (0120) : accepte des couleurs par zone,
--      contrôlées (zones du modèle, couleurs proposées) ; le devis s'ouvre
--      alors en « couleur par zone ».
-- ============================================================================

create table if not exists product_model_mockups (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  vue text not null check (vue in ('avant', 'dos')),
  svg text not null check (length(svg) <= 1500000),
  zones jsonb not null default '{}'::jsonb,
  largeur_cm numeric(6, 2) check (largeur_cm is null or largeur_cm > 0),
  cadre jsonb,
  reperes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id),
  unique (product_model_id, vue)
);

comment on table product_model_mockups is
  'Mockups SVG d''un modèle par vue (0121) : SVG nettoyé, correspondance éléments → zones de couleur, calibrage (largeur réelle, cadre) et repères des zones d''impression. Lus par l''e-shop (eshop_catalogue).';

alter table product_model_mockups enable row level security;
drop policy if exists product_model_mockups_select on product_model_mockups;
create policy product_model_mockups_select on product_model_mockups for select using (is_staff());
revoke all on product_model_mockups from public, anon;
grant select on product_model_mockups to authenticated;

create or replace function save_product_model_mockup(
  p_model_id uuid, p_vue text, p_svg text, p_zones jsonb, p_largeur_cm numeric, p_cadre jsonb, p_reperes jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_k text;
  v_v text;
begin
  perform assert_articles_modify();
  if p_vue not in ('avant', 'dos') then
    raise exception 'vue inconnue';
  end if;
  if coalesce(p_svg, '') !~ '^<svg' then
    raise exception 'mockup SVG invalide';
  end if;
  for v_k, v_v in select key, value from jsonb_each_text(coalesce(p_zones, '{}'::jsonb)) loop
    if v_v <> '__contour' and not exists (
      select 1 from product_zone_templates where product_model_id = p_model_id and zone_key = v_v
    ) then
      raise exception 'zone de couleur inconnue pour ce modèle : %', v_v;
    end if;
  end loop;
  for v_k in select key from jsonb_each(coalesce(p_reperes, '{}'::jsonb)) loop
    if not exists (select 1 from product_printable_zones where id = v_k::uuid and product_model_id = p_model_id) then
      raise exception 'zone d''impression inconnue pour ce modèle';
    end if;
  end loop;
  if p_cadre is not null and not (
    (p_cadre ->> 'w')::numeric > 0 and (p_cadre ->> 'h')::numeric > 0 and p_cadre ? 'x' and p_cadre ? 'y'
  ) then
    raise exception 'cadre du vêtement invalide';
  end if;

  insert into product_model_mockups (product_model_id, vue, svg, zones, largeur_cm, cadre, reperes, updated_by)
  values (p_model_id, p_vue, p_svg, coalesce(p_zones, '{}'::jsonb), p_largeur_cm, p_cadre, coalesce(p_reperes, '{}'::jsonb), auth.uid())
  on conflict (product_model_id, vue) do update
    set svg = excluded.svg, zones = excluded.zones, largeur_cm = excluded.largeur_cm, cadre = excluded.cadre,
        reperes = excluded.reperes, updated_at = now(), updated_by = auth.uid();
end;
$$;

revoke all on function save_product_model_mockup(uuid, text, text, jsonb, numeric, jsonb, jsonb) from public, anon;
grant execute on function save_product_model_mockup(uuid, text, text, jsonb, numeric, jsonb, jsonb) to authenticated;

create or replace function delete_product_model_mockup(p_model_id uuid, p_vue text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_articles_modify();
  delete from product_model_mockups where product_model_id = p_model_id and vue = p_vue;
end;
$$;

revoke all on function delete_product_model_mockup(uuid, text) from public, anon;
grant execute on function delete_product_model_mockup(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Catalogue du site : zones de couleur et mockups
-- ----------------------------------------------------------------------------

create or replace function eshop_catalogue_complet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_out jsonb;
begin
  select coalesce(array_agg(id), '{}') into v_ids
  from product_models
  where publiable_eshop and active and nature = 'pf' and fusionne_dans is null;

  with dispo as (
    select * from article_availability_core(v_ids)
  ),
  -- Couleurs du modèle : celles déclarées, sinon celles de ses déclinaisons actives (comme 0107).
  col as (
    select pmc.product_model_id as model_id, pmc.color_id
      from product_model_colors pmc where pmc.product_model_id = any (v_ids)
    union
    select v.model_id, v.color_id from product_variants v
      where v.model_id = any (v_ids) and v.actif and v.color_id is not null
        and not exists (select 1 from product_model_colors x where x.product_model_id = v.model_id)
  ),
  col_statut as (
    select col.model_id, c.id, c.name, c.hex,
           case
             when bool_or(d.statut = 'disponible') then 'disponible'
             when bool_or(d.statut = 'non_suivi') or count(d.statut) = 0 then 'non_suivi'
             else 'indisponible'
           end as statut
    from col
    join colors c on c.id = col.color_id and c.active
    left join dispo d on d.model_id = col.model_id and d.color_id = c.id
    group by col.model_id, c.id, c.name, c.hex
  )
  select coalesce(jsonb_agg(m.doc order by m.nom), '[]'::jsonb) into v_out
  from (
    select pm.name as nom, jsonb_build_object(
      'id', pm.id,
      'code', pm.code,
      'nom', pm.name,
      'famille', f.nom,
      'sous_famille', sf.nom,
      'texte_commercial', pm.texte_commercial,
      -- Statut du modèle, comme summarizeArticle : rien de suivi → non_suivi ;
      -- toutes les couleurs manquent → indisponible ; certaines → partiel.
      'statut', (
        select case
          when count(*) filter (where cs.statut <> 'non_suivi') = 0 then 'non_suivi'
          when count(*) filter (where cs.statut <> 'indisponible') = 0 then 'indisponible'
          when count(*) filter (where cs.statut = 'indisponible') > 0 then 'partiel'
          else 'disponible'
        end
        from col_statut cs where cs.model_id = pm.id
      ),
      'couleurs', coalesce((
        select jsonb_agg(jsonb_build_object('id', cs.id, 'nom', cs.name, 'hex', cs.hex, 'statut', cs.statut) order by cs.name)
        from col_statut cs where cs.model_id = pm.id
      ), '[]'::jsonb),
      'grammages', coalesce((
        select jsonb_agg(jsonb_build_object('id', t.id, 'nom', t.nom, 'grammage', t.grammage, 'composition', t.composition)
                         order by t.grammage nulls last, t.nom)
        from textiles t
        where t.active and t.id in (
          select pmt.textile_id from product_model_textiles pmt where pmt.product_model_id = pm.id
          union select pm.textile_id where pm.textile_id is not null
        )
      ), '[]'::jsonb),
      'disponibilites', coalesce((
        select jsonb_agg(jsonb_build_object('textile_id', d.textile_id, 'color_id', d.color_id, 'statut', d.statut))
        from dispo d where d.model_id = pm.id
      ), '[]'::jsonb),
      'tailles', coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'cle', s.cle, 'libelle', s.libelle) order by s.display_order, s.libelle)
        from product_model_sizes pms join sizes s on s.id = pms.size_id and s.active
        where pms.product_model_id = pm.id
      ), '[]'::jsonb),
      'emplacements', coalesce((
        select jsonb_agg(jsonb_build_object('id', z.id, 'cle', z.zone_key, 'libelle', z.zone_label) order by z.display_order, z.zone_label)
        from product_printable_zones z where z.product_model_id = pm.id
      ), '[]'::jsonb),
      'medias', coalesce((
        select jsonb_agg(jsonb_build_object('path', md.path, 'color_id', md.color_id, 'principale', md.principale) order by md.ordre)
        from product_model_media md where md.product_model_id = pm.id
      ), '[]'::jsonb),
      -- Zones de couleur du modèle (0121) : le client peut choisir une couleur par zone.
      'zones_couleur', coalesce((
        select jsonb_agg(jsonb_build_object('cle', zt.zone_key, 'libelle', zt.zone_label) order by zt.display_order, zt.zone_label)
        from product_zone_templates zt where zt.product_model_id = pm.id
      ), '[]'::jsonb),
      -- Mockups SVG par vue (0121), déjà nettoyés au dépôt.
      'mockups', coalesce((
        select jsonb_agg(jsonb_build_object('vue', mk.vue, 'svg', mk.svg, 'zones', mk.zones, 'largeur_cm', mk.largeur_cm,
                                            'cadre', mk.cadre, 'reperes', mk.reperes) order by mk.vue)
        from product_model_mockups mk where mk.product_model_id = pm.id and mk.largeur_cm is not null and mk.cadre is not null
      ), '[]'::jsonb)
    ) as doc
    from product_models pm
    left join article_families f on f.id = pm.famille_id
    left join article_families sf on sf.id = pm.sous_famille_id
    where pm.id = any (v_ids)
  ) m;

  return v_out;
end;
$$;

revoke all on function eshop_catalogue_complet() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Envoi depuis le site : couleurs par zone
-- ----------------------------------------------------------------------------

create or replace function create_site_personnalisation(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model product_models;
  v_couleur uuid := nullif(p ->> 'couleur_id', '')::uuid;
  v_textile uuid := nullif(p ->> 'textile_id', '')::uuid;
  v_envoi text := p ->> 'envoi_id';
  v_quantite int := coalesce(nullif(p ->> 'quantite', '')::int, 0);
  v_tailles jsonb := '{}'::jsonb;
  v_impressions jsonb := '{}'::jsonb;
  v_marquages jsonb := coalesce(p -> 'marquages', '[]'::jsonb);
  v_m jsonb;
  v_f jsonb;
  v_res jsonb;
  v_id uuid;
  v_couleur_nom text;
  v_grammage numeric;
  v_libelle text;
  v_desc text := '';
  v_zones jsonb := '{}'::jsonb;
  v_zones_lib jsonb := '{}'::jsonb;
  v_z record;
  v_i int := 0;
begin
  if not coalesce((select eshop_actif and personnaliser_actif from site_settings where id), false) then
    raise exception 'personnaliser désactivé';
  end if;
  if v_envoi is null or v_envoi !~ '^[0-9a-f-]{36}$' then
    raise exception 'envoi invalide';
  end if;

  select * into v_model from product_models
   where id = nullif(p ->> 'modele_id', '')::uuid and publiable_eshop and active and nature = 'pf' and fusionne_dans is null;
  if not found then
    raise exception 'article non proposé sur le site';
  end if;
  if v_couleur is not null and exists (select 1 from product_model_colors where product_model_id = v_model.id)
     and not exists (select 1 from product_model_colors where product_model_id = v_model.id and color_id = v_couleur) then
    raise exception 'couleur non proposée pour cet article';
  end if;
  if v_textile is not null and not exists (
    select 1 from product_model_textiles where product_model_id = v_model.id and textile_id = v_textile
    union select 1 where v_model.textile_id = v_textile
  ) then
    raise exception 'grammage non proposé pour cet article';
  end if;
  -- Couleurs par zone (0121) : zones du modèle, couleurs actives (et déclarées pour le modèle s'il en a).
  for v_z in select key, value from jsonb_each_text(coalesce(p -> 'couleurs_zones', '{}'::jsonb)) loop
    if not exists (select 1 from product_zone_templates where product_model_id = v_model.id and zone_key = v_z.key) then
      raise exception 'zone de couleur non proposée pour cet article';
    end if;
    if not exists (select 1 from colors where id = v_z.value::uuid and active)
       or (exists (select 1 from product_model_colors where product_model_id = v_model.id)
           and not exists (select 1 from product_model_colors where product_model_id = v_model.id and color_id = v_z.value::uuid)) then
      raise exception 'couleur non proposée pour cet article';
    end if;
    v_zones := v_zones || jsonb_build_object(v_z.key, v_z.value);
    v_zones_lib := v_zones_lib || jsonb_build_object(v_z.key, jsonb_build_object(
      'zone', (select zone_label from product_zone_templates where product_model_id = v_model.id and zone_key = v_z.key),
      'couleur', (select name from colors where id = v_z.value::uuid),
      'color_id', v_z.value));
  end loop;

  if jsonb_array_length(v_marquages) > 8 then
    raise exception 'trop de marquages';
  end if;

  -- Répartition par taille (facultative) : tailles du modèle, quantités positives.
  select coalesce(jsonb_object_agg(t.key, (t.value)::int), '{}'::jsonb) into v_tailles
    from jsonb_each_text(coalesce(p -> 'repartition', '{}'::jsonb)) t
    join sizes s on s.cle = t.key
   where t.value ~ '^\d{1,6}$' and t.value::int > 0;
  if v_tailles <> '{}'::jsonb then
    select sum(value::int) into v_quantite from jsonb_each_text(v_tailles);
  end if;
  if v_quantite < 1 or v_quantite > 1000000 then
    raise exception 'quantité invalide';
  end if;

  select name into v_couleur_nom from colors where id = v_couleur;
  select grammage into v_grammage from textiles where id = v_textile;

  -- Emplacements du modèle et nombre de couleurs (1 à 12) : repris dans le devis.
  for v_m in select * from jsonb_array_elements(v_marquages) loop
    v_i := v_i + 1;
    select zone_label into v_libelle from product_printable_zones
     where id = nullif(v_m ->> 'emplacement_id', '')::uuid and product_model_id = v_model.id;
    if v_libelle is null then
      raise exception 'emplacement non proposé pour cet article';
    end if;
    -- Plusieurs visuels sur le même emplacement (ex. cœur + ventre sur « Poitrine ») :
    -- le devis retient le plus grand nombre de couleurs, pas le dernier visuel.
    v_impressions := v_impressions || jsonb_build_object(
      v_m ->> 'emplacement_id',
      greatest(
        coalesce((v_impressions ->> (v_m ->> 'emplacement_id'))::int, 1),
        greatest(1, least(12, coalesce(nullif(v_m ->> 'nb_couleurs', '')::int, 1)))
      ));
    v_desc := v_desc || E'\n' || format('Marquage %s : %s · %s cm · %s%s',
      v_i, v_libelle, v_m ->> 'largeur_cm', coalesce(v_m ->> 'technique_libelle', 'technique à définir'),
      coalesce(' · « ' || nullif(left(v_m ->> 'consigne', 600), '') || ' »', ''));
  end loop;

  -- Demande : même reconnaissance du client, même anti-abus que le formulaire (0098).
  v_res := create_site_request(jsonb_build_object(
    'nom', p ->> 'nom', 'entreprise', p ->> 'entreprise', 'email', p ->> 'email', 'telephone', p ->> 'telephone',
    'produit_libelle', v_model.name || coalesce(' · ' || v_couleur_nom, '') || coalesce(' · ' || v_grammage || ' g/m²', ''),
    'quantite', v_quantite::text,
    'technique_libelle', 'voir la composition (outil Personnaliser)',
    'date_souhaitee', p ->> 'date_souhaitee',
    'message', concat_ws(E'\n', 'Composition faite avec l''outil « Personnaliser » du site.' || v_desc,
      case when v_zones_lib <> '{}'::jsonb then 'Couleurs par zone : ' ||
        (select string_agg((value ->> 'zone') || ' ' || (value ->> 'couleur'), ', ') from jsonb_each(v_zones_lib)) end,
      nullif(p ->> 'message', ''))
  ));
  v_id := (v_res ->> 'id')::uuid;

  update requests
     set personnalisation = jsonb_build_object(
           'modele_id', v_model.id, 'modele', v_model.name,
           'couleur_id', v_couleur, 'couleur', v_couleur_nom,
           'textile_id', v_textile, 'grammage', v_grammage,
           'quantite', v_quantite, 'repartition', v_tailles,
           'couleurs_zones', nullif(v_zones_lib, '{}'::jsonb),
           'marquages', v_marquages, 'envoi_id', v_envoi),
         lignes_stock = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
           'product_model_id', v_model.id,
           'description', v_model.name || coalesce(' — ' || v_couleur_nom, ''),
           -- Couleurs par zone : le devis s'ouvre en « couleur par zone » (pas de couleur unique).
           'couleur_unique_id', case when v_zones = '{}'::jsonb then v_couleur end,
           'couleurs_zones', nullif(v_zones, '{}'::jsonb),
           'textile_id', v_textile,
           'tailles', v_tailles,
           'quantite', v_quantite,
           'impressions', v_impressions)))
   where id = v_id;

  -- Fichiers : seulement ceux réellement déposés dans le dossier de cet envoi.
  for v_f in select * from jsonb_array_elements(coalesce(p -> 'fichiers', '[]'::jsonb)) loop
    if (v_f ->> 'path') not like 'envois/' || v_envoi || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'site-personnalisation' and o.name = v_f ->> 'path') then
      raise exception 'fichier introuvable';
    end if;
    insert into request_site_files (request_id, path, file_name, mime_type, size_bytes, role, marquage)
    select v_id, v_f ->> 'path', left(coalesce(v_f ->> 'nom', 'fichier'), 200), o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint,
           case when v_f ->> 'role' = 'maquette' then 'maquette' else 'logo' end,
           nullif(v_f ->> 'marquage', '')::int
      from storage.objects o where o.bucket_id = 'site-personnalisation' and o.name = v_f ->> 'path';
  end loop;

  return v_res;
end;
$$;

revoke all on function create_site_personnalisation(jsonb) from public, anon, authenticated;
grant execute on function create_site_personnalisation(jsonb) to service_role;
