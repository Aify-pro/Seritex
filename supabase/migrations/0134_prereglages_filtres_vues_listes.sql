-- ============================================================================
-- 0134 — Préréglages de filtres + vues de liste (demandes, devis, visites)
-- ============================================================================
-- 1. filter_presets : un préréglage = un nom + l'état d'une liste (la query
--    string de la page : recherche, filtres, tri). Il s'affiche en bouton
--    au-dessus de la liste du module (clients, demandes, demandes graphiques,
--    devis, articles, prospection).
--      • personnel par défaut (seul son auteur le voit et le modifie) ;
--      • partageable avec l'équipe (visible de tout le personnel ; réservé à qui
--        a le droit « modifier » sur le module) ;
--      • l'administrateur peut modifier / supprimer ceux des autres.
--    Un préréglage ne contient aucune donnée métier, seulement des critères.
-- 2. requests_list / quotes_list / visites_list : vues de liste (security_invoker : la RLS de
--    l'utilisateur s'applique) avec texte de recherche sans accents, comme
--    companies_list (0060). Filtres, tri et pagination s'exécutent en base.
-- Rien n'est supprimé ni réécrit dans les données existantes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Préréglages
-- ----------------------------------------------------------------------------

create table if not exists filter_presets (
  id uuid primary key default gen_random_uuid(),
  module text not null
    check (module in ('clients', 'demandes', 'demandes_graphiques', 'devis', 'articles', 'prospection')),
  name text not null check (length(btrim(name)) between 1 and 40),
  params text not null default '' check (length(params) <= 1000),
  shared boolean not null default false,
  owner_id uuid not null default auth.uid() references app_users(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_filter_presets_nom
  on filter_presets (owner_id, module, lower(btrim(name)));
create index if not exists idx_filter_presets_module on filter_presets (module, position, created_at);

comment on table filter_presets is
  'Préréglages de filtres des listes : params = query string de la page (sans la pagination).';

alter table filter_presets enable row level security;

create policy filter_presets_select on filter_presets for select
  using (owner_id = auth.uid() or (shared and is_staff()));

create policy filter_presets_insert on filter_presets for insert
  with check (
    owner_id = auth.uid() and is_staff()
    and (not shared or is_admin() or has_permission(module, 'modify'))
  );

create policy filter_presets_update on filter_presets for update
  using (owner_id = auth.uid() or is_admin())
  with check (
    (owner_id = auth.uid() or is_admin())
    and (not shared or is_admin() or has_permission(module, 'modify'))
  );

create policy filter_presets_delete on filter_presets for delete
  using (owner_id = auth.uid() or is_admin());

revoke all on filter_presets from public, anon;
grant select, insert, update, delete on filter_presets to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Vue de liste des demandes
-- ----------------------------------------------------------------------------

create or replace view requests_list with (security_invoker = true) as
select
  r.id,
  r.reference,
  r.status::text as status,
  r.source,
  r.description,
  r.needs_graphics,
  r.created_at,
  r.updated_at,
  r.company_id,
  c.name as company_name,
  coalesce(nullif(btrim(r.prospect ->> 'entreprise'), ''), nullif(btrim(r.prospect ->> 'nom'), '')) as prospect_label,
  case
    when r.company_id is not null then 'client'
    when r.prospect is not null then 'a_rattacher'
    else 'stock'
  end as kind,
  r.assigned_commercial_id,
  u.full_name as commercial_name,
  coalesce(q.n, 0) as quote_count,
  seritex_norm(concat_ws(' ',
    r.reference, c.name, r.prospect ->> 'entreprise', r.prospect ->> 'nom',
    r.prospect ->> 'email', r.description
  )) as search_text
from requests r
left join companies c on c.id = r.company_id
left join app_users u on u.id = r.assigned_commercial_id
left join lateral (select count(*)::int as n from quotes where request_id = r.id) q on true;

revoke all on requests_list from public, anon;
grant select on requests_list to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Vue de liste des devis
-- ----------------------------------------------------------------------------

create or replace view quotes_list with (security_invoker = true) as
select
  q.id,
  q.reference,
  q.status::text as status,
  q.total_amount,
  q.devise,
  q.valid_until,
  q.created_at,
  q.company_id,
  c.name as company_name,
  q.request_id,
  r.reference as request_reference,
  q.created_by,
  u.full_name as created_by_name,
  seritex_norm(concat_ws(' ', q.reference, c.name, r.reference, q.sage_piece)) as search_text
from quotes q
left join companies c on c.id = q.company_id
left join requests r on r.id = q.request_id
left join app_users u on u.id = q.created_by;

revoke all on quotes_list from public, anon;
grant select on quotes_list to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Vue de liste du journal des visites (Prospection)
-- ----------------------------------------------------------------------------

create or replace view visites_list with (security_invoker = true) as
select
  v.id,
  v.jour,
  v.nature,
  v.source,
  v.compte_rendu,
  v.resultat,
  v.prochaine_action,
  v.created_at,
  v.company_id,
  c.name as company_name,
  v.tiers_libelle,
  coalesce(c.name, v.tiers_libelle) as tiers,
  (v.company_id is null) as a_rattacher,
  v.app_user_id,
  u.full_name as auteur,
  seritex_norm(concat_ws(' ', c.name, v.tiers_libelle, v.compte_rendu, v.resultat, v.prochaine_action, u.full_name)) as search_text
from visites v
left join companies c on c.id = v.company_id
left join app_users u on u.id = v.app_user_id;

revoke all on visites_list from public, anon;
grant select on visites_list to authenticated;
