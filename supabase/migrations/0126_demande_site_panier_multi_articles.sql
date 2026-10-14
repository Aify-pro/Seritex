-- ============================================================================
-- 0126 — E-shop en panier : UNE demande du site peut porter PLUSIEURS articles
-- ============================================================================
-- Jusqu'ici, « Personnaliser » créait une demande par composition
-- (create_site_personnalisation, 0110 → 0121). Avec le panier, le visiteur
-- identifié compose plusieurs articles puis envoie UNE demande.
--
-- Ce que la migration fait :
--   1. request_site_files.article : rang de l'article (à partir de 1) auquel un
--      fichier appartient. Absent = 1er article (les demandes existantes sont
--      inchangées). L'écran de la demande (PR #164) le lit déjà.
--   2. _site_article(p) : contrôle UN article (article publiable, couleur,
--      grammage, zones de couleur, emplacements) et renvoie sa fiche, sa ligne
--      de devis (lignes_stock) et son résumé. Même logique que 0121.
--   3. create_site_demande(p) : valide 1 à 10 articles, crée la demande avec
--      create_site_request (même reconnaissance du client par e-mail, même
--      anti-abus que le formulaire de devis), range les articles dans
--      requests.personnalisation = { articles: [...], envoi_id } et dans
--      requests.lignes_stock (une ligne par article), puis rattache les fichiers
--      réellement déposés dans le dossier de l'envoi.
--
-- create_site_personnalisation (0121) est LAISSÉE EN L'ÉTAT : le site actuel
-- l'appelle encore tant que le panier n'est pas en ligne. Elle pourra être
-- retirée ensuite. Aucune donnée existante n'est modifiée. Aucun prix.
-- ============================================================================

alter table request_site_files
  add column if not exists article int check (article is null or (article between 1 and 20));

comment on column request_site_files.article is
  'Rang de l''article (à partir de 1) auquel appartient le fichier dans une demande à plusieurs articles (0126) ; nul = 1er article.';

-- ----------------------------------------------------------------------------
-- 2. Contrôle d'un article du panier
-- ----------------------------------------------------------------------------

