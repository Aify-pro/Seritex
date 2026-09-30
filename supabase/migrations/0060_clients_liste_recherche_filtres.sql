-- ============================================================================
-- Seritex — Module Clients : recherche, filtres et compteurs côté base
-- ============================================================================
--
-- Prérequis : migration 0059 (companies.sage_code et champs Sage).
--
-- Objets créés :
--   - sage_representants : commerciaux Sage (F_COLLABORATEUR), miroir lecture
--     seule alimenté par sync.js, pour afficher/filtrer le commercial d'un client.
--   - seritex_norm(text) : normalisation de recherche (minuscules, sans accents)
--     sans dépendre d'une extension.
--   - companies_list : vue de liste (security_invoker : la RLS de l'utilisateur
--     s'applique) avec le nombre de contacts, les comptes portail, l'activité en
--     cours, la dernière activité et un texte de recherche normalisé qui couvre
--     la fiche ET ses contacts (noms, e-mails, téléphones).
--   - company_filter_options() : valeurs distinctes + effectifs pour alimenter
--     les listes déroulantes de filtres.
--
-- Aucune donnée n'est modifiée ni supprimée.

-- ----------------------------------------------------------------------------
-- 1. Commerciaux Sage (miroir lecture seule)
-- ----------------------------------------------------------------------------

create table sage_representants (
  co_no int primary key,
  name text not null,
  last_sync_at timestamptz not null default now()
);

alter table sage_representants enable row level security;

-- Même règle que sage_customers_view : lecture pour le staff qui en a l'usage,
-- aucune écriture depuis une session applicative (job de synchro = service_role).
create policy sage_representants_select on sage_representants for select
  using (is_commercial_or_above() or is_production_manager());

comment on table sage_representants is
  'Collaborateurs / commerciaux Sage (F_COLLABORATEUR) — miroir lecture seule (migration 0060).';

-- ----------------------------------------------------------------------------
-- 2. Normalisation de recherche
-- ----------------------------------------------------------------------------

create or replace function seritex_norm(t text) returns text
language sql immutable parallel safe
as $$
  select lower(translate(
    coalesce(t, ''),
    'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
    'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy'
  ))
$$;

-- ----------------------------------------------------------------------------
-- 3. Index sur les clés de jointure de la vue de liste
-- ----------------------------------------------------------------------------

create index if not exists idx_contacts_company on contacts (company_id);
create index if not exists idx_requests_company on requests (company_id);
create index if not exists idx_production_orders_company on production_orders (company_id);

-- ----------------------------------------------------------------------------
-- 4. Vue de liste
-- ----------------------------------------------------------------------------

create view companies_list with (security_invoker = true) as
select
  c.id,
  c.name,
  c.sage_code,
  c.origin,
  c.siret,
  c.address,
  c.postal_code,
  c.city,
  c.country,
  c.phone,
  c.email,
  c.website,
  c.vat_number,
  nullif(upper(btrim(c.sage_famille)), '') as famille,
  nullif(upper(btrim(c.sage_sous_famille)), '') as zone,
  nullif(btrim(c.sage_typologie), '') as typologie,
  nullif(btrim(c.sage_categorie), '') as categorie,
  nullif(upper(btrim(c.city)), '') as ville,
  nullif(upper(btrim(c.country)), '') as pays,
  c.sage_is_prospect as is_prospect,
  c.sage_representant_no as representant_no,
  rep.name as representant_name,
  c.sage_created_at,
  c.created_at,
  case
    when c.sage_archived_at is not null then 'archive'
    when not c.sage_active then 'sommeil'
    else 'actif'
  end as statut,
  coalesce(k.total, 0) as contact_count,
  coalesce(k.actifs, 0) as active_contact_count,
  coalesce(pa.n, 0) as portal_account_count,
  coalesce(rq.n_open, 0) as open_request_count,
  coalesce(po.n_open, 0) as open_odf_count,
  coalesce(rq.n_open, 0) + coalesce(po.n_open, 0) as open_activity_count,
  greatest(rq.last_at, po.last_at) as last_activity_at,
  -- Texte de recherche : fiche + contacts, normalisé (minuscules, sans accents),
  -- avec une version « chiffres seuls » des téléphones pour qu'une saisie
  -- « 0708123456 » retrouve « 07 08 12 34 56 ».
  seritex_norm(concat_ws(' ',
    c.name, c.sage_code, c.siret, c.vat_number, c.city, c.postal_code, c.address,
    c.phone, regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'),
    c.email, c.website, k.txt
  )) as search_text
from companies c
left join sage_representants rep on rep.co_no = c.sage_representant_no
left join lateral (
  select
    count(*)::int as total,
    (count(*) filter (where ct.status = 'actif'))::int as actifs,
    string_agg(concat_ws(' ',
      ct.first_name, ct.last_name, ct.email, ct.phone, ct.mobile_phone,
      regexp_replace(coalesce(ct.phone, ''), '\D', '', 'g'),
      regexp_replace(coalesce(ct.mobile_phone, ''), '\D', '', 'g')
    ), ' ') as txt
  from contacts ct
  where ct.company_id = c.id
) k on true
left join lateral (
  select count(*)::int as n
  from app_users u
  where u.company_id = c.id and u.role = 'client'
) pa on true
left join lateral (
  select
    (count(*) filter (where r.status::text not in ('refusee', 'acceptee', 'cloturee')))::int as n_open,
    max(r.created_at) as last_at
  from requests r
  where r.company_id = c.id
) rq on true
left join lateral (
  select
    (count(*) filter (where p.status::text not in ('terminee', 'annulee')))::int as n_open,
    max(p.created_at) as last_at
  from production_orders p
  where p.company_id = c.id
) po on true;

-- Jamais accessible sans session : la RLS des tables sous-jacentes (staff
-- uniquement) s'applique en plus grâce à security_invoker.
revoke all on companies_list from public, anon;
grant select on companies_list to authenticated;

comment on view companies_list is
  'Vue de liste du module Clients (migration 0060) : compteurs de contacts / comptes portail / activité en cours et texte de recherche normalisé. security_invoker : la RLS de l''utilisateur s''applique.';

-- ----------------------------------------------------------------------------
-- 5. Valeurs de filtres
-- ----------------------------------------------------------------------------

create or replace function company_filter_options() returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'familles', coalesce((
      select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v)
      from (select famille as v, count(*) as n from companies_list where famille is not null group by famille) s
    ), '[]'::jsonb),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v)
      from (select zone as v, count(*) as n from companies_list where zone is not null group by zone) s
    ), '[]'::jsonb),
    'typologies', coalesce((
      select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v)
      from (select typologie as v, count(*) as n from companies_list where typologie is not null group by typologie) s
    ), '[]'::jsonb),
    'villes', coalesce((
      select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v)
      from (select ville as v, count(*) as n from companies_list where ville is not null group by ville) s
    ), '[]'::jsonb),
    'pays', coalesce((
      select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v)
      from (select pays as v, count(*) as n from companies_list where pays is not null group by pays) s
    ), '[]'::jsonb),
    'representants', coalesce((
      select jsonb_agg(jsonb_build_object('value', v::text, 'label', l, 'count', n) order by l)
      from (
        select representant_no as v, max(representant_name) as l, count(*) as n
        from companies_list
        where representant_no is not null and representant_name is not null
        group by representant_no
      ) s
    ), '[]'::jsonb)
  );
$$;

-- Même règle que les autres fonctions du projet : EXECUTE retiré à anon
-- (Supabase l'accorde directement à anon), accordé à authenticated seul.
revoke all on function company_filter_options() from public, anon, authenticated;
grant execute on function company_filter_options() to authenticated;
