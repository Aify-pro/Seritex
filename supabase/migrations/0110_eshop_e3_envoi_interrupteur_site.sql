-- ============================================================================
-- 0110 — E-shop, lot E3 : interrupteur du site et envoi depuis « Personnaliser »
-- ============================================================================
--
-- Chantier e-shop (plan Seritex-plans/eshop-studio.md).
--
--   1. Interrupteur du site (Paramètres > Site web) : l'e-shop et l'outil
--      « Personnaliser » s'activent et se désactivent à tout moment, sans
--      rien casser. Désactivé, le site n'affiche plus ni catalogue ni outil
--      (il renvoie vers la demande de devis) et la base refuse les envois :
--      les demandes déjà reçues ne sont pas touchées. Désactivés au départ.
--      « Personnaliser » dépend de l'e-shop : e-shop coupé = tout coupé.
--   2. Envoi d'une composition depuis le site : une DEMANDE (même circuit que
--      le formulaire de devis, 0098) qui porte en plus
--        - requests.personnalisation : la composition du client ;
--        - requests.lignes_stock : l'article (modèle, couleur, grammage,
--          quantité, répartition, emplacements et nombre de couleurs), repris
--          tel quel à l'ouverture du devis ;
--        - request_site_files : logos et maquette PDF déposés par le client
--          (bucket privé « site-personnalisation »). La médiathèque exige un
--          client ; une demande du site vient souvent d'un prospect.
--   Aucun prix : il vient du devis validé par la Direction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RÉGLAGES DU SITE (ligne unique)
-- ----------------------------------------------------------------------------

create table if not exists site_settings (
  id boolean primary key default true check (id),
  eshop_actif boolean not null default false,
  personnaliser_actif boolean not null default false,
  message_fermeture text check (message_fermeture is null or length(message_fermeture) <= 400),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

insert into site_settings (id) values (true) on conflict (id) do nothing;

comment on table site_settings is
  'Interrupteurs du site www.seritex.ci (0110) : e-shop et outil « Personnaliser » (qui dépend de l''e-shop). Modifiés par set_site_settings uniquement.';

alter table site_settings enable row level security;
drop policy if exists site_settings_select on site_settings;
create policy site_settings_select on site_settings for select using (is_staff());
revoke all on site_settings from public, anon;
grant select on site_settings to authenticated;

insert into modules (key, label, description, display_order)
values ('site_web', 'Site web', 'Activer ou désactiver l''e-shop et l''outil « Personnaliser » du site www.seritex.ci', 174)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key = 'site_web'
on conflict (role_id, module_id) do nothing;

-- Ouvert par défaut à l'administrateur et à la Direction (base_role administrateur).
update role_permissions rp
set can_view = true, can_modify = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'site_web' and r.base_role = 'administrateur';

create or replace function set_site_settings(p_eshop boolean, p_personnaliser boolean, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avant site_settings;
begin
  if not (is_admin() or has_permission('site_web', 'modify')) then
    raise exception 'accès refusé : réglages du site non autorisés';
  end if;
  select * into v_avant from site_settings where id;
  update site_settings
     set eshop_actif = p_eshop,
         personnaliser_actif = p_personnaliser,
         message_fermeture = nullif(trim(p_message), ''),
         updated_at = now(),
         updated_by = auth.uid()
   where id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'set_site_settings', 'site_settings', null,
          jsonb_build_object('avant', jsonb_build_object('eshop', v_avant.eshop_actif, 'personnaliser', v_avant.personnaliser_actif),
                             'apres', jsonb_build_object('eshop', p_eshop, 'personnaliser', p_personnaliser)));
end;
$$;

revoke all on function set_site_settings(boolean, boolean, text) from public, anon;
grant execute on function set_site_settings(boolean, boolean, text) to authenticated;

-- Lu par le serveur du site (service_role) : état effectif.
create or replace function site_reglages()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'eshop', s.eshop_actif,
    'personnaliser', s.eshop_actif and s.personnaliser_actif,
    'message', s.message_fermeture
  )
  from site_settings s where s.id;
$$;

revoke all on function site_reglages() from public, anon, authenticated;
grant execute on function site_reglages() to service_role;

-- Le catalogue n'est plus servi quand l'e-shop est coupé (même si le site
-- n'a pas encore relu les réglages).
create or replace function eshop_catalogue_actif()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select eshop_actif from site_settings where id), false);
$$;

revoke all on function eshop_catalogue_actif() from public, anon, authenticated;

do $$
begin
  -- Garde ajoutée en tête de eshop_catalogue (0108) sans la réécrire : renommage + enveloppe.
  if not exists (select 1 from pg_proc where proname = 'eshop_catalogue_complet') then
    alter function eshop_catalogue() rename to eshop_catalogue_complet;
  end if;
end;
$$;

revoke all on function eshop_catalogue_complet() from public, anon, authenticated;

create or replace function eshop_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when eshop_catalogue_actif() then eshop_catalogue_complet() else '[]'::jsonb end;
$$;

revoke all on function eshop_catalogue() from public, anon, authenticated;
grant execute on function eshop_catalogue() to service_role;

comment on function eshop_catalogue() is
  'Catalogue du site (0108), vide quand l''e-shop est désactivé dans Paramètres > Site web (0110). service_role seulement.';

-- ----------------------------------------------------------------------------
-- 2. COMPOSITION ET FICHIERS D'UNE DEMANDE VENUE DE « PERSONNALISER »
-- ----------------------------------------------------------------------------

alter table requests add column if not exists personnalisation jsonb;

comment on column requests.personnalisation is
  'Composition faite par le client dans l''outil « Personnaliser » du site (0110) : article, couleur, grammage, quantités, marquages (emplacement, largeur, technique, couleurs, consigne, contrôles). Null pour les autres demandes.';

create table if not exists request_site_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  role text not null check (role in ('logo', 'maquette')),
  marquage int,
  created_at timestamptz not null default now()
);

create index if not exists idx_request_site_files_request on request_site_files(request_id);

comment on table request_site_files is
  'Fichiers envoyés avec une demande depuis l''outil « Personnaliser » du site (0110) : logos et maquette PDF. Bucket privé « site-personnalisation », lus par URL signée.';

alter table request_site_files enable row level security;
drop policy if exists request_site_files_select on request_site_files;
-- Visible exactement par qui voit la demande (la sous-requête applique la RLS de requests).
create policy request_site_files_select on request_site_files for select
  using (exists (select 1 from requests r where r.id = request_site_files.request_id));
revoke all on request_site_files from public, anon;
grant select on request_site_files to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-personnalisation', 'site-personnalisation', false, 15728640,
        array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'application/postscript',
              'application/illustrator', 'application/octet-stream'])
on conflict (id) do nothing;

-- Aucune politique sur storage.objects pour ce bucket : seul le service_role
-- (serveur du site pour le dépôt, serveur de l'application pour les liens de
-- lecture, après contrôle de la RLS ci-dessus) y accède.

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
    v_impressions := v_impressions || jsonb_build_object(
      v_m ->> 'emplacement_id', greatest(1, least(12, coalesce(nullif(v_m ->> 'nb_couleurs', '')::int, 1))));
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

comment on function create_site_personnalisation(jsonb) is
  'Envoi d''une composition « Personnaliser » du site (0110) : crée la demande (create_site_request), l''article repris par le devis, la composition et les fichiers. Refusé quand l''outil est désactivé. service_role seulement.';
