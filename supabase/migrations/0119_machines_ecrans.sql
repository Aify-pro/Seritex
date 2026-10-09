-- ============================================================================
-- 0119 — Machines et écrans de sérigraphie (lot 6)
-- ============================================================================
-- Le parc de l'atelier, pour que la séparation des couleurs et le prix de
-- revient partent des moyens réels :
--
--   1. machines : type (carrousel manuel ou automatique, ovale, table),
--      stations et têtes (couleurs par passage), format maximal, séchage,
--      cadence (pièces/heure), active.
--   2. machine_couts : coût horaire de la machine avec son équipe —
--      réservé aux droits Tarification (Direction), comme tout coût.
--   3. ecrans_cadres : les écrans physiques — code, format intérieur,
--      maillage (fils/cm), couleur de la maille, état (disponible, insolé,
--      à récupérer, hors service), visuel ou travail en cours, emplacement.
--   4. Module « Machines et écrans » (menu Atelier) : ouvert par défaut,
--      toutes actions, à l'administrateur et au responsable de production ;
--      consulté par l'infographiste et le chef de section. Lecture des
--      machines et des écrans par tout le personnel (l'outil de séparation
--      en a besoin).
-- ============================================================================

-- 1. Machines -------------------------------------------------------------------
create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  type text not null default 'carrousel_manuel'
    check (type in ('carrousel_manuel', 'carrousel_auto', 'ovale', 'table')),
  nb_stations int not null default 6 check (nb_stations between 1 and 40),
  nb_tetes int not null default 6 check (nb_tetes between 1 and 40),
  format_max_l_cm numeric(6, 1) check (format_max_l_cm is null or format_max_l_cm > 0),
  format_max_h_cm numeric(6, 1) check (format_max_h_cm is null or format_max_h_cm > 0),
  sechage text not null default 'flash' check (sechage in ('flash', 'tunnel', 'aucun')),
  cadence_pieces_h int check (cadence_pieces_h is null or cadence_pieces_h > 0),
  notes text check (notes is null or length(notes) <= 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists machines_nom_unique on machines (lower(btrim(nom)));

comment on table machines is
  'Machines de sérigraphie (0119) : têtes = couleurs imprimables en un passage, format maximal d''impression, séchage, cadence (pièces/heure, toutes couleurs comprises).';

-- 2. Coût horaire (Direction) ----------------------------------------------------
create table if not exists machine_couts (
  machine_id uuid primary key references machines(id) on delete cascade,
  cout_horaire numeric(12, 2) not null check (cout_horaire >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table machine_couts is
  'Coût horaire d''une machine avec son équipe (0119), réservé aux droits Tarification : remplace le taux horaire général de l''atelier dans le prix de revient de la sérigraphie.';

-- 3. Écrans (cadres) -------------------------------------------------------------
create table if not exists ecrans_cadres (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 30),
  largeur_cm numeric(6, 1) not null check (largeur_cm > 0),
  hauteur_cm numeric(6, 1) not null check (hauteur_cm > 0),
  maillage int not null check (maillage between 10 and 200),
  couleur_maille text not null default 'blanche' check (couleur_maille in ('blanche', 'jaune')),
  etat text not null default 'disponible'
    check (etat in ('disponible', 'insole', 'a_recuperer', 'hors_service')),
  travail text check (travail is null or length(travail) <= 120),
  emplacement text check (emplacement is null or length(emplacement) <= 60),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ecrans_cadres_code_unique on ecrans_cadres (lower(btrim(code)));

comment on table ecrans_cadres is
  'Écrans de sérigraphie (0119) : format intérieur du cadre, maillage en fils/cm (ex. 43, 77, 120), état — disponible, insolé (porte un visuel : travail), à récupérer (à dégraver), hors service.';

-- 4. Droits ------------------------------------------------------------------------
insert into modules (key, label, description, display_order)
values ('machines_ecrans', 'Machines et écrans', 'Parc de sérigraphie : machines (têtes, format, cadence) et écrans (maillage, état)', 59)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key = 'machines_ecrans'
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true, can_create = true, can_modify = true, can_delete = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'machines_ecrans'
  and r.base_role::text in ('administrateur', 'responsable_production');

update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'machines_ecrans'
  and r.base_role::text in ('infographiste', 'chef_section');

do $$
declare
  t text;
begin
  foreach t in array array['machines', 'ecrans_cadres'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (is_staff())', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''machines_ecrans'', ''create''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''machines_ecrans'', ''modify'')) with check (has_permission(''machines_ecrans'', ''modify''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''machines_ecrans'', ''delete''))', t || '_delete', t);
    execute format('revoke all on %I from public, anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('drop trigger if exists trg_set_updated_at on %I', t);
    execute format('create trigger trg_set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end;
$$;

alter table machine_couts enable row level security;
drop policy if exists machine_couts_select on machine_couts;
create policy machine_couts_select on machine_couts for select using (has_permission('tarification', 'view'));
drop policy if exists machine_couts_write on machine_couts;
create policy machine_couts_write on machine_couts for all
  using (has_permission('tarification', 'modify'))
  with check (has_permission('tarification', 'modify'));
revoke all on machine_couts from public, anon;
grant select, insert, update, delete on machine_couts to authenticated;
drop trigger if exists trg_set_updated_at on machine_couts;
create trigger trg_set_updated_at before update on machine_couts for each row execute function set_updated_at();
