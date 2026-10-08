-- ============================================================================
-- 0117 — Séparation des couleurs, lot 4 : encres = articles consommables,
--        prix de revient de la sérigraphie
-- ============================================================================
-- Décisions du 2026-10-09 :
--   - une encre est un ARTICLE consommable (famille « Consommables »,
--     sous-famille « Encres »), avec sa couleur et ses options pour la
--     séparation des couleurs ; son coût vient de son prix d'achat
--     (onglet Prix de revient de l'article) ;
--   - la sérigraphie a un prix de revient calculé à partir des paramètres de
--     l'atelier (écrans, calage, impression, séchage, gâche, encre), réservé
--     à la Direction : il sert à chiffrer un visuel et à ajuster la grille
--     « coût d'impression par nombre de couleurs » — jamais montré au client.
--
--   1. article_families.encres : sous-famille dont les articles sont des
--      encres de sérigraphie ; création (si absentes) de la famille
--      « Consommables » et de sa sous-famille « Encres ».
--   2. article_encres : options sérigraphie d'un article encre (couleur,
--      référence Pantone ou autre, gamme, sous-couche, dépôt, utilisable en
--      séparation). Lu par le personnel, modifié avec « Modifier » sur
--      Articles.
--   3. Retrait du nuancier de 0116 (table `encres` et module « Nuancier
--      d'encres ») : remplacé par les articles. La migration ÉCHOUE si la
--      table contient des encres (jamais de perte silencieuse).
--   4. serigraphie_parametres (ligne unique) : paramètres de coût de
--      l'atelier, lus et modifiés selon les droits Tarification.
-- ============================================================================

-- 1. Sous-famille d'encres --------------------------------------------------------
alter table article_families add column if not exists encres boolean not null default false;

comment on column article_families.encres is
  'Sous-famille d''encres de sérigraphie (0117) : ses articles portent des options de séparation des couleurs (article_encres).';

do $$
declare
  v_famille uuid;
  v_sous uuid;
begin
  select id into v_famille from article_families where parent_id is null and lower(btrim(nom)) = 'consommables';
  if v_famille is null then
    insert into article_families (nom, ordre) values ('Consommables', 90) returning id into v_famille;
  end if;
  select id into v_sous from article_families where parent_id = v_famille and lower(btrim(nom)) = 'encres';
  if v_sous is null then
    insert into article_families (nom, parent_id, encres) values ('Encres', v_famille, true);
  else
    update article_families set encres = true where id = v_sous;
  end if;
end;
$$;

-- 2. Options sérigraphie d'un article encre --------------------------------------
create table if not exists article_encres (
  product_model_id uuid primary key references product_models(id) on delete cascade,
  hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
  reference_couleur text check (reference_couleur is null or length(reference_couleur) <= 80),
  gamme text check (gamme is null or length(gamme) <= 60),
  sous_couche boolean not null default false,
  depot_g_m2 numeric(8, 2) check (depot_g_m2 is null or depot_g_m2 > 0),
  separation boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table article_encres is
  'Options sérigraphie d''un article encre (0117) : couleur pour le rapprochement de la séparation, référence Pantone ou autre, gamme, encre de sous-couche, dépôt (g/m², vide = paramètre de l''atelier), proposée ou non par l''outil de séparation.';

alter table article_encres enable row level security;

drop policy if exists article_encres_select on article_encres;
create policy article_encres_select on article_encres for select using (is_staff());

drop policy if exists article_encres_insert on article_encres;
create policy article_encres_insert on article_encres for insert with check (has_permission('articles', 'modify'));

drop policy if exists article_encres_update on article_encres;
create policy article_encres_update on article_encres for update
  using (has_permission('articles', 'modify'))
  with check (has_permission('articles', 'modify'));

drop policy if exists article_encres_delete on article_encres;
create policy article_encres_delete on article_encres for delete using (has_permission('articles', 'modify'));

revoke all on article_encres from public, anon;
grant select, insert, update, delete on article_encres to authenticated;

drop trigger if exists trg_set_updated_at on article_encres;
create trigger trg_set_updated_at before update on article_encres for each row execute function set_updated_at();

-- 3. Retrait du nuancier de 0116 ---------------------------------------------------
do $$
begin
  if to_regclass('public.encres') is not null and exists (select 1 from encres) then
    raise exception 'la table encres (0116) contient des encres : recréez-les en articles avant d''appliquer 0117';
  end if;
end;
$$;

drop table if exists encres;
delete from role_permissions where module_id in (select id from modules where key = 'encres');
delete from modules where key = 'encres';

-- 4. Paramètres de coût de la sérigraphie ----------------------------------------
create table if not exists serigraphie_parametres (
  id boolean primary key default true check (id),
  cout_ecran numeric(12, 2) not null default 0 check (cout_ecran >= 0),
  calage_min numeric(8, 2) not null default 15 check (calage_min >= 0),
  taux_horaire numeric(12, 2) not null default 0 check (taux_horaire >= 0),
  impression_s numeric(8, 2) not null default 20 check (impression_s >= 0),
  sechage_piece numeric(12, 2) not null default 0 check (sechage_piece >= 0),
  gache_pct numeric(5, 2) not null default 3 check (gache_pct >= 0 and gache_pct < 100),
  depot_g_m2 numeric(8, 2) not null default 120 check (depot_g_m2 > 0),
  perte_encre_pct numeric(5, 2) not null default 20 check (perte_encre_pct >= 0 and perte_encre_pct < 500),
  prix_encre_kg numeric(12, 2) check (prix_encre_kg is null or prix_encre_kg >= 0),
  surface_ref_cm2 numeric(10, 2) not null default 300 check (surface_ref_cm2 > 0),
  quantite_ref int not null default 100 check (quantite_ref > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

insert into serigraphie_parametres (id) values (true) on conflict (id) do nothing;

comment on table serigraphie_parametres is
  'Paramètres de coût de la sérigraphie (0117), réservés à la Direction : coût d''un écran (film, émulsion, insolation, récupération), calage par écran (min), taux horaire de l''équipe, temps d''impression par pièce et par écran (s), séchage par pièce et par passage, gâche, dépôt et pertes d''encre, prix de l''encre par défaut, surface et quantité de référence de la grille proposée.';

alter table serigraphie_parametres enable row level security;

drop policy if exists serigraphie_parametres_select on serigraphie_parametres;
create policy serigraphie_parametres_select on serigraphie_parametres for select using (has_permission('tarification', 'view'));

drop policy if exists serigraphie_parametres_update on serigraphie_parametres;
create policy serigraphie_parametres_update on serigraphie_parametres for update
  using (has_permission('tarification', 'modify'))
  with check (has_permission('tarification', 'modify'));

revoke all on serigraphie_parametres from public, anon;
grant select, update on serigraphie_parametres to authenticated;

drop trigger if exists trg_set_updated_at on serigraphie_parametres;
create trigger trg_set_updated_at before update on serigraphie_parametres for each row execute function set_updated_at();
