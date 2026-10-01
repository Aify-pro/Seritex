-- ============================================================================
-- 0067 — Tarification : grilles de prix de revient par modèle (lot D)
-- ============================================================================
--
-- Reprise de la grille Excel « Grille_Prix_Tshirts_Multicolores_Seritex_V7 »,
-- en V1 « coûts saisis » (décision de la direction) : les coûts sont calculés
-- hors de l'application et saisis ici ; le calcul au kg par Pantone/famille
-- viendra plus tard.
--
--   - PARAMÈTRES GÉNÉRAUX : charges, marge cible, pas d'arrondi, frais d'écran
--     par couleur — les valeurs par défaut reprennent l'Excel Jersey (40 % de
--     charges, 15 % de marge, arrondi à 100 F CFA).
--   - GRILLE IMPRESSION : coût par pièce d'une impression selon son nombre de
--     couleurs — initialisée à 55 F CFA de 1 à 7 couleurs, comme l'Excel (qui
--     ne distinguait pas le nombre de couleurs : à ajuster).
--   - GRILLE PAR MODÈLE : composants de coût (tissu, col, confection, charges
--     fixes…) en « base + supplément par taille », charges/marge propres au
--     modèle si besoin, et prix de vente forcés taille par taille.
--
-- Le calcul lui-même (PR, coefficient, PV arrondi, marge réelle) est fait par
-- l'application (src/lib/pricing.ts), testé sur le Modèle 1 de l'Excel.
--
-- CONFIDENTIALITÉ : prix de revient et marges ne sont visibles que de la
-- Direction et de l'administrateur — imposé en base (is_admin(), base_role
-- administrateur), pas seulement à l'écran : un commercial n'y a pas accès,
-- même par appel direct à l'API.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PARAMÈTRES GÉNÉRAUX (une seule ligne)
-- ----------------------------------------------------------------------------

create table pricing_settings (
  id boolean primary key default true check (id),
  charges_pct numeric(5, 2) not null default 40 check (charges_pct >= 0 and charges_pct < 100),
  marge_pct numeric(5, 2) not null default 15 check (marge_pct >= 0 and marge_pct < 100),
  arrondi int not null default 100 check (arrondi >= 1),
  frais_ecran_par_couleur numeric(12, 2) not null default 0 check (frais_ecran_par_couleur >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table pricing_settings is
  'Paramètres de tarification (ligne unique). Charges : % du coût après charges ; marge : % du prix de vente — PV = PR / (1 − charges) / (1 − marge), comme l''Excel V7.';

insert into pricing_settings (id) values (true) on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 2. GRILLE IMPRESSION
-- ----------------------------------------------------------------------------

create table print_costs (
  nb_couleurs int primary key check (nb_couleurs between 1 and 12),
  cout_piece numeric(12, 2) not null check (cout_piece >= 0),
  updated_at timestamptz not null default now()
);

comment on table print_costs is
  'Coût par pièce d''une impression (un emplacement) selon son nombre de couleurs. Un nombre de couleurs absent est signalé au chiffrage, jamais compté 0.';

insert into print_costs (nb_couleurs, cout_piece)
select n, 55 from generate_series(1, 7) n
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. GRILLE PAR MODÈLE
-- ----------------------------------------------------------------------------

create table model_pricing (
  product_model_id uuid primary key references product_models(id) on delete cascade,
  -- Null : valeur des paramètres généraux.
  charges_pct numeric(5, 2) check (charges_pct is null or (charges_pct >= 0 and charges_pct < 100)),
  marge_pct numeric(5, 2) check (marge_pct is null or (marge_pct >= 0 and marge_pct < 100)),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

create table model_cost_components (
  id uuid primary key default gen_random_uuid(),
  product_model_id uuid not null references product_models(id) on delete cascade,
  libelle text not null check (length(trim(libelle)) > 0),
  base numeric(12, 2) not null check (base >= 0),
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create index idx_model_cost_components_model on model_cost_components(product_model_id);

create table model_cost_supplements (
  component_id uuid not null references model_cost_components(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete cascade,
  supplement numeric(12, 2) not null,
  primary key (component_id, taille)
);

create table model_forced_prices (
  product_model_id uuid not null references product_models(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade on delete cascade,
  prix numeric(12, 2) not null check (prix > 0),
  primary key (product_model_id, taille)
);

comment on table model_cost_components is
  'Composant du prix de revient d''un modèle (tissu, col, confection, charges fixes…) : coût de base par pièce, plus supplément éventuel par taille (model_cost_supplements).';
comment on table model_forced_prices is
  'Prix de vente imposé par la Direction pour une taille d''un modèle, à la place du prix calculé.';

-- ----------------------------------------------------------------------------
-- 4. RLS — Direction et administrateur uniquement
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['pricing_settings', 'print_costs', 'model_pricing', 'model_cost_components', 'model_cost_supplements', 'model_forced_prices']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_admin())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (is_admin())', t || '_insert', t);
    execute format('create policy %I on %I for update using (is_admin()) with check (is_admin())', t || '_update', t);
    execute format('create policy %I on %I for delete using (is_admin())', t || '_delete', t);
    execute format('revoke all on %I from public, anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end;
$$;

-- La ligne unique de paramètres ne se supprime pas.
drop policy pricing_settings_delete on pricing_settings;
drop policy pricing_settings_insert on pricing_settings;

-- ----------------------------------------------------------------------------
-- 5. MODULE DE MENU « Tarification »
-- ----------------------------------------------------------------------------

insert into modules (key, label, description, display_order)
values ('tarification', 'Tarification', 'Prix de revient et prix de vente par modèle — Direction et administrateur uniquement', 25)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id,
       r.key in ('administrateur', 'direction'), r.key in ('administrateur', 'direction'), r.key in ('administrateur', 'direction'),
       false, r.key in ('administrateur', 'direction'), false, false
from roles r, modules m
where m.key = 'tarification'
  and not exists (select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id);
