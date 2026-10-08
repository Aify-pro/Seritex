-- ============================================================================
-- 0116 — Séparation des couleurs, lot 3 : nuancier d'encres
-- ============================================================================
-- L'outil « Séparation des couleurs » (Infographie) trouve les couleurs d'un
-- visuel ; il les rapproche désormais des encres réellement disponibles à
-- l'atelier, et propose une sous-couche blanche sur textile foncé.
--
--   1. Table `encres` : le nuancier (nom, couleur d'aperçu, référence Pantone
--      ou fournisseur, gamme), avec l'encre blanche servant de sous-couche.
--      Lue par tout le personnel (l'outil en a besoin), modifiée selon le
--      nouveau droit « Nuancier d'encres » de la matrice.
--   2. Module `encres` (Paramètres) : ouvert par défaut, toutes actions, à
--      l'administrateur et au responsable de production ; l'infographiste le
--      consulte. À ajuster dans Paramètres > Rôles & permissions.
--
-- Aucune donnée existante n'est modifiée. Nuancier vide au départ : tant
-- qu'il est vide, l'outil affiche les couleurs trouvées sans rapprochement.
-- ============================================================================

-- 1. Nuancier ------------------------------------------------------------------
create table if not exists encres (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) between 1 and 80),
  hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
  reference text check (reference is null or length(reference) <= 80),
  gamme text check (gamme is null or length(gamme) <= 60),
  sous_couche boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists encres_nom_unique on encres (lower(trim(nom)));

comment on table encres is
  'Nuancier d''encres de sérigraphie (0116) : rapprochement des couleurs trouvées par l''outil de séparation, nom repris sur les films.';
comment on column encres.hex is 'Couleur d''aperçu au format #RRGGBB (majuscules), base du rapprochement.';
comment on column encres.reference is 'Référence Pantone ou fournisseur (libre).';
comment on column encres.gamme is 'Gamme d''encre (ex. plastisol, à l''eau, décharge), libre.';
comment on column encres.sous_couche is 'Encre blanche utilisée pour la sous-couche sur textile foncé.';

alter table encres enable row level security;

drop policy if exists encres_select on encres;
create policy encres_select on encres for select using (is_staff());

drop policy if exists encres_insert on encres;
create policy encres_insert on encres for insert with check (has_permission('encres', 'create'));

drop policy if exists encres_update on encres;
create policy encres_update on encres for update
  using (has_permission('encres', 'modify'))
  with check (has_permission('encres', 'modify'));

drop policy if exists encres_delete on encres;
create policy encres_delete on encres for delete using (has_permission('encres', 'delete'));

revoke all on encres from public, anon;
grant select, insert, update, delete on encres to authenticated;

-- 2. Module et matrice -----------------------------------------------------------
insert into modules (key, label, description, display_order)
values ('encres', 'Nuancier d''encres', 'Encres de sérigraphie : rapprochement des couleurs séparées, sous-couche blanche, noms sur les films', 172)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key = 'encres'
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true, can_create = true, can_modify = true, can_delete = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'encres'
  and r.base_role::text in ('administrateur', 'responsable_production');

update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'encres'
  and r.base_role::text = 'infographiste';

drop trigger if exists trg_set_updated_at on encres;
create trigger trg_set_updated_at before update on encres for each row execute function set_updated_at();
