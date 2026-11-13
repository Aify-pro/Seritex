-- ============================================================
-- 0187 — Imbrication, phase 4 : agents IA
-- ============================================================
-- Des agents IA (Claude, n8n…) pilotent le calcul de tracés par des OUTILS
-- (route /api/agents/…). Principe : c'est le moteur qui calcule ; l'agent
-- lit les besoins, demande un plan de coupe, lance des calculs et compare.
-- Il ne décide jamais : un calcul lancé par un agent est une PROPOSITION,
-- seule une personne peut en faire le fichier d'un tracé.
--
--  * agents_ia : un agent = un jeton (seule son empreinte SHA-256 est
--    gardée), des droits (« lecture », « calcul ») et un PROPRIÉTAIRE : il
--    agit au nom de cet utilisateur et jamais au-delà de ses droits (s'il
--    perd un droit ou est désactivé, l'agent le perd aussi). Géré par
--    l'administrateur de la plateforme ; on révoque, on ne supprime pas.
--  * agents_ia_journal : chaque appel d'outil (agent, outil, arguments,
--    résultat résumé, durée), écrit par le serveur.
--  * imbrication_calculs.agent_id : le calcul a été lancé par cet agent.
--  * Fonctions réservées au serveur (service_role) pour agir au nom du
--    propriétaire : droit, besoins de coupe, réservations de rouleaux.
-- ============================================================

-- 1. Module de réglage (écran « Agents IA », administrateur de la plateforme)
insert into modules (key, label, description, display_order) values
  ('agents_ia', 'Agents IA', 'Jetons des agents IA qui pilotent le calcul des tracés, droits et journal de leurs actions', 186)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m where m.key = 'agents_ia'
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = true
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'agents_ia'
  and r.base_role::text = 'administrateur';

-- 2. Agents
create table if not exists agents_ia (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) between 2 and 80),
  description text,
  empreinte_jeton text not null unique check (empreinte_jeton ~ '^[0-9a-f]{64}$'),
  prefixe_jeton text not null,
  droits text[] not null default '{lecture}'
    check (cardinality(droits) between 1 and 2 and droits <@ array['lecture', 'calcul']::text[]),
  proprietaire uuid not null references app_users(id) on delete restrict,
  actif boolean not null default true,
  cree_par uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  derniere_utilisation_le timestamptz,
  revoque_le timestamptz,
  revoque_par uuid references app_users(id) on delete set null,
  constraint agents_ia_revoque_inactif check (revoque_le is null or not actif)
);

create unique index if not exists agents_ia_nom_actif on agents_ia (lower(nom)) where actif;

alter table agents_ia enable row level security;
drop policy if exists agents_ia_select on agents_ia;
create policy agents_ia_select on agents_ia for select using (is_platform_admin());
drop policy if exists agents_ia_insert on agents_ia;
create policy agents_ia_insert on agents_ia for insert with check (is_platform_admin() and cree_par = auth.uid() and actif);
drop policy if exists agents_ia_update on agents_ia;
create policy agents_ia_update on agents_ia for update using (is_platform_admin()) with check (is_platform_admin());
revoke all on agents_ia from public, anon;
grant select, insert, update on agents_ia to authenticated;

-- Un jeton révoqué ne revit pas.
create or replace function agents_ia_revocation_definitive()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.revoque_le is not null and (new.actif or new.revoque_le is null) then
    raise exception 'Un agent révoqué ne peut pas être réactivé : créez-en un nouveau.';
  end if;
  if new.empreinte_jeton <> old.empreinte_jeton then
    raise exception 'Le jeton d''un agent ne se modifie pas : créez un nouvel agent.';
  end if;
  return new;
end;
$$;
drop trigger if exists agents_ia_revocation_definitive on agents_ia;
create trigger agents_ia_revocation_definitive before update on agents_ia
  for each row execute function agents_ia_revocation_definitive();

-- 3. Journal des appels d'outils
create table if not exists agents_ia_journal (
  id bigint generated always as identity primary key,
  agent_id uuid not null references agents_ia(id) on delete cascade,
  outil text not null,
  arguments jsonb not null default '{}'::jsonb,
  statut text not null check (statut in ('ok', 'erreur', 'refuse')),
  resultat jsonb,
  erreur text,
  duree_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists agents_ia_journal_agent on agents_ia_journal (agent_id, created_at desc);
create index if not exists agents_ia_journal_date on agents_ia_journal (created_at desc);

alter table agents_ia_journal enable row level security;
drop policy if exists agents_ia_journal_select on agents_ia_journal;
create policy agents_ia_journal_select on agents_ia_journal for select using (is_platform_admin() or has_permission('patronnage', 'view'));
revoke all on agents_ia_journal from public, anon;
grant select on agents_ia_journal to authenticated;

-- 4. Calculs lancés par un agent
alter table imbrication_calculs
  add column if not exists agent_id uuid references agents_ia(id) on delete set null;
create index if not exists imbrication_calculs_agent on imbrication_calculs (agent_id, created_at desc) where agent_id is not null;

-- 5. Agir au nom du propriétaire (serveur seulement)
--    L'identité est posée pour la seule transaction de l'appel : les règles
--    habituelles (has_permission, is_staff) s'appliquent alors au
--    propriétaire de l'agent, exactement comme s'il était connecté.
create or replace function agent_endosser(p_user uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_user is null or not exists (select 1 from app_users where id = p_user and coalesce(active, true)) then
    raise exception 'Propriétaire de l''agent introuvable ou désactivé.';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function agent_a_le_droit(p_user uuid, p_module text, p_action text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform agent_endosser(p_user);
  return coalesce(has_permission(p_module, p_action), false);
exception when others then
  return false;
end;
$$;

create or replace function besoins_coupe_agent(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform agent_endosser(p_user);
  select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) into v from besoins_coupe_agreges() b;
  return v;
end;
$$;

create or replace function reservations_rouleaux_agent(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  perform agent_endosser(p_user);
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v from reservations_rouleaux() r;
  return v;
end;
$$;

revoke all on function agent_endosser(uuid) from public, anon, authenticated;
revoke all on function agent_a_le_droit(uuid, text, text) from public, anon, authenticated;
revoke all on function besoins_coupe_agent(uuid) from public, anon, authenticated;
revoke all on function reservations_rouleaux_agent(uuid) from public, anon, authenticated;
grant execute on function agent_a_le_droit(uuid, text, text) to service_role;
grant execute on function besoins_coupe_agent(uuid) to service_role;
grant execute on function reservations_rouleaux_agent(uuid) to service_role;
