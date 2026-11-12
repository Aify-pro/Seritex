-- ============================================================================
-- 0182 — Imbrication (tracé de coupe calculé par Seritex), phase 2
-- ============================================================================
--
-- Le calcul automatique d'un tracé est une voie DE PLUS, jamais une
-- obligation : le dépôt d'un tracé fait dans Modaris / Diamino reste
-- inchangé. Cette migration ne touche aucune table existante en dehors de
-- deux colonnes ajoutées à pattern_pieces (avec une valeur par défaut qui ne
-- change rien à la reconnaissance des tracés).
--
-- 1. Contraintes de coupe portées par la pièce du patron (bibliothèque) :
--    - rotations_autorisees : angles permis, par défaut {0,180} = la pièce
--      suit le sens du rouleau, dans un sens ou dans l'autre. Vérifié sur un
--      gabarit Modaris réel : le droit-fil y est dessiné selon X. Décision
--      utilisateur (2026-11-12) : rien à saisir par défaut.
--    - symetrie : « aucune » (tous les exemplaires posés pareil) ou « paire »
--      (moitié posée retournée : pièce gauche + pièce droite).
--
-- 2. imbrication_calculs : une demande de calcul et son résultat. Calcul
--    asynchrone, exécuté par Seritex lui-même (/api/imbrication/traiter,
--    appelé juste après la demande puis chaque minute par pg_cron), par
--    TRANCHES : chaque tranche repart du meilleur tracé de la précédente, ce
--    qui permet des calculs plus longs que la durée maximale d'une fonction.
--
--    Garde-fou en base : un calcul ne peut être « terminé » que si le
--    contrôle indépendant de Seritex a déclaré le tracé valide
--    (contrainte imbrication_calculs_termine_valide). Un tracé invalide n'est
--    JAMAIS enregistré comme valide.
--
--    Écriture : création par la personne (RLS, son propre identifiant) ;
--    annulation par fonction ; tout le reste par le serveur (service_role).
--
-- 3. Fonctions : annuler_calcul_imbrication (personnel autorisé),
--    prendre_calcul_imbrication (serveur seulement : réserve le prochain
--    calcul, reprend un calcul dont le serveur s'est arrêté en route).
--
-- 4. Tâche planifiée « imbrication-traiter » (même mécanisme que 0137).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONTRAINTES DE COUPE SUR LA PIÈCE
-- ----------------------------------------------------------------------------
alter table pattern_pieces
  add column if not exists rotations_autorisees numeric[] not null default '{0,180}',
  add column if not exists symetrie text not null default 'aucune';

alter table pattern_pieces drop constraint if exists pattern_pieces_rotations_autorisees;
alter table pattern_pieces add constraint pattern_pieces_rotations_autorisees check (
  cardinality(rotations_autorisees) between 1 and 8
  and array_position(rotations_autorisees, null) is null
  and 0 <= all (rotations_autorisees)
  and 360 > all (rotations_autorisees)
);
alter table pattern_pieces drop constraint if exists pattern_pieces_symetrie;
alter table pattern_pieces add constraint pattern_pieces_symetrie check (symetrie in ('aucune', 'paire'));

comment on column pattern_pieces.rotations_autorisees is
  'Imbrication : angles (degrés) permis pour poser la pièce, par rapport au DXF de référence tel que dessiné (droit-fil selon X dans les exports Modaris). {0,180} par défaut.';
comment on column pattern_pieces.symetrie is
  'Imbrication : « aucune » = tous les exemplaires posés pareil ; « paire » = la moitié posée retournée (pièce gauche + pièce droite).';

-- ----------------------------------------------------------------------------
-- 2. CALCULS D'IMBRICATION
-- ----------------------------------------------------------------------------
create table if not exists imbrication_calculs (
  id uuid primary key default gen_random_uuid(),
  libelle text,
  -- Ordre de tracé pour lequel le calcul est fait (facultatif : un calcul
  -- peut être lancé pour comparer, avant toute fiche).
  fiche_id uuid references fiches_placement(id) on delete set null,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'en_cours', 'termine', 'echec', 'annule')),
  -- Ce qui a été demandé (semi-finis, quantités par taille, tissu, budget).
  parametres jsonb not null,
  -- Entrée complète du moteur (contrat seritex.imbrication/v1) : instantané
  -- des pièces au moment de la demande, le calcul ne dépend plus ensuite de
  -- la bibliothèque.
  entree jsonb not null,
  -- Correspondance identifiant de pièce du contrat → patron, semi-fini, taille, nom.
  pieces jsonb not null,
  temps_total_s numeric not null check (temps_total_s > 0 and temps_total_s <= 14400),
  temps_consomme_s numeric not null default 0 check (temps_consomme_s >= 0),
  tranches int not null default 0,
  -- Meilleure sortie du moteur à ce stade : reprise de la tranche suivante, puis résultat.
  meilleur jsonb,
  -- Contrôle indépendant de Seritex sur `meilleur`.
  validation jsonb,
  longueur_mm numeric,
  taux_utilisation numeric,
  reproductible boolean,
  erreur_code text,
  erreur_message text,
  -- Reprises après un arrêt du serveur en pleine tranche.
  reprises_apres_panne int not null default 0,
  annulation_demandee_le timestamptz,
  pris_le timestamptz,
  vivant_le timestamptz,
  debut_le timestamptz,
  fin_le timestamptz,
  demande_par uuid references app_users(id) on delete set null,
  -- Phase 4 : nom de l'agent IA qui a demandé le calcul (null = une personne).
  demande_par_agent text,
  created_at timestamptz not null default now(),
  constraint imbrication_calculs_termine_valide check (
    statut <> 'termine'
    or (meilleur is not null and longueur_mm is not null and coalesce((validation ->> 'valide')::boolean, false))
  ),
  constraint imbrication_calculs_echec_explique check (statut <> 'echec' or erreur_message is not null)
);

