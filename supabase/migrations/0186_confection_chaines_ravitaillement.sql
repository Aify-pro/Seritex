-- ============================================================================
-- 0186 — Module Confection, lot 1 : chaînes de couture, ravitaillement par
--        scan des paquets QR, sorties de chaîne, rendement par chaîne
-- ============================================================================
--
-- Plan : Seritex-plans/module-confection.md (décisions C1-C24, 2026-11-13).
--
--   1. Référentiel : chaînes dans les sections de couture, postes, types de
--      machines, agents de chaîne (un agent par chaîne, sa tablette),
--      affiliation historisée personnel ↔ chaîne / poste.
--   2. Travaux : le chef de section attribue des sous-ODF aux chaînes ;
--      l'agent voit sur sa tablette ce qu'il doit aller chercher.
--   3. Ravitaillement : l'agent scanne un paquet et le livre à sa chaîne, en
--      entier ou en partie (le sous-paquet reçoit un nouveau code QR).
--   4. Sortie : l'agent compte ce qui sort de la chaîne (bonnes, reprises,
--      rebuts) ; la sortie est aussi déclarée au moteur d'ODF. Si le moteur
--      refuse la déclaration, la sortie est gardée « à régulariser » : la
--      chaîne n'est jamais bloquée.
--   5. Rendement par chaîne et par jour : sorties ÷ présents (pointage s'il
--      est importé, sinon effectif saisi).
--
-- Ajout seul : aucune fonction du moteur d'ODF ni des lots n'est modifiée
-- (scan_article_lot, split_article_lot, declare_production restent tels
-- quels). Le module a ses propres fonctions, gardées par la matrice
-- Rôles & permissions. Aucun suivi individuel ni appareil dans ce lot.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DROITS
-- ----------------------------------------------------------------------------

insert into modules (key, label, description, display_order) values
  ('confection', 'Confection', 'Chaînes de couture : travaux attribués, équipe, effectif du jour, arrêts, rendement par chaîne', 47),
  ('confection_ravitaillement', 'Confection — tablette de chaîne', 'Ravitailler une chaîne par scan des paquets, diviser un paquet, compter les sorties de chaîne', 48),
  ('parametres_confection', 'Paramètres confection', 'Chaînes, postes, types de machines, agents de chaîne', 176)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where m.key in ('confection', 'confection_ravitaillement', 'parametres_confection')
on conflict (role_id, module_id) do nothing;

