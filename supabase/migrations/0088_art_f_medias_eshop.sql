-- ============================================================================
-- 0088 — ART-F : médias et e-shop de la fiche article
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot ART-F.
--
--   1. product_model_media : photos d'un modèle, par couleur (ou toutes
--      couleurs), ordonnées, une image principale par couleur.
--   2. product_models.texte_commercial et publiable_eshop (préparation de
--      l'e-shop, rien n'est publié par Seritex aujourd'hui).
--   3. Bucket privé « articles » : dépôt par l'application après contrôle des
--      droits en base (record_product_model_media), lecture par URL signée.
-- ============================================================================

alter table product_models
  add column if not exists texte_commercial text,
  add column if not exists publiable_eshop boolean not null default false;

comment on column product_models.texte_commercial is 'Texte de présentation du modèle (catalogue, e-shop).';
comment on column product_models.publiable_eshop is 'Le modèle peut être proposé sur l''e-shop (aucune publication automatique à ce jour).';

create table if not exists product_model_media (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  color_id uuid references colors(id),
  path text not null unique,
  file_name text not null,
  mime_type text,
  ordre int not null default 0,
  principale boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_product_model_media_model on product_model_media(product_model_id, ordre);
-- Une seule image principale par modèle et par couleur (« toutes couleurs » comprise).
create unique index if not exists product_model_media_principale_unique
  on product_model_media(product_model_id, coalesce(color_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where principale;

comment on table product_model_media is
  'Photos d''un modèle (ART-F), par couleur ou toutes couleurs, ordonnées ; une image principale par couleur (vignette de la liste Articles). Fichiers dans le bucket privé « articles ».';

alter table product_model_media enable row level security;
drop policy if exists product_model_media_select on product_model_media;
create policy product_model_media_select on product_model_media for select using (is_staff());

create or replace function assert_articles_modify()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_production_manager() or has_permission('articles', 'modify')) then
    raise exception 'accès refusé : modification des articles non autorisée';
  end if;
end;
$$;

revoke all on function assert_articles_modify() from public, anon, authenticated;

create or replace function record_product_model_media(p_model_id uuid, p_path text, p_file_name text, p_mime text, p_color_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first boolean;
begin
  perform assert_articles_modify();
  if p_path not like 'modeles/' || p_model_id::text || '/%' then
    raise exception 'chemin de fichier invalide';
  end if;
  if p_color_id is not null and not exists (
    select 1 from product_model_colors where product_model_id = p_model_id and color_id = p_color_id
  ) and exists (select 1 from product_model_colors where product_model_id = p_model_id) then
    raise exception 'cette couleur n''est pas déclarée pour le modèle';
  end if;
  select not exists (
    select 1 from product_model_media where product_model_id = p_model_id and color_id is not distinct from p_color_id and principale
  ) into v_first;
  insert into product_model_media (product_model_id, color_id, path, file_name, mime_type, ordre, principale, created_by)
  values (p_model_id, p_color_id, p_path, p_file_name, p_mime,
          coalesce((select max(ordre) + 1 from product_model_media where product_model_id = p_model_id), 0),
          v_first, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function record_product_model_media(uuid, text, text, text, uuid) from public, anon;
grant execute on function record_product_model_media(uuid, text, text, text, uuid) to authenticated;

create or replace function set_product_model_media_principale(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m product_model_media;
begin
  perform assert_articles_modify();
  select * into v_m from product_model_media where id = p_media_id;
  if not found then
    raise exception 'image introuvable';
  end if;
  update product_model_media set principale = false
  where product_model_id = v_m.product_model_id and color_id is not distinct from v_m.color_id and principale;
  update product_model_media set principale = true where id = p_media_id;
end;
$$;

revoke all on function set_product_model_media_principale(uuid) from public, anon;
grant execute on function set_product_model_media_principale(uuid) to authenticated;

-- Nouvel ordre de la galerie : la liste des identifiants dans l'ordre voulu.
create or replace function reorder_product_model_media(p_model_id uuid, p_media_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_articles_modify();
  update product_model_media m set ordre = x.ord - 1
  from unnest(p_media_ids) with ordinality as x(id, ord)
  where m.id = x.id and m.product_model_id = p_model_id;
end;
$$;

revoke all on function reorder_product_model_media(uuid, uuid[]) from public, anon;
grant execute on function reorder_product_model_media(uuid, uuid[]) to authenticated;

-- Retire l'image (la ligne) ; renvoie le chemin pour que l'application
-- supprime le fichier. Une principale retirée passe la main à la suivante.
create or replace function delete_product_model_media(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m product_model_media;
begin
  perform assert_articles_modify();
  delete from product_model_media where id = p_media_id returning * into v_m;
  if not found then
    raise exception 'image introuvable';
  end if;
  if v_m.principale then
    update product_model_media set principale = true
    where id = (select id from product_model_media
                where product_model_id = v_m.product_model_id and color_id is not distinct from v_m.color_id
                order by ordre limit 1);
  end if;
  return v_m.path;
end;
$$;

revoke all on function delete_product_model_media(uuid) from public, anon;
grant execute on function delete_product_model_media(uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('articles', 'articles', false)
on conflict (id) do nothing;

drop policy if exists articles_objects_select on storage.objects;
create policy articles_objects_select on storage.objects for select
  using (bucket_id = 'articles' and is_staff());