create index if not exists imbrication_calculs_a_traiter
  on imbrication_calculs (created_at) where statut in ('en_attente', 'en_cours');
create index if not exists imbrication_calculs_fiche on imbrication_calculs (fiche_id);
create index if not exists imbrication_calculs_demande_par on imbrication_calculs (demande_par, created_at desc);

comment on table imbrication_calculs is
  'Calculs de tracé de coupe faits par Seritex (module d''imbrication). Voie facultative à côté du dépôt d''un tracé Modaris / Diamino. Voir docs/imbrication.md.';

alter table imbrication_calculs enable row level security;
revoke all on imbrication_calculs from anon;

drop policy if exists imbrication_calculs_select on imbrication_calculs;
create policy imbrication_calculs_select on imbrication_calculs for select to authenticated
  using (has_permission('patronnage', 'view') or has_permission('patronnage_traces', 'create'));

-- Une personne crée un calcul en son nom, toujours « en attente » et vierge
-- de tout résultat : seul le serveur écrit les résultats.
drop policy if exists imbrication_calculs_insert on imbrication_calculs;
create policy imbrication_calculs_insert on imbrication_calculs for insert to authenticated
  with check (
    has_permission('patronnage_traces', 'create')
    and demande_par = auth.uid()
    and demande_par_agent is null
    and statut = 'en_attente'
    and meilleur is null and validation is null and longueur_mm is null
    and temps_consomme_s = 0 and tranches = 0
  );
-- Pas de politique update / delete : annulation par fonction, résultats par le serveur.

-- ----------------------------------------------------------------------------
-- 3. FONCTIONS
-- ----------------------------------------------------------------------------