create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('confection',                'view',     array['administrateur', 'responsable_production', 'chef_section']),
  ('confection',                'create',   array['administrateur', 'responsable_production', 'chef_section']),
  ('confection',                'modify',   array['administrateur', 'responsable_production', 'chef_section']),
  ('confection',                'validate', array['administrateur', 'responsable_production']),
  ('confection_ravitaillement', 'view',     array['administrateur', 'responsable_production', 'chef_section']),
  ('confection_ravitaillement', 'create',   array['administrateur', 'responsable_production', 'chef_section']),
  ('confection_ravitaillement', 'modify',   array['administrateur', 'responsable_production', 'chef_section']),
  ('parametres_confection',     'view',     array['administrateur', 'responsable_production']),
  ('parametres_confection',     'create',   array['administrateur', 'responsable_production']),
  ('parametres_confection',     'modify',   array['administrateur', 'responsable_production']),
  ('parametres_confection',     'delete',   array['administrateur']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action when 'view' then 'can_view' when 'create' then 'can_create' when 'modify' then 'can_modify'
                           when 'delete' then 'can_delete' when 'validate' then 'can_validate' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- Rôle « Agent de chaîne » (C15). Rôle de base chef_section : l'agent est
-- rattaché à sa section, et le moteur d'ODF accepte sa déclaration de sortie
-- sans être modifié. Ses écrans, eux, viennent de la matrice : la tablette de
-- chaîne seulement.
insert into roles (key, label, description, base_role, is_system, active) values
  ('agent_chaine', 'Agent de chaîne',
   'Ravitaille sa chaîne de couture (scan des paquets, division) et compte ce qui en sort. Un compte par agent, rattaché à sa section et à sa chaîne.',
   'chef_section', false, true)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where r.key = 'agent_chaine'
on conflict (role_id, module_id) do nothing;

update role_permissions rp
set can_view = (m.key = 'confection_ravitaillement'),
    can_create = (m.key = 'confection_ravitaillement'),
    can_modify = false, can_archive = false, can_delete = false, can_validate = false, can_unlock = false
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and r.key = 'agent_chaine';

-- ----------------------------------------------------------------------------
-- 2. RÉFÉRENTIEL DE L'ATELIER
-- ----------------------------------------------------------------------------

create table if not exists types_machines_couture (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists types_machines_couture_nom_unique on types_machines_couture (lower(btrim(nom)));

comment on table types_machines_couture is
  'Types de machines à coudre (0186) : liste tenue par l''atelier. Distincte de la table machines (sérigraphie, 0119).';

create table if not exists chaines_couture (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  type text not null default 'permanente' check (type in ('permanente', 'support')),
  minutes_jour int not null default 480 check (minutes_jour between 60 and 1440),
  ordre int not null default 0,
  active boolean not null default true,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chaines_couture_code_unique on chaines_couture (code);
create index if not exists idx_chaines_couture_section on chaines_couture (section_id);

comment on table chaines_couture is
  'Chaînes de couture d''une section (0186) : unité de travail de l''atelier (ex. Bonneterie 1). Une chaîne désactivée garde tout son historique.';
comment on column chaines_couture.minutes_jour is
  'Minutes de travail d''une journée normale : sert au rendement quand le pointage ne donne pas les heures.';

-- La section d'une chaîne est une section de couture.
create or replace function chaines_couture_controle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if section_categorie_cle(new.section_id) is distinct from 'couture' then
    raise exception 'une chaîne se crée dans une section de couture';
  end if;
  new.code := upper(btrim(new.code));
  return new;
end;
$$;

drop trigger if exists trg_chaines_couture_controle on chaines_couture;
create trigger trg_chaines_couture_controle
  before insert or update of section_id, code on chaines_couture
  for each row execute function chaines_couture_controle();

drop trigger if exists trg_set_updated_at on chaines_couture;
create trigger trg_set_updated_at before update on chaines_couture
  for each row execute function set_updated_at();

create table if not exists postes_couture (
  id uuid primary key default gen_random_uuid(),
  -- Vide = poste commun à plusieurs chaînes de la section (C7, C19).
  chaine_id uuid references chaines_couture(id) on delete cascade,
  section_id uuid not null references sections(id),
  numero int not null check (numero between 1 and 999),
  libelle text check (libelle is null or length(libelle) <= 120),
  type_machine_id uuid references types_machines_couture(id) on delete set null,
  actif boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists postes_couture_numero_chaine on postes_couture (chaine_id, numero) where chaine_id is not null;
create unique index if not exists postes_couture_numero_commun on postes_couture (section_id, numero) where chaine_id is null;

comment on table postes_couture is
  'Postes de couture (0186) : numérotés dans leur chaîne ; chaine_id vide = poste commun de la section.';

-- Agents d'une chaîne : comptes autorisés à ravitailler et à sortir pour elle.
create table if not exists chaine_agents (
  id uuid primary key default gen_random_uuid(),
  chaine_id uuid not null references chaines_couture(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chaine_agents_unique unique (chaine_id, user_id)
);
create index if not exists idx_chaine_agents_user on chaine_agents (user_id);

comment on table chaine_agents is
  'Comptes des agents d''une chaîne (0186, C15) : un agent ne ravitaille et ne sort que pour ses chaînes.';

-- Affiliation personnel ↔ chaîne / poste, historisée (même motif que vehicle_assignments, 0170).
create table if not exists affectations_couture (
  id uuid primary key default gen_random_uuid(),
  employe_id uuid not null references employes(id) on delete restrict,
  chaine_id uuid not null references chaines_couture(id) on delete restrict,
  poste_id uuid references postes_couture(id) on delete set null,
  fonction text not null default 'couture' check (fonction in ('couture', 'chef_chaine', 'agent', 'commun', 'autre')),
  debut timestamptz not null default now(),
  fin timestamptz,
  motif text check (motif is null or length(motif) <= 200),
  source text not null default 'saisie' check (source in ('saisie', 'repartition', 'badge')),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint affectations_couture_dates check (fin is null or fin >= debut)
);
-- Une personne n'occupe qu'une place à la fois : la précédente se ferme d'abord.
create unique index if not exists affectations_couture_une_en_cours on affectations_couture (employe_id) where fin is null;
create index if not exists idx_affectations_couture_chaine on affectations_couture (chaine_id, debut desc);

comment on table affectations_couture is
  'Qui travaille sur quelle chaîne (et quel poste), de quand à quand (0186). Un changement ferme la ligne et en ouvre une autre : rien n''est écrasé. Ne contient aucun chiffre de rendement.';

-- ----------------------------------------------------------------------------
-- 3. TRAVAUX, PRÉSENCES, ARRÊTS, SORTIES
-- ----------------------------------------------------------------------------

create table if not exists chaine_travaux (
  id uuid primary key default gen_random_uuid(),
  chaine_id uuid not null references chaines_couture(id) on delete cascade,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  priorite int not null default 0,
  quantite_prevue int check (quantite_prevue is null or quantite_prevue > 0),
  consigne text check (consigne is null or length(consigne) <= 300),
  statut text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'termine')),
  attribue_par uuid references app_users(id) on delete set null default auth.uid(),
  attribue_le timestamptz not null default now(),
  demarre_le timestamptz,
  termine_le timestamptz,
  constraint chaine_travaux_unique unique (chaine_id, work_order_id)
);
create index if not exists idx_chaine_travaux_wo on chaine_travaux (work_order_id);

comment on table chaine_travaux is
  'Travaux d''une chaîne (0186, C16) : sous-ODF attribués par le chef de section (à faire), ou ouverts tout seuls au premier paquet livré. C''est ce que la tablette de l''agent lui demande d''aller chercher.';

create table if not exists presences_chaine (
  id uuid primary key default gen_random_uuid(),
  chaine_id uuid not null references chaines_couture(id) on delete cascade,
  jour date not null,
  presents int not null check (presents between 0 and 500),
  minutes_presence int check (minutes_presence is null or minutes_presence >= 0),
  saisi_par uuid references app_users(id) on delete set null default auth.uid(),
  saisi_le timestamptz not null default now(),
  constraint presences_chaine_unique unique (chaine_id, jour)
);

comment on table presences_chaine is
  'Effectif présent saisi pour une chaîne et un jour (0186). Sert tant que le pointage du jour n''est pas importé dans Personnel ; le pointage fait foi dès qu''il existe.';

create table if not exists arrets_chaine (
  id uuid primary key default gen_random_uuid(),
  chaine_id uuid not null references chaines_couture(id) on delete cascade,
  debut timestamptz not null default now(),
  fin timestamptz,
  cause text not null check (cause in ('coupure_courant', 'attente_ravitaillement', 'panne', 'changement_modele', 'autre')),
  commentaire text check (commentaire is null or length(commentaire) <= 300),
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint arrets_chaine_dates check (fin is null or fin >= debut)
);
create index if not exists idx_arrets_chaine on arrets_chaine (chaine_id, debut desc);

create table if not exists sorties_chaine (
  id uuid primary key default gen_random_uuid(),
  chaine_id uuid not null references chaines_couture(id) on delete restrict,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade,
  type text not null check (type in ('bonne', 'reprise', 'rebut')),
  quantite int not null,
  jour date not null default current_date,
  article_lot_id uuid references article_lots(id),
  -- Déclaration au moteur d'ODF (bonne → bonne, rebut → déchet). Vide avec un
  -- message : la sortie est à régulariser par le chef de section.
  declaration_id uuid references production_declarations(id) on delete set null,
  declaration_erreur text,
  corrige_id uuid references sorties_chaine(id),
  motif text,
  created_by uuid references app_users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sorties_chaine_quantite_signe check (quantite > 0 or (quantite < 0 and corrige_id is not null)),
  constraint sorties_chaine_correction_motivee check (corrige_id is null or (motif is not null and btrim(motif) <> ''))
);
create index if not exists idx_sorties_chaine_jour on sorties_chaine (chaine_id, jour);
create index if not exists idx_sorties_chaine_line on sorties_chaine (production_order_line_id);

comment on table sorties_chaine is
  'Comptage en sortie de chaîne par l''agent (0186, C5, C17), en ajout seul : une correction est une ligne négative motivée. Les reprises restent dans l''en-cours de la chaîne.';

-- Clés d'idempotence : un scan renvoyé (double appui, réseau instable) ne compte qu'une fois.
create table if not exists confection_cles (
  cle uuid primary key,
  operation text not null,
  resultat jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 4. PAQUETS : LA CHAÎNE DANS LE PARCOURS D'UN LOT (extension, pas de doublon)
-- ----------------------------------------------------------------------------

alter table article_lots
  add column if not exists chaine_id uuid references chaines_couture(id) on delete set null;
create index if not exists idx_article_lots_chaine on article_lots (chaine_id) where chaine_id is not null;

comment on column article_lots.chaine_id is
  'Chaîne de couture qui détient le paquet (0186) ; vide tant qu''il n''est livré à aucune chaîne.';

alter table article_lot_events
  add column if not exists chaine_id uuid references chaines_couture(id) on delete set null;
create index if not exists idx_article_lot_events_chaine on article_lot_events (chaine_id, created_at) where chaine_id is not null;

alter table article_lot_events drop constraint if exists article_lot_events_type_check;
alter table article_lot_events add constraint article_lot_events_type_check
  check (type in ('entree_section', 'sortie_section', 'declaration', 'decoupage', 'regroupement', 'mise_en_colis', 'reorientation',
                  'livraison_chaine', 'retour_chaine', 'sortie_chaine'));

-- ----------------------------------------------------------------------------
-- 5. SÉCURITÉ
-- ----------------------------------------------------------------------------

-- Peut agir pour cette chaîne : l'agent de la chaîne, ou qui pilote la confection.
create or replace function peut_agir_chaine(p_chaine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select has_permission('confection_ravitaillement', 'create')
     and (has_permission('confection', 'modify')
          or exists (select 1 from chaine_agents ca where ca.chaine_id = p_chaine_id and ca.user_id = auth.uid()));
$$;

revoke all on function peut_agir_chaine(uuid) from public, anon;
grant execute on function peut_agir_chaine(uuid) to authenticated;

do $$
declare
  t text;
begin
  -- Référentiel : lu par la confection et la tablette, écrit par Paramètres confection.
  foreach t in array array['types_machines_couture', 'chaines_couture', 'postes_couture', 'chaine_agents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (has_permission(''confection'', ''view'') or has_permission(''confection_ravitaillement'', ''view'') or has_permission(''parametres_confection'', ''view''))', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''parametres_confection'', ''create''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''parametres_confection'', ''modify'')) with check (has_permission(''parametres_confection'', ''modify''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''parametres_confection'', ''delete'') or has_permission(''parametres_confection'', ''modify''))', t || '_delete', t);
  end loop;

  -- Pilotage : lu par la confection et la tablette, écrit par la confection.
  foreach t in array array['affectations_couture', 'chaine_travaux', 'presences_chaine', 'arrets_chaine'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (has_permission(''confection'', ''view'') or has_permission(''confection_ravitaillement'', ''view''))', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (has_permission(''confection'', ''create''))', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (has_permission(''confection'', ''modify'')) with check (has_permission(''confection'', ''modify''))', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (has_permission(''confection'', ''modify''))', t || '_delete', t);
  end loop;
end $$;

-- L'agent saisit l'effectif et les arrêts de SA chaîne.
drop policy if exists presences_chaine_agent on presences_chaine;
create policy presences_chaine_agent on presences_chaine for all
  using (peut_agir_chaine(chaine_id)) with check (peut_agir_chaine(chaine_id));
drop policy if exists arrets_chaine_agent on arrets_chaine;
create policy arrets_chaine_agent on arrets_chaine for all
  using (peut_agir_chaine(chaine_id)) with check (peut_agir_chaine(chaine_id));

-- Sorties et clés : écrites uniquement par les fonctions ci-dessous.
alter table sorties_chaine enable row level security;
drop policy if exists sorties_chaine_select on sorties_chaine;
create policy sorties_chaine_select on sorties_chaine for select
  using (has_permission('confection', 'view') or has_permission('confection_ravitaillement', 'view'));
revoke all on sorties_chaine from public, anon, authenticated;
grant select on sorties_chaine to authenticated;

alter table confection_cles enable row level security;
revoke all on confection_cles from public, anon, authenticated;

-- Personnel proposé à l'affectation, SANS ouvrir la table employes (salaires) :
-- matricule et nom seulement, jamais les fiches confidentielles.
create or replace function confection_employes()
returns table (id uuid, matricule text, nom text, prenom text, section_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.matricule, e.nom, e.prenom,
         (select es.section_id from employes_sections es where es.employe_id = e.id order by es.pourcentage desc limit 1)
  from employes e
  where has_permission('confection', 'view')
    and e.statut = 'actif' and not e.confidentiel
  order by e.nom, e.prenom;
$$;

revoke all on function confection_employes() from public, anon;
grant execute on function confection_employes() to authenticated;

-- ----------------------------------------------------------------------------
-- 6. RAVITAILLEMENT
-- ----------------------------------------------------------------------------

-- Livre un paquet à une chaîne, en entier (p_composition vide) ou en partie
-- (p_composition = {taille: quantité}) : la partie livrée devient un
-- sous-paquet avec son propre code QR, le reste garde le code d'origine.
-- p_comptage = ce que l'agent a réellement compté, s'il diffère de l'étiquette
-- (noté, jamais bloquant).
create or replace function livrer_paquet_chaine(
  p_code text,
  p_chaine_id uuid,
  p_composition jsonb default null,
  p_comptage jsonb default null,
  p_cle uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chaine chaines_couture;
  v_lot article_lots;
  v_cible article_lots;
  v_wo work_orders;
  v_deja jsonb;
  v_taille text;
  v_q int;
  v_reste jsonb;
  v_partiel boolean := false;
  v_total int;
  v_compte int;
  v_det record;
  v_res jsonb;
begin
  select * into v_chaine from chaines_couture where id = p_chaine_id;
  if not found then
    raise exception 'chaîne introuvable';
  end if;
  if not peut_agir_chaine(p_chaine_id) then
    raise exception 'accès refusé : vous n''êtes pas agent de la chaîne %', v_chaine.nom;
  end if;
  if not v_chaine.active then
    raise exception 'la chaîne % est désactivée', v_chaine.nom;
  end if;

  if p_cle is not null then
    select resultat into v_deja from confection_cles where cle = p_cle;
    if found then
      return v_deja || jsonb_build_object('deja_enregistre', true);
    end if;
  end if;

  v_lot := find_article_lot(p_code);
  -- Verrou : deux tablettes qui livrent le même paquet passent l'une après l'autre.
  select * into v_lot from article_lots where id = v_lot.id for update;
  if v_lot.statut <> 'en_cours' then
    raise exception 'le paquet % ne peut plus être livré (%)', v_lot.code,
      case v_lot.statut when 'eclate' then 'entièrement divisé : scannez un de ses sous-paquets'
                        when 'regroupe' then 'regroupé : scannez le paquet qui le remplace'
                        else v_lot.statut end;
  end if;
  if v_lot.production_order_line_id is null then
    raise exception 'le paquet % n''est rattaché à aucun article d''ODF', v_lot.code;
  end if;
  if v_lot.chaine_id is not null then
    raise exception 'le paquet % est déjà sur la chaîne % : faites d''abord un retour pour le déplacer', v_lot.code,
      (select nom from chaines_couture where id = v_lot.chaine_id);
  end if;

  select * into v_wo from work_orders w
  where w.production_order_line_id = v_lot.production_order_line_id and w.section_id = v_chaine.section_id
  order by w.etape nulls last, w.created_at
  limit 1;
  if not found then
    raise exception 'l''article du paquet % ne passe pas par la section %', v_lot.code,
      (select name from sections where id = v_chaine.section_id);
  end if;

  -- Livraison partielle : contrôle des quantités puis découpage.
  v_reste := v_lot.composition_taille;
  if p_composition is not null and p_composition <> '{}'::jsonb then
    for v_taille, v_q in select key, value::int from jsonb_each_text(p_composition) loop
      if v_q <= 0 then
        raise exception 'quantité invalide pour %', v_taille;
      end if;
      if coalesce((v_reste ->> v_taille)::int, 0) < v_q then
        raise exception 'le paquet % ne contient que % pièce(s) en %', v_lot.code, coalesce((v_reste ->> v_taille)::int, 0), v_taille;
      end if;
      v_reste := jsonb_set(v_reste, array[v_taille], to_jsonb((v_reste ->> v_taille)::int - v_q));
    end loop;
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_reste from jsonb_each(v_reste) e(k, v) where (v)::text::int > 0;
    v_partiel := v_reste <> '{}'::jsonb;
  end if;

  if v_partiel then
    insert into article_lots (production_order_id, production_order_line_id, trace_id, categorie, composition_taille,
                              etape_courante, statut, parent_lot_id, created_by, semi_fini_id, cloture_pieces_id)
    values (v_lot.production_order_id, v_lot.production_order_line_id, v_lot.trace_id, v_lot.categorie, p_composition,
            v_lot.etape_courante, 'en_cours', v_lot.id, auth.uid(), v_lot.semi_fini_id, v_lot.cloture_pieces_id)
    returning * into v_cible;
    update article_lots set composition_taille = v_reste where id = v_lot.id;
    insert into article_lot_events (article_lot_id, type, related_lot_id, detail, created_by)
    values (v_lot.id, 'decoupage', v_cible.id, jsonb_build_object('composition', p_composition), auth.uid()),
           (v_cible.id, 'decoupage', v_lot.id, jsonb_build_object('origine', v_lot.code), auth.uid());
  else
    v_cible := v_lot;
  end if;

  -- Le paquet entre dans la section de la chaîne s'il n'y est pas déjà : le
  -- stock tampon par atelier et le verrou de personnalisation (0152) suivent.
  select * into v_det from lot_detenteur(v_cible.id);
  if v_det.section_id is distinct from v_chaine.section_id or v_det.en_transit then
    insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, created_by)
    values (v_cible.id, 'entree_section', v_wo.id, v_wo.section_id, v_wo.etape, auth.uid());
  end if;

  select coalesce(sum(value::int), 0) into v_total from jsonb_each_text(v_cible.composition_taille);
  if p_comptage is not null and p_comptage <> '{}'::jsonb then
    select coalesce(sum(value::int), 0) into v_compte from jsonb_each_text(p_comptage);
  end if;

  insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, chaine_id, detail, created_by)
  values (v_cible.id, 'livraison_chaine', v_wo.id, v_wo.section_id, v_wo.etape, p_chaine_id,
          jsonb_strip_nulls(jsonb_build_object(
            'composition', v_cible.composition_taille,
            'comptage', p_comptage,
            'ecart', case when v_compte is not null and v_compte <> v_total then v_compte - v_total end)),
          auth.uid());

  update article_lots set chaine_id = p_chaine_id, etape_courante = v_wo.etape where id = v_cible.id;

  -- Le travail s'ouvre tout seul au premier paquet (C11).
  insert into chaine_travaux (chaine_id, work_order_id, statut, demarre_le)
  values (p_chaine_id, v_wo.id, 'en_cours', now())
  on conflict (chaine_id, work_order_id) do update
    set statut = case when chaine_travaux.statut = 'a_faire' then 'en_cours' else chaine_travaux.statut end,
        demarre_le = coalesce(chaine_travaux.demarre_le, now());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'livrer_paquet_chaine', 'article_lot', v_cible.id,
          jsonb_build_object('chaine', v_chaine.code, 'origine', v_lot.code, 'partiel', v_partiel, 'composition', v_cible.composition_taille));

  v_res := jsonb_build_object(
    'lot_id', v_cible.id, 'code', v_cible.code, 'origine', v_lot.code, 'nouveau_paquet', v_partiel,
    'composition', v_cible.composition_taille, 'total', v_total,
    'reste', case when v_partiel then v_reste else '{}'::jsonb end,
    'chaine', v_chaine.nom, 'work_order_id', v_wo.id);
  if p_cle is not null then
    insert into confection_cles (cle, operation, resultat, created_by) values (p_cle, 'livrer_paquet_chaine', v_res, auth.uid());
  end if;
  return v_res;
end;
$$;

revoke all on function livrer_paquet_chaine(text, uuid, jsonb, jsonb, uuid) from public, anon;
grant execute on function livrer_paquet_chaine(text, uuid, jsonb, jsonb, uuid) to authenticated;

-- Retire un paquet d'une chaîne (erreur de chaîne, travail suspendu) : il
-- reste dans la section et peut être livré ailleurs.
create or replace function retourner_paquet_chaine(p_code text, p_motif text, p_cle uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
  v_deja jsonb;
  v_res jsonb;
begin
  if p_cle is not null then
    select resultat into v_deja from confection_cles where cle = p_cle;
    if found then
      return v_deja || jsonb_build_object('deja_enregistre', true);
    end if;
  end if;
  v_lot := find_article_lot(p_code);
  select * into v_lot from article_lots where id = v_lot.id for update;
  if v_lot.chaine_id is null then
    raise exception 'le paquet % n''est sur aucune chaîne', v_lot.code;
  end if;
  if not peut_agir_chaine(v_lot.chaine_id) then
    raise exception 'accès refusé : vous n''êtes pas agent de cette chaîne';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour retirer un paquet d''une chaîne';
  end if;

  insert into article_lot_events (article_lot_id, type, chaine_id, detail, created_by)
  values (v_lot.id, 'retour_chaine', v_lot.chaine_id,
          jsonb_build_object('composition', v_lot.composition_taille, 'motif', btrim(p_motif)), auth.uid());
  update article_lots set chaine_id = null where id = v_lot.id;

  v_res := jsonb_build_object('lot_id', v_lot.id, 'code', v_lot.code);
  if p_cle is not null then
    insert into confection_cles (cle, operation, resultat, created_by) values (p_cle, 'retourner_paquet_chaine', v_res, auth.uid());
  end if;
  return v_res;
end;
$$;

revoke all on function retourner_paquet_chaine(text, text, uuid) from public, anon;
grant execute on function retourner_paquet_chaine(text, text, uuid) to authenticated;

-- Pièces complètes ravitaillées à une chaîne pour un article, par taille.
-- Un paquet de pièces (manches, corps…) ne fait pas un vêtement : on compte,
-- nomenclature par nomenclature de la ligne (0161), le minimum sur ses
-- semi-finis de pièces livrées ÷ quantité par pièce. Les paquets de vêtements
-- entiers (sans semi-fini) s'ajoutent tels quels.
create or replace function chaine_pieces_completes(p_chaine_id uuid, p_line_id uuid)
returns table (taille text, pieces int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_t record;
  v_r record;
  v_s record;
  v_pool jsonb;
  v_k numeric;
  v_dispo numeric;
  v_total int;
begin
  for v_t in select pos.taille from production_order_sizes pos where pos.production_order_line_id = p_line_id loop
    -- Pièces livrées nettes, par semi-fini (clé « entier » pour les vêtements entiers).
    select coalesce(jsonb_object_agg(x.sf, x.n), '{}'::jsonb) into v_pool
    from (
      select coalesce(al.semi_fini_id::text, 'entier') as sf,
             sum(case when ev.type = 'livraison_chaine' then 1 else -1 end
                 * coalesce((ev.detail -> 'composition' ->> v_t.taille)::numeric, 0)) as n
      from article_lot_events ev
      join article_lots al on al.id = ev.article_lot_id
      where ev.chaine_id = p_chaine_id and ev.type in ('livraison_chaine', 'retour_chaine')
        and al.production_order_line_id = p_line_id
      group by 1
    ) x;

    v_total := coalesce((v_pool ->> 'entier')::numeric, 0)::int;
    for v_r in
      select r.nomenclature_id as id from repartition_ligne(p_line_id) r
      where r.taille = v_t.taille and r.quantite > 0
      order by r.principale, r.nomenclature_id
    loop
      v_k := null;
      for v_s in
        select nl.semi_fini_id as sf, sum(nl.quantite_par_piece) as qte
        from nomenclature_lines nl
        where nl.nomenclature_id = v_r.id and nl.semi_fini_id is not null
        group by nl.semi_fini_id
      loop
        v_dispo := floor(coalesce((v_pool ->> v_s.sf::text)::numeric, 0) / v_s.qte);
        v_k := least(coalesce(v_k, v_dispo), v_dispo);
      end loop;
      if v_k is null or v_k <= 0 then
        continue;
      end if;
      for v_s in
        select nl.semi_fini_id as sf, sum(nl.quantite_par_piece) as qte
        from nomenclature_lines nl
        where nl.nomenclature_id = v_r.id and nl.semi_fini_id is not null
        group by nl.semi_fini_id
      loop
        v_pool := jsonb_set(v_pool, array[v_s.sf::text], to_jsonb(coalesce((v_pool ->> v_s.sf::text)::numeric, 0) - v_k * v_s.qte));
      end loop;
      v_total := v_total + v_k::int;
    end loop;

    taille := v_t.taille;
    pieces := v_total;
    return next;
  end loop;
end;
$$;

revoke all on function chaine_pieces_completes(uuid, uuid) from public, anon;
grant execute on function chaine_pieces_completes(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. SORTIE DE CHAÎNE
-- ----------------------------------------------------------------------------

-- Déclare une sortie au moteur d'ODF sans jamais faire échouer l'appelant :
-- renvoie l'identifiant de la déclaration, ou le message du refus.
create or replace function sortie_chaine_declarer(p_sortie_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s sorties_chaine;
  v_decl uuid;
  v_err text;
begin
  select * into v_s from sorties_chaine where id = p_sortie_id for update;
  if not found or v_s.declaration_id is not null or v_s.type = 'reprise' or v_s.quantite <= 0 then
    return null;
  end if;
  begin
    perform set_config('seritex.article_lot', coalesce(v_s.article_lot_id::text, ''), true);
    v_decl := declare_production(v_s.work_order_id, v_s.taille,
                                 case v_s.type when 'bonne' then 'bonne' else 'dechet' end,
                                 v_s.quantite, v_s.motif);
    perform set_config('seritex.article_lot', '', true);
  exception when others then
    perform set_config('seritex.article_lot', '', true);
    v_err := sqlerrm;
  end;
  update sorties_chaine set declaration_id = v_decl, declaration_erreur = v_err where id = p_sortie_id;
  return v_err;
end;
$$;

revoke all on function sortie_chaine_declarer(uuid) from public, anon, authenticated;

-- L'agent compte ce qui sort de sa chaîne pour un travail.
-- p_lignes = [{"taille": "Homme/M", "type": "bonne" | "reprise" | "rebut", "quantite": 60}, …]
-- Les pièces bonnes forment un lot de vêtements montés, étiqueté, qui part
-- vers l'atelier suivant.
create or replace function sortir_chaine(
  p_chaine_id uuid,
  p_work_order_id uuid,
  p_lignes jsonb,
  p_cle uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chaine chaines_couture;
  v_wo work_orders;
  v_deja jsonb;
  v_l record;
  v_bonnes jsonb := '{}'::jsonb;
  v_lot article_lots;
  v_id uuid;
  v_err text;
  v_erreurs jsonb := '[]'::jsonb;
  v_total int := 0;
  v_res jsonb;
begin
  select * into v_chaine from chaines_couture where id = p_chaine_id;
  if not found then
    raise exception 'chaîne introuvable';
  end if;
  if not peut_agir_chaine(p_chaine_id) then
    raise exception 'accès refusé : vous n''êtes pas agent de la chaîne %', v_chaine.nom;
  end if;
  if p_cle is not null then
    select resultat into v_deja from confection_cles where cle = p_cle;
    if found then
      return v_deja || jsonb_build_object('deja_enregistre', true);
    end if;
  end if;

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found or v_wo.section_id is distinct from v_chaine.section_id or v_wo.production_order_line_id is null then
    raise exception 'ce travail n''appartient pas à la section de la chaîne %', v_chaine.nom;
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'aucune quantité à enregistrer';
  end if;

  for v_l in
    select l ->> 'taille' as taille, l ->> 'type' as type, (l ->> 'quantite')::int as quantite
    from jsonb_array_elements(p_lignes) l
  loop
    if v_l.quantite is null or v_l.quantite <= 0 then
      raise exception 'quantité invalide pour %', v_l.taille;
    end if;
    if v_l.type not in ('bonne', 'reprise', 'rebut') then
      raise exception 'type de sortie inconnu : %', v_l.type;
    end if;
    if not exists (select 1 from sizes where cle = v_l.taille) then
      raise exception 'taille inconnue du référentiel : %', v_l.taille;
    end if;
    if v_l.type = 'bonne' then
      v_bonnes := v_bonnes || jsonb_build_object(v_l.taille, coalesce((v_bonnes ->> v_l.taille)::int, 0) + v_l.quantite);
    end if;
  end loop;

  -- Lot des vêtements montés qui quittent la chaîne.
  if v_bonnes <> '{}'::jsonb then
    insert into article_lots (production_order_id, production_order_line_id, categorie, composition_taille, etape_courante, created_by)
    values (v_wo.production_order_id, v_wo.production_order_line_id, 'semi_fini', v_bonnes, v_wo.etape, auth.uid())
    returning * into v_lot;
    insert into article_lot_events (article_lot_id, type, work_order_id, section_id, etape, chaine_id, detail, created_by)
    values (v_lot.id, 'sortie_chaine', v_wo.id, v_wo.section_id, v_wo.etape, p_chaine_id,
            jsonb_build_object('composition', v_bonnes), auth.uid());
  end if;

  for v_l in
    select l ->> 'taille' as taille, l ->> 'type' as type, (l ->> 'quantite')::int as quantite
    from jsonb_array_elements(p_lignes) l
  loop
    insert into sorties_chaine (chaine_id, work_order_id, production_order_line_id, taille, type, quantite, article_lot_id, created_by)
    values (p_chaine_id, v_wo.id, v_wo.production_order_line_id, v_l.taille, v_l.type, v_l.quantite,
            case when v_l.type = 'bonne' then v_lot.id end, auth.uid())
    returning id into v_id;
    v_total := v_total + v_l.quantite;
    v_err := sortie_chaine_declarer(v_id);
    if v_err is not null then
      v_erreurs := v_erreurs || jsonb_build_object('taille', v_l.taille, 'type', v_l.type, 'message', v_err);
    end if;
  end loop;

  insert into chaine_travaux (chaine_id, work_order_id, statut, demarre_le)
  values (p_chaine_id, v_wo.id, 'en_cours', now())
  on conflict (chaine_id, work_order_id) do update
    set statut = case when chaine_travaux.statut = 'a_faire' then 'en_cours' else chaine_travaux.statut end,
        demarre_le = coalesce(chaine_travaux.demarre_le, now());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'sortir_chaine', 'work_order', v_wo.id,
          jsonb_build_object('chaine', v_chaine.code, 'lignes', p_lignes, 'a_regulariser', v_erreurs));

  v_res := jsonb_build_object('total', v_total, 'lot_id', v_lot.id, 'lot_code', v_lot.code, 'bonnes', v_bonnes,
                              'a_regulariser', v_erreurs, 'chaine', v_chaine.nom);
  if p_cle is not null then
    insert into confection_cles (cle, operation, resultat, created_by) values (p_cle, 'sortir_chaine', v_res, auth.uid());
  end if;
  return v_res;
end;
$$;

revoke all on function sortir_chaine(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function sortir_chaine(uuid, uuid, jsonb, uuid) to authenticated;

-- Le chef de section relance la déclaration d'une sortie restée à régulariser.
create or replace function regulariser_sortie_chaine(p_sortie_id uuid, p_motif text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('confection', 'modify') then
    raise exception 'accès refusé : régularisation réservée au pilotage de la confection';
  end if;
  if p_motif is not null and btrim(p_motif) <> '' then
    update sorties_chaine set motif = btrim(p_motif) where id = p_sortie_id and declaration_id is null;
  end if;
  return sortie_chaine_declarer(p_sortie_id);
end;
$$;

revoke all on function regulariser_sortie_chaine(uuid, text) from public, anon;
grant execute on function regulariser_sortie_chaine(uuid, text) to authenticated;

-- Corrige le comptage d'une sortie (ligne négative ou positive motivée). La
-- déclaration déjà transmise au moteur d'ODF se corrige, elle, au terminal de
-- section : le moteur n'est pas touché ici.
create or replace function corriger_sortie_chaine(p_sortie_id uuid, p_ecart int, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s sorties_chaine;
  v_net int;
  v_id uuid;
begin
  if not has_permission('confection_ravitaillement', 'modify') then
    raise exception 'accès refusé : correction réservée au droit « modifier » de la tablette de chaîne';
  end if;
  select * into v_s from sorties_chaine where id = p_sortie_id for update;
  if not found or v_s.corrige_id is not null then
    raise exception 'sortie introuvable';
  end if;
  if p_ecart is null or p_ecart >= 0 then
    raise exception 'une correction retire des pièces comptées en trop (écart négatif) ; pour en ajouter, enregistrez une nouvelle sortie';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour corriger une sortie';
  end if;
  select v_s.quantite + coalesce(sum(c.quantite), 0) into v_net from sorties_chaine c where c.corrige_id = p_sortie_id;
  if v_net + p_ecart < 0 then
    raise exception 'la correction dépasse la quantité comptée (% restant)', v_net;
  end if;
  insert into sorties_chaine (chaine_id, work_order_id, production_order_line_id, taille, type, quantite, jour, corrige_id, motif, created_by)
  values (v_s.chaine_id, v_s.work_order_id, v_s.production_order_line_id, v_s.taille, v_s.type, p_ecart, v_s.jour, p_sortie_id, btrim(p_motif), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function corriger_sortie_chaine(uuid, int, text) from public, anon;
grant execute on function corriger_sortie_chaine(uuid, int, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. RENDEMENT PAR CHAÎNE ET PAR JOUR
-- ----------------------------------------------------------------------------

-- Une ligne par chaîne active. Présents : le pointage du jour (Personnel) pour
-- les personnes affectées à la chaîne s'il existe, sinon l'effectif saisi.
-- En-cours : pièces complètes ravitaillées − sorties bonnes − rebuts, sur les
-- travaux non terminés.
create or replace function confection_bilan_jour(p_jour date default current_date)
returns table (
  chaine_id uuid, section_id uuid, section text, nom text, code text, type text,
  affectes int, presents int, minutes_presence int, source_presence text,
  entrees int, sorties int, reprises int, rebuts int, en_cours int,
  minutes_arret int, a_regulariser int
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select ch.* from chaines_couture ch
    where ch.active
      and (has_permission('confection', 'view')
           or (has_permission('confection_ravitaillement', 'view')
               and exists (select 1 from chaine_agents ca where ca.chaine_id = ch.id and ca.user_id = auth.uid())))
  ),
  aff as (
    select a.chaine_id, a.employe_id
    from affectations_couture a
    where a.fonction in ('couture', 'chef_chaine', 'commun')
      and a.debut::date <= p_jour and (a.fin is null or a.fin::date >= p_jour)
  ),
  pointage as (
    select aff.chaine_id,
           count(*) filter (where pe.statut = 'present')::int as presents,
           sum(pe.heures * 60) filter (where pe.statut = 'present') as minutes,
           count(*) filter (where pe.statut = 'present' and pe.heures is null)::int as sans_heures
    from aff join presences_employes pe on pe.employe_id = aff.employe_id and pe.jour = p_jour
    group by aff.chaine_id
  )
  select c.id, c.section_id, s.name, c.nom, c.code, c.type,
         (select count(distinct aff.employe_id) from aff where aff.chaine_id = c.id)::int,
         coalesce(p.presents, pc.presents),
         case when p.chaine_id is not null then (coalesce(p.minutes, 0) + p.sans_heures * c.minutes_jour)::int
              when pc.id is not null then coalesce(pc.minutes_presence, pc.presents * c.minutes_jour) end,
         case when p.chaine_id is not null then 'pointage' when pc.id is not null then 'saisie' end,
         coalesce((select sum(case when ev.type = 'livraison_chaine' then 1 else -1 end * kv.value::numeric)
                   from article_lot_events ev
                   cross join lateral jsonb_each_text(coalesce(ev.detail -> 'composition', '{}'::jsonb)) kv
                   where ev.chaine_id = c.id and ev.type in ('livraison_chaine', 'retour_chaine')
                     and ev.created_at::date = p_jour), 0)::int,
         coalesce((select sum(so.quantite) from sorties_chaine so where so.chaine_id = c.id and so.jour = p_jour and so.type = 'bonne'), 0)::int,
         coalesce((select sum(so.quantite) from sorties_chaine so where so.chaine_id = c.id and so.jour = p_jour and so.type = 'reprise'), 0)::int,
         coalesce((select sum(so.quantite) from sorties_chaine so where so.chaine_id = c.id and so.jour = p_jour and so.type = 'rebut'), 0)::int,
         coalesce((select sum(greatest(
                     (select coalesce(sum(pc2.pieces), 0) from chaine_pieces_completes(c.id, w.production_order_line_id) pc2)
                     - coalesce((select sum(so.quantite) from sorties_chaine so
                                 where so.chaine_id = c.id and so.work_order_id = t.work_order_id and so.type in ('bonne', 'rebut')), 0), 0))
                   from chaine_travaux t join work_orders w on w.id = t.work_order_id
                   where t.chaine_id = c.id and t.statut <> 'termine'), 0)::int,
         coalesce((select sum(extract(epoch from (least(coalesce(ar.fin, now()), (p_jour + 1)::timestamptz)
                                                  - greatest(ar.debut, p_jour::timestamptz))) / 60)
                   from arrets_chaine ar
                   where ar.chaine_id = c.id and ar.debut < (p_jour + 1)::timestamptz
                     and coalesce(ar.fin, now()) > p_jour::timestamptz), 0)::int,
         (select count(*) from sorties_chaine so
          where so.chaine_id = c.id and so.declaration_id is null and so.declaration_erreur is not null and so.corrige_id is null)::int
  from c
  join sections s on s.id = c.section_id
  left join pointage p on p.chaine_id = c.id
  left join presences_chaine pc on pc.chaine_id = c.id and pc.jour = p_jour
  order by s.display_order, c.ordre, c.nom;
$$;

revoke all on function confection_bilan_jour(date) from public, anon;
grant execute on function confection_bilan_jour(date) to authenticated;
