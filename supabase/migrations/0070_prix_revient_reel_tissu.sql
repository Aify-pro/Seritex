-- ============================================================================
-- 0070 — Prix de revient réel d'un ODF : le tissu (lot F, chantier Tarification)
-- ============================================================================
--
-- Décision de la direction : le prix de revient « réel » ne porte que sur le
-- TISSU. Le théorique figé à la validation du devis (quote_cost_snapshots,
-- 0068) sert de base ; sa part tissu est remplacée par le tissu réellement
-- consommé, mesuré par les pesées de l'ODF (réception tissu − retour stock,
-- table pesees, lot 7) au prix du tissu au kg. Col, impressions, confection,
-- charges fixes : repris du théorique. Calcul : src/lib/real-cost.ts.
--
-- Il faut donc :
--   1. savoir quelle part du prix de revient théorique est du tissu : drapeau
--      est_tissu sur les composants de la grille (repris dans le chiffrage
--      figé). Les composants existants nommés « Tissu… » sont cochés ;
--   2. un prix du tissu au kg (rendu, douane comprise) : par textile dans la
--      Tarification, et ajustable ODF par ODF (un même textile n'a pas le même
--      prix selon la famille de couleur — White / Light / Medium / Dark dans
--      l'Excel V7).
--
-- Confidentialité : prix au kg et analyses d'ODF sont des coûts — Direction et
-- administrateur uniquement (is_admin()), comme le reste de la Tarification.
-- ============================================================================

-- 1. Part tissu des composants de la grille ---------------------------------

alter table model_cost_components
  add column if not exists est_tissu boolean not null default false;

update model_cost_components set est_tissu = true where lower(trim(libelle)) like 'tissu%';

comment on column model_cost_components.est_tissu is
  'Composant tissu : c''est cette part du prix de revient théorique que remplace le tissu réellement consommé (pesées) dans le prix de revient réel.';

-- 2. Prix du tissu au kg, par textile -----------------------------------------

create table textile_prices (
  textile_id uuid primary key references textiles(id) on delete cascade,
  prix_kg numeric(12, 2) not null check (prix_kg > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table textile_prices is
  'Prix du tissu au kg, rendu (douane comprise), par textile — valeur par défaut du prix de revient réel des ODF.';

-- 3. Analyse du prix de revient réel, par ODF ---------------------------------

create table production_order_real_costs (
  production_order_id uuid primary key references production_orders(id) on delete cascade,
  -- Null : prix du textile des articles (s'il est unique et renseigné).
  prix_tissu_kg numeric(12, 2) check (prix_tissu_kg is null or prix_tissu_kg > 0),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table production_order_real_costs is
  'Paramètres de l''analyse du prix de revient réel d''un ODF : prix du tissu au kg propre à cet ODF (sinon celui du textile) et notes. Le calcul se refait à chaque consultation, à partir des pesées.';

do $$
declare
  t text;
begin
  foreach t in array array['textile_prices', 'production_order_real_costs']
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
