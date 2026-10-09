-- ============================================================================
-- 0120 — Site : plusieurs visuels sur le même emplacement
-- ============================================================================
--
-- L'e-shop permet désormais de poser plusieurs visuels (calques) sur une même
-- face, par exemple un logo au cœur et un autre sur le ventre, tous deux sur
-- l'emplacement « Poitrine » du modèle. create_site_personnalisation (0110)
-- écrasait alors le nombre de couleurs de l'emplacement par celui du dernier
-- visuel : le devis retient maintenant le plus grand. Seul changement de la
-- fonction ; la composition complète (tous les visuels) reste enregistrée
-- dans requests.personnalisation et décrite dans la demande.
-- ============================================================================

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
    'message', concat_ws(E'\n', 'Composition faite avec l''outil « Personnaliser » du site.' || v_desc, nullif(p ->> 'message', ''))
  ));
  v_id := (v_res ->> 'id')::uuid;

  update requests
     set personnalisation = jsonb_build_object(
           'modele_id', v_model.id, 'modele', v_model.name,
           'couleur_id', v_couleur, 'couleur', v_couleur_nom,
           'textile_id', v_textile, 'grammage', v_grammage,
           'quantite', v_quantite, 'repartition', v_tailles,
           'marquages', v_marquages, 'envoi_id', v_envoi),
         lignes_stock = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
           'product_model_id', v_model.id,
           'description', v_model.name || coalesce(' — ' || v_couleur_nom, ''),
           'couleur_unique_id', v_couleur,
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