create or replace function _site_article(p jsonb, p_rang int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model product_models;
  v_couleur uuid := nullif(p ->> 'couleur_id', '')::uuid;
  v_textile uuid := nullif(p ->> 'textile_id', '')::uuid;
  v_quantite int := coalesce(nullif(p ->> 'quantite', '')::int, 0);
  v_tailles jsonb := '{}'::jsonb;
  v_impressions jsonb := '{}'::jsonb;
  v_marquages jsonb := coalesce(p -> 'marquages', '[]'::jsonb);
  v_m jsonb;
  v_couleur_nom text;
  v_grammage numeric;
  v_libelle text;
  v_desc text := '';
  v_zones jsonb := '{}'::jsonb;
  v_zones_lib jsonb := '{}'::jsonb;
  v_z record;
  v_i int := 0;
  v_produit text;
begin
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

  -- Couleurs par zone : zones du modèle, couleurs actives (et déclarées pour le modèle s'il en a).
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

  -- Répartition par taille (facultative) : tailles connues, quantités positives.
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
    -- Plusieurs visuels sur le même emplacement : le devis retient le plus grand nombre de couleurs.
    v_impressions := v_impressions || jsonb_build_object(
      v_m ->> 'emplacement_id',
      greatest(
        coalesce((v_impressions ->> (v_m ->> 'emplacement_id'))::int, 1),
        greatest(1, least(12, coalesce(nullif(v_m ->> 'nb_couleurs', '')::int, 1)))
      ));
    v_desc := v_desc || E'\n' || format('  Marquage %s : %s · %s cm · %s%s',
      v_i, v_libelle, v_m ->> 'largeur_cm', coalesce(v_m ->> 'technique_libelle', 'technique à définir'),
      coalesce(' · « ' || nullif(left(v_m ->> 'consigne', 600), '') || ' »', ''));
  end loop;

  v_produit := v_model.name || coalesce(' · ' || v_couleur_nom, '') || coalesce(' · ' || v_grammage || ' g/m²', '');

  return jsonb_build_object(
    'quantite', v_quantite,
    'produit', v_produit,
    'modele', v_model.name,
    -- Texte lisible pour le message de la demande.
    'texte', concat_ws(E'\n',
      format('Article %s : %s — %s pièce(s)', p_rang, v_produit, v_quantite) || v_desc,
      case when v_zones_lib <> '{}'::jsonb then '  Couleurs par zone : ' ||
        (select string_agg((value ->> 'zone') || ' ' || (value ->> 'couleur'), ', ') from jsonb_each(v_zones_lib)) end),
    'personnalisation', jsonb_build_object(
      'modele_id', v_model.id, 'modele', v_model.name,
      'couleur_id', v_couleur, 'couleur', v_couleur_nom,
      'textile_id', v_textile, 'grammage', v_grammage,
      'quantite', v_quantite, 'repartition', v_tailles,
      'couleurs_zones', nullif(v_zones_lib, '{}'::jsonb),
      'marquages', v_marquages),
    'ligne', jsonb_strip_nulls(jsonb_build_object(
      'product_model_id', v_model.id,
      'description', v_model.name || coalesce(' — ' || v_couleur_nom, ''),
      -- Couleurs par zone : le devis s'ouvre en « couleur par zone » (pas de couleur unique).
      'couleur_unique_id', case when v_zones = '{}'::jsonb then v_couleur end,
      'couleurs_zones', nullif(v_zones, '{}'::jsonb),
      'textile_id', v_textile,
      'tailles', v_tailles,
      'quantite', v_quantite,
      'impressions', v_impressions))
  );
end;
$$;

revoke all on function _site_article(jsonb, int) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Création de la demande à plusieurs articles
-- ----------------------------------------------------------------------------

create or replace function create_site_demande(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_envoi text := p ->> 'envoi_id';
  v_articles jsonb := coalesce(p -> 'articles', '[]'::jsonb);
  v_a jsonb;
  v_r jsonb;
  v_res jsonb;
  v_id uuid;
  v_f jsonb;
  v_n int := jsonb_array_length(coalesce(p -> 'articles', '[]'::jsonb));
  v_i int := 0;
  v_total int := 0;
  v_perso jsonb := '[]'::jsonb;
  v_lignes jsonb := '[]'::jsonb;
  v_textes text[] := '{}';
  v_produits text[] := '{}';
  v_rang int;
begin
  if not coalesce((select eshop_actif and personnaliser_actif from site_settings where id), false) then
    raise exception 'personnaliser désactivé';
  end if;
  if v_envoi is null or v_envoi !~ '^[0-9a-f-]{36}$' then
    raise exception 'envoi invalide';
  end if;
  if v_n < 1 or v_n > 10 then
    raise exception 'nombre d''articles invalide';
  end if;
  if jsonb_array_length(coalesce(p -> 'fichiers', '[]'::jsonb)) > 60 then
    raise exception 'trop de fichiers';
  end if;

  for v_a in select * from jsonb_array_elements(v_articles) loop
    v_i := v_i + 1;
    v_r := _site_article(v_a, v_i);
    v_total := v_total + (v_r ->> 'quantite')::int;
    v_perso := v_perso || jsonb_build_array(v_r -> 'personnalisation');
    v_lignes := v_lignes || jsonb_build_array(v_r -> 'ligne');
    v_textes := v_textes || (v_r ->> 'texte');
    v_produits := v_produits || ((v_r ->> 'produit') || ' ×' || (v_r ->> 'quantite'));
  end loop;

  -- Demande : même reconnaissance du client, même anti-abus que le formulaire (0098).
  v_res := create_site_request(jsonb_build_object(
    'nom', p ->> 'nom', 'entreprise', p ->> 'entreprise', 'email', p ->> 'email', 'telephone', p ->> 'telephone',
    'produit_libelle', case when v_n = 1 then (v_produits)[1] else v_n || ' articles : ' || left(array_to_string(v_produits, ' ; '), 300) end,
    'quantite', v_total::text,
    'technique_libelle', 'voir la composition (panier de l''e-shop)',
    'date_souhaitee', p ->> 'date_souhaitee',
    'message', concat_ws(E'\n',
      case when v_n = 1 then 'Composition faite avec l''e-shop du site.' else 'Panier de l''e-shop du site : ' || v_n || ' articles.' end,
      array_to_string(v_textes, E'\n'),
      nullif(p ->> 'message', ''))
  ));
  v_id := (v_res ->> 'id')::uuid;

  update requests
     set personnalisation = jsonb_build_object('articles', v_perso, 'envoi_id', v_envoi),
         lignes_stock = v_lignes
   where id = v_id;

  -- Fichiers : seulement ceux réellement déposés dans le dossier de cet envoi, rangés par article.
  for v_f in select * from jsonb_array_elements(coalesce(p -> 'fichiers', '[]'::jsonb)) loop
    if (v_f ->> 'path') not like 'envois/' || v_envoi || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'site-personnalisation' and o.name = v_f ->> 'path') then
      raise exception 'fichier introuvable';
    end if;
    v_rang := coalesce(nullif(v_f ->> 'article', '')::int, 1);
    if v_rang < 1 or v_rang > v_n then
      raise exception 'fichier rattaché à un article inconnu';
    end if;
    insert into request_site_files (request_id, path, file_name, mime_type, size_bytes, role, marquage, article)
    select v_id, v_f ->> 'path', left(coalesce(v_f ->> 'nom', 'fichier'), 200), o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint,
           case when v_f ->> 'role' = 'maquette' then 'maquette' else 'logo' end,
           nullif(v_f ->> 'marquage', '')::int, v_rang
      from storage.objects o where o.bucket_id = 'site-personnalisation' and o.name = v_f ->> 'path';
  end loop;

  return v_res;
end;
$$;

revoke all on function create_site_demande(jsonb) from public, anon, authenticated;
grant execute on function create_site_demande(jsonb) to service_role;