-- Annulation. En attente : annulé tout de suite (un meilleur tracé déjà
-- trouvé est conservé pour consultation). En cours : demande d'arrêt, le
-- serveur arrête le moteur et enregistre le meilleur tracé trouvé.
create or replace function annuler_calcul_imbrication(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_statut text;
begin
  if not has_permission('patronnage_traces', 'create') then
    raise exception 'Droit insuffisant pour annuler un calcul de tracé.' using errcode = '42501';
  end if;
  select statut into v_statut from imbrication_calculs where id = p_id for update;
  if v_statut is null then
    raise exception 'Calcul introuvable.' using errcode = 'P0002';
  end if;
  if v_statut = 'en_attente' then
    update imbrication_calculs
       set statut = 'annule', annulation_demandee_le = now(), fin_le = now()
     where id = p_id;
    return 'annule';
  elsif v_statut = 'en_cours' then
    update imbrication_calculs set annulation_demandee_le = coalesce(annulation_demandee_le, now()) where id = p_id;
    return 'annulation_demandee';
  end if;
  raise exception 'Ce calcul est déjà fini (%).', v_statut using errcode = 'P0001';
end;
$$;

revoke all on function annuler_calcul_imbrication(uuid) from public, anon;
grant execute on function annuler_calcul_imbrication(uuid) to authenticated;

-- Réserve le prochain calcul à exécuter (le plus ancien d'abord), pour une
-- tranche. Un calcul resté « en cours » sans signe de vie depuis
-- p_silence_max_s (le serveur s'est arrêté en route) est repris depuis son
-- meilleur tracé enregistré ; au-delà de 3 reprises, il passe en échec.
create or replace function prendre_calcul_imbrication(p_silence_max_s int default 420)
returns setof imbrication_calculs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Calculs abandonnés trop souvent : échec explicite.
  update imbrication_calculs
     set statut = 'echec',
         erreur_code = 'moteur_interrompu',
         erreur_message = 'Le calcul a été interrompu plusieurs fois par le serveur. Relancez-le avec un temps de calcul plus court.',
         fin_le = now()
   where statut = 'en_cours'
     and vivant_le < now() - make_interval(secs => p_silence_max_s)
     and reprises_apres_panne >= 3;

  select id into v_id
    from imbrication_calculs
   where (statut = 'en_attente')
      or (statut = 'en_cours' and vivant_le < now() - make_interval(secs => p_silence_max_s))
   order by created_at
   limit 1
   for update skip locked;
  if v_id is null then
    return;
  end if;

  return query
  update imbrication_calculs
     set reprises_apres_panne = reprises_apres_panne + case when statut = 'en_cours' then 1 else 0 end,
         statut = 'en_cours',
         pris_le = now(),
         vivant_le = now(),
         debut_le = coalesce(debut_le, now())
   where id = v_id
  returning *;
end;
$$;

revoke all on function prendre_calcul_imbrication(int) from public, anon, authenticated;
grant execute on function prendre_calcul_imbrication(int) to service_role;

-- ----------------------------------------------------------------------------
-- 4. TÂCHE PLANIFIÉE (même mécanisme et même secret que 0137)
-- ----------------------------------------------------------------------------
do $migration$
declare
  v_nom constant text := 'imbrication-traiter';
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regclass('cron.job') is null
     or to_regproc('net.http_get') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise notice '0182 : pg_cron, pg_net ou le Vault est absent — aucune tâche planifiée (normal hors Supabase).';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = v_nom) then
    raise notice '0182 : la tâche % existe déjà — conservée telle quelle.', v_nom;
    return;
  end if;
  perform cron.schedule(v_nom, '* * * * *', $c$
  select net.http_get(
    url := 'https://app.seritex.ci/api/imbrication/traiter',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_secret')
    ),
    timeout_milliseconds := 300000
  )
  where exists (
    select 1 from public.imbrication_calculs
     where statut = 'en_attente'
        or (statut = 'en_cours' and vivant_le < now() - interval '7 minutes')
  );
  $c$);
  raise notice '0182 : tâche % planifiée (chaque minute).', v_nom;
end;
$migration$;
