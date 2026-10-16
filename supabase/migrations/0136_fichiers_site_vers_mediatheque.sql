-- ============================================================================
-- Seritex — Fichiers du site : copie automatique dans la médiathèque (et sur le NAS)
-- ============================================================================
--
-- Constat : les logos, la maquette PDF (et désormais l'image de la maquette) envoyés par
-- le site restaient dans le bucket privé « site-personnalisation », lisibles seulement
-- depuis la demande par un lien d'une heure. Rien n'arrivait dans la médiathèque du
-- client, donc rien sur le NAS. (Choix du lot E3, 0110 : « la médiathèque exige un client ;
-- une demande du site vient souvent d'un prospect ». Les comptes du site sont maintenant
-- rattachés à des sociétés : le choix est dépassé.)
--
-- Cette migration prépare la copie. Elle ne copie rien elle-même : la plateforme traite les
-- fichiers à importer chaque minute (route /api/notifications/traiter, déjà appelée par
-- pg_cron), dès que la demande a une société — à la réception si le client est reconnu,
-- sinon au moment où on la rattache. Le fichier du bucket est conservé.
--
--   1. request_site_files : nouveau rôle « apercu » (image de la maquette) ; suivi de
--      l'import (media_file_id, imported_at, import_attempts, import_error).
--   2. create_site_demande : accepte le rôle « apercu » (seule ligne modifiée : le rôle
--      d'un fichier ; le reste est repris tel quel de la 0126).
--   3. prepare_site_file_import(p_file_id) : crée, pour un fichier, sa fiche de médiathèque
--      (catégorie visuel pour un logo, maquette pour la maquette et son image), sa version 1,
--      son événement « ajout » et son rattachement à la demande. Idempotente. Réservée au
--      service_role ; la plateforme envoie ensuite les octets sur les cibles de stockage.
-- Rien n'est supprimé ni réécrit dans les données existantes.
-- ============================================================================

alter table request_site_files drop constraint if exists request_site_files_role_check;
alter table request_site_files
  add constraint request_site_files_role_check check (role in ('logo', 'maquette', 'apercu'));

alter table request_site_files
  add column if not exists media_file_id uuid references media_files(id) on delete set null,
  add column if not exists imported_at timestamptz,
  add column if not exists import_attempts int not null default 0,
  add column if not exists import_error text;

comment on column request_site_files.media_file_id is 'Fiche de médiathèque créée pour ce fichier du site (import automatique, 0136).';
comment on column request_site_files.imported_at is 'Renseigné quand le fichier a été enregistré sur une cible de stockage de la médiathèque.';

create index if not exists idx_request_site_files_a_importer on request_site_files (created_at) where imported_at is null;

-- ----------------------------------------------------------------------------
-- create_site_demande : le rôle « apercu » est accepté
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_site_demande(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           case v_f ->> 'role' when 'maquette' then 'maquette' when 'apercu' then 'apercu' else 'logo' end,
           nullif(v_f ->> 'marquage', '')::int, v_rang
      from storage.objects o where o.bucket_id = 'site-personnalisation' and o.name = v_f ->> 'path';
  end loop;

  return v_res;
end;
$function$;

-- (grants identiques à la 0126)
revoke all on function create_site_demande(jsonb) from public, anon, authenticated;
grant execute on function create_site_demande(jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- Préparation de l'import d'un fichier du site vers la médiathèque
-- ----------------------------------------------------------------------------

create or replace function prepare_site_file_import(p_file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f request_site_files;
  r requests;
  v_company_name text;
  v_category text;
  v_media_id uuid;
  v_version_id uuid;
  v_nom text;
  v_ext text;
begin
  select * into f from request_site_files where id = p_file_id for update;
  if not found then
    raise exception 'fichier du site introuvable';
  end if;
  if f.imported_at is not null then
    return jsonb_build_object('statut', 'deja_importe', 'media_file_id', f.media_file_id);
  end if;

  select * into r from requests where id = f.request_id;
  if r.company_id is null then
    return jsonb_build_object('statut', 'sans_client');
  end if;
  select name into v_company_name from companies where id = r.company_id;

  v_category := case f.role when 'logo' then 'visuel' else 'maquette' end;
  -- Nom lisible dans la médiathèque : demande, article, nature du fichier.
  v_ext := coalesce(nullif(substring(f.file_name from '\.[A-Za-z0-9]{1,8}$'), ''), '');
  v_nom := case f.role
    when 'logo' then r.reference || ' · article ' || coalesce(f.article, 1) || ' · ' || f.file_name
    when 'apercu' then r.reference || ' · article ' || coalesce(f.article, 1) || ' · maquette (image)' || v_ext
    else r.reference || ' · article ' || coalesce(f.article, 1) || ' · maquette (PDF)' || v_ext
  end;

  v_media_id := f.media_file_id;
  if v_media_id is null then
    insert into media_files (company_id, file_name, category, mime_type, size_bytes)
    values (r.company_id, v_nom, v_category, f.mime_type, f.size_bytes)
    returning id into v_media_id;

    insert into media_file_versions (media_file_id, version_number, file_name, mime_type, size_bytes)
    values (v_media_id, 1, v_nom, f.mime_type, f.size_bytes)
    returning id into v_version_id;

    update media_files set current_version_id = v_version_id where id = v_media_id;

    insert into media_file_events (media_file_id, media_file_version_id, event_type, reason)
    values (v_media_id, v_version_id, 'ajout', 'Import automatique depuis la demande ' || r.reference || ' (envoyée depuis le site)');

    insert into request_media_files (request_id, media_file_id)
    values (f.request_id, v_media_id)
    on conflict (request_id, media_file_id) do nothing;

    update request_site_files set media_file_id = v_media_id where id = f.id;
  else
    select current_version_id into v_version_id from media_files where id = v_media_id;
  end if;

  return jsonb_build_object(
    'statut', 'a_envoyer',
    'media_file_id', v_media_id,
    'version_id', v_version_id,
    'company_id', r.company_id,
    'company_name', v_company_name,
    'file_name', v_nom,
    'mime_type', f.mime_type,
    'path', f.path
  );
end;
$$;

revoke all on function prepare_site_file_import(uuid) from public, anon, authenticated;
grant execute on function prepare_site_file_import(uuid) to service_role;
