-- ============================================================================
-- Seritex — Droits de l'espace client : par société, avec restriction possible par compte
-- ============================================================================
--
-- Jusqu'ici, ce qu'un compte client voit était FIXE (règles RLS « le client de la société »).
-- Les droits du rôle « client » dans la matrice de Paramètres sont sans effet depuis 0128
-- (has_permission() est faux pour un client) : un client ne passe pas par la matrice.
-- Mécanisme dédié, simple et sûr :
--
--   · 7 droits : devis_voir, devis_accepter, commandes_voir, livraisons_voir,
--     mediatheque_voir, demandes_creer, echantillons_voir ;
--   · TOUT EST ACTIVÉ PAR DÉFAUT : on enregistre seulement les RETRAITS
--     (table client_droits_retires). Aucun compte existant ne change de comportement ;
--   · un retrait posé sur la SOCIÉTÉ vaut pour tous ses comptes ;
--   · un retrait posé sur un COMPTE ne peut que restreindre : un compte n'a jamais plus
--     que sa société ;
--   · le contrôle est dans la base (RLS, vues, fonctions), pas seulement dans l'affichage :
--     un droit retiré l'est aussi pour l'API.
--
-- Les règles existantes ne sont PAS recopiées depuis d'anciennes migrations : elles sont
-- relues à l'état courant dans la base (pg_policies, pg_get_viewdef, pg_get_functiondef) et
-- seule la branche « is_client_of(x) » devient « client_peut(x, 'droit') ». La migration
-- s'arrête (et rien n'est appliqué) si une règle attendue est introuvable ou contient une
-- forme que le remplacement ne sait pas traiter.
--
-- Le personnel n'est pas concerné (sa branche de chaque règle est inchangée).
-- Aucune donnée existante n'est modifiée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table des retraits
-- ----------------------------------------------------------------------------

create table client_droits_retires (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- null = retrait pour toute la société ; renseigné = retrait pour ce seul compte.
  user_id uuid references app_users(id) on delete cascade,
  droit text not null check (droit in (
    'devis_voir', 'devis_accepter', 'commandes_voir', 'livraisons_voir',
    'mediatheque_voir', 'demandes_creer', 'echantillons_voir'
  )),
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null
);

create unique index client_droits_retires_unique
  on client_droits_retires (company_id, droit, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index client_droits_retires_user_idx on client_droits_retires (user_id) where user_id is not null;

alter table client_droits_retires enable row level security;

-- Lecture : le personnel qui voit les clients. Écriture : uniquement par definir_droit_client().
create policy client_droits_retires_select on client_droits_retires for select
  using (has_permission('clients', 'view'));

comment on table client_droits_retires is
  'Droits de l''espace client RETIRÉS (tout est permis par défaut). user_id null = toute la société ; sinon ce compte seul (restriction uniquement).';

-- ----------------------------------------------------------------------------
-- 2. Fonction de contrôle
-- ----------------------------------------------------------------------------

-- Vrai si l'utilisateur courant est un compte client de cette société ET que le droit n'est retiré
-- ni à la société ni à son compte.
create or replace function client_peut(p_company_id uuid, p_droit text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_client_of(p_company_id)
     and not exists (
       select 1 from client_droits_retires r
        where r.company_id = p_company_id
          and r.droit = p_droit
          and (r.user_id is null or r.user_id = auth.uid())
     );
$$;

revoke all on function client_peut(uuid, text) from public, anon;
grant execute on function client_peut(uuid, text) to authenticated, service_role;

-- Droits effectifs de l'utilisateur courant (pour que le site masque les rubriques non autorisées).
-- Vide pour un compte qui n'est pas client.
create or replace function client_droits_effectifs()
returns table (droit text, autorise boolean)
language sql
stable
security definer
set search_path = public
as $$
  select d.droit,
         not exists (
           select 1 from client_droits_retires r
            where r.company_id = u.company_id
              and r.droit = d.droit
              and (r.user_id is null or r.user_id = u.id)
         )
    from app_users u
    cross join (values
      ('devis_voir'), ('devis_accepter'), ('commandes_voir'), ('livraisons_voir'),
      ('mediatheque_voir'), ('demandes_creer'), ('echantillons_voir')
    ) as d(droit)
   where u.id = auth.uid() and u.role = 'client' and u.company_id is not null;
$$;

revoke all on function client_droits_effectifs() from public, anon;
grant execute on function client_droits_effectifs() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Réglage par le personnel
-- ----------------------------------------------------------------------------

-- p_user null  : règle la société (p_autorise false = retire le droit à tous ses comptes).
-- p_user posé  : règle ce compte. p_autorise false = restreint ce compte ; true = il hérite de
--                sa société (un compte ne peut jamais avoir PLUS que sa société).
create or replace function definir_droit_client(
  p_company uuid,
  p_droit text,
  p_autorise boolean,
  p_user uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('clients', 'modify') then
    raise exception 'accès refusé';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'société introuvable';
  end if;
  if p_droit not in (
    'devis_voir', 'devis_accepter', 'commandes_voir', 'livraisons_voir',
    'mediatheque_voir', 'demandes_creer', 'echantillons_voir'
  ) then
    raise exception 'droit inconnu : %', p_droit;
  end if;
  if p_user is not null and not exists (
    select 1 from app_users where id = p_user and role = 'client' and company_id = p_company
  ) then
    raise exception 'ce compte n''est pas un compte client de cette société';
  end if;

  if p_autorise then
    delete from client_droits_retires
     where company_id = p_company and droit = p_droit and user_id is not distinct from p_user;
  else
    insert into client_droits_retires (company_id, user_id, droit, created_by)
    values (p_company, p_user, p_droit, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function definir_droit_client(uuid, text, boolean, uuid) from public, anon;
grant execute on function definir_droit_client(uuid, text, boolean, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Application aux règles existantes (relues à l'état courant de la base)
-- ----------------------------------------------------------------------------

do $migration$
declare
  -- table, règle, droit
  v_regles constant text[][] := array[
    array['quotes',                      'quotes_select',                      'devis_voir'],
    array['quote_lines',                 'quote_lines_select',                 'devis_voir'],
    array['quote_line_media_files',      'quote_line_media_files_select',      'devis_voir'],
    array['quote_line_printable_zones',  'quote_line_printable_zones_select',  'devis_voir'],
    array['quote_line_size_prices',      'quote_line_size_prices_select',      'devis_voir'],
    array['quote_line_sizes',            'quote_line_sizes_select',            'devis_voir'],
    array['quote_line_zone_colors',      'quote_line_zone_colors_select',      'devis_voir'],
    array['media_files',                 'media_files_select',                 'mediatheque_voir'],
    array['media_file_versions',         'media_file_versions_select',         'mediatheque_voir'],
    array['media_file_events',           'media_file_events_select',           'mediatheque_voir'],
    array['media_file_copies',           'media_file_copies_select',           'mediatheque_voir'],
    array['requests',                    'requests_insert',                    'demandes_creer'],
    array['sample_requests',             'sample_requests_select',             'echantillons_voir'],
    array['sample_feedback',             'sample_feedback_select',             'echantillons_voir'],
    array['sample_items',                'sample_items_all',                   'echantillons_voir'],
    array['sample_attachments',          'sample_attachments_all',             'echantillons_voir'],
    array['sample_request_media_files',  'sample_request_media_files_all',     'echantillons_voir']
  ];
  -- vue, droit
  v_vues constant text[][] := array[
    array['client_commandes',          'commandes_voir'],
    array['client_livraisons',         'livraisons_voir'],
    array['client_livraison_lignes',   'livraisons_voir'],
    array['client_livraison_suivi',    'livraisons_voir']
  ];
  -- fonction, droit
  v_fonctions constant text[][] := array[
    array['accept_quote',         'devis_accepter'],
    array['valider_echantillon',  'echantillons_voir'],
    array['refuser_echantillon',  'echantillons_voir']
  ];
  v_i int;
  v_qual text;
  v_check text;
  v_def text;
  v_motif constant text := 'is_client_of\(([a-z_][a-z0-9_.]*)\)';
  v_sql text;
begin
  -- Règles de sécurité (RLS)
  for v_i in 1 .. array_length(v_regles, 1) loop
    select qual, with_check into v_qual, v_check
      from pg_policies
     where schemaname = 'public' and tablename = v_regles[v_i][1] and policyname = v_regles[v_i][2];
    if not found then
      raise exception '0140 : règle % de % introuvable', v_regles[v_i][2], v_regles[v_i][1];
    end if;
    if coalesce(v_qual, '') !~ 'is_client_of\(' and coalesce(v_check, '') !~ 'is_client_of\(' then
      raise exception '0140 : la règle % de % ne contient pas is_client_of', v_regles[v_i][2], v_regles[v_i][1];
    end if;

    v_qual := regexp_replace(v_qual, v_motif, 'client_peut(\1, ''' || v_regles[v_i][3] || ''')', 'g');
    v_check := regexp_replace(v_check, v_motif, 'client_peut(\1, ''' || v_regles[v_i][3] || ''')', 'g');
    if coalesce(v_qual, '') ~ 'is_client_of\(' or coalesce(v_check, '') ~ 'is_client_of\(' then
      raise exception '0140 : forme inattendue dans la règle % de %', v_regles[v_i][2], v_regles[v_i][1];
    end if;

    v_sql := format('alter policy %I on public.%I', v_regles[v_i][2], v_regles[v_i][1]);
    if v_qual is not null then v_sql := v_sql || ' using (' || v_qual || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;

  -- Vues réservées au client
  for v_i in 1 .. array_length(v_vues, 1) loop
    v_def := pg_get_viewdef(('public.' || v_vues[v_i][1])::regclass, true);
    if v_def !~ 'is_client_of\(' then
      raise exception '0140 : la vue % ne contient pas is_client_of', v_vues[v_i][1];
    end if;
    v_def := regexp_replace(v_def, v_motif, 'client_peut(\1, ''' || v_vues[v_i][2] || ''')', 'g');
    if v_def ~ 'is_client_of\(' then
      raise exception '0140 : forme inattendue dans la vue %', v_vues[v_i][1];
    end if;
    execute format('create or replace view public.%I as %s', v_vues[v_i][1], rtrim(rtrim(v_def), ';'));
  end loop;

  -- Fonctions (acceptation du devis, validation / refus d'échantillon par le client)
  for v_i in 1 .. array_length(v_fonctions, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v_fonctions[v_i][1];
    if v_def is null or v_def !~ 'is_client_of\(' then
      raise exception '0140 : la fonction % est introuvable ou ne contient pas is_client_of', v_fonctions[v_i][1];
    end if;
    v_def := regexp_replace(v_def, v_motif, 'client_peut(\1, ''' || v_fonctions[v_i][2] || ''')', 'g');
    if v_def ~ 'is_client_of\(' then
      raise exception '0140 : forme inattendue dans la fonction %', v_fonctions[v_i][1];
    end if;
    execute v_def;
  end loop;
end;
$migration$;
