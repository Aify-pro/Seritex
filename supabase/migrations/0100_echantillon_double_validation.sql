-- ============================================================================
-- 0100 — Échantillon validé à deux : client ET direction
-- ============================================================================
-- Demande Ayman, 06/10 : la fiche imprimée porte un cartouche signé par le
-- client et par la direction ; il faut la même validation dans l'outil.
--
-- Règles arrêtées avec lui :
--   - Deux validations indépendantes, chacune tracée (qui, quand, commentaire).
--     La fiche ne passe « validée » que lorsque les DEUX sont posées ; après
--     la première, elle est « en validation » (statut ajouté par 0099).
--   - La validation client peut être enregistrée par le client lui-même
--     depuis son portail, OU par le commercial pour son compte (validation en
--     main propre, au téléphone, fiche papier signée). `par` garde toujours
--     l'utilisateur qui a réellement appuyé, et `pour_le_client` dit si
--     c'était une saisie pour le compte du client.
--   - « À ajuster » / « Refusé » par l'une des deux parties fait basculer la
--     fiche immédiatement ET efface la validation déjà posée par l'autre : la
--     série suivante repart de zéro.
--   - Une validation posée par erreur peut être retirée par la direction ou
--     l'administrateur, avec trace dans audit_log.
--
-- Le garde-fou de l'ODF (0050, repris en 0052/0072) n'est pas touché : il
-- exige `status = 'valide'`, donc désormais les deux validations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Les deux validations, portées par la fiche
-- ----------------------------------------------------------------------------

alter table sample_requests
  add column validation_client_le timestamptz,
  add column validation_client_par uuid references app_users(id),
  add column validation_client_commentaire text,
  add column validation_client_pour_le_client boolean not null default false,
  add column validation_direction_le timestamptz,
  add column validation_direction_par uuid references app_users(id),
  add column validation_direction_commentaire text;

comment on column sample_requests.validation_client_par is
  'Utilisateur qui a posé la validation côté client — le client lui-même, ou le commercial qui l''enregistre pour son compte (validation_client_pour_le_client = true).';
comment on column sample_requests.validation_direction_le is
  'Validation direction (module validation_echantillon). Avec la validation client, elle fait passer la fiche au statut « valide » — c''est ce statut qu''exige le circuit de soumission de l''ODF (0050).';

-- ----------------------------------------------------------------------------
-- 2. Module de permission « validation_echantillon »
-- ----------------------------------------------------------------------------
-- Même mécanique que validation_comptable / validation_visuels (0050) : un
-- module, et le droit `validate` accordé aux rôles concernés. Direction et
-- administrateur l'obtiennent ; les autres rôles reçoivent une ligne sans
-- droit, pour que l'écran Rôles & permissions reste complet.

insert into modules (key, label, description, display_order) values
  ('validation_echantillon', 'Validation échantillon (direction)',
   'Valide un échantillon au nom de la direction — la validation du client reste nécessaire en plus', 167)
on conflict (key) do nothing;

do $$
declare
  v_mod uuid := (select id from modules where key = 'validation_echantillon');
  v_role record;
begin
  for v_role in select id, key from roles loop
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_role.id, v_mod,
      v_role.key in ('administrateur', 'direction', 'commercial'),
      false, false, false, false,
      v_role.key in ('administrateur', 'direction'),
      false
    )
    on conflict (role_id, module_id) do nothing;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 3. valider_echantillon() — une partie à la fois
-- ----------------------------------------------------------------------------
-- Une seule fonction pour les deux côtés : le `p_partie` dit laquelle, et
-- chaque côté a son propre contrôle d'accès. Le statut est recalculé à
-- partir des deux colonnes, jamais posé à la main — impossible d'être
-- « validé » avec une seule signature.

create or replace function valider_echantillon(
  p_sample_request_id uuid,
  p_partie text,              -- 'client' | 'direction'
  p_commentaire text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
  v_pour_le_client boolean := false;
  v_client_le timestamptz;
  v_direction_le timestamptz;
begin
  if p_partie not in ('client', 'direction') then
    raise exception 'partie inconnue : % (attendu « client » ou « direction »)', p_partie;
  end if;

  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'fiche échantillon introuvable';
  end if;

  if p_partie = 'client' then
    if v_sr.validation_client_le is not null then
      raise exception 'la validation du client est déjà enregistrée';
    end if;
    -- Le client valide depuis son portail ; le commercial peut enregistrer
    -- sa réponse pour lui (décision du 06/10), ce que la fiche affiche.
    if is_client_of(v_sr.company_id) then
      v_pour_le_client := false;
    elsif is_commercial_or_above() then
      v_pour_le_client := true;
    else
      raise exception 'accès refusé : seul le client ou le commercial peut enregistrer la validation du client';
    end if;
  else
    if v_sr.validation_direction_le is not null then
      raise exception 'la validation de la direction est déjà enregistrée';
    end if;
    if not has_permission('validation_echantillon', 'validate') then
      raise exception 'accès refusé : votre rôle ne permet pas de valider un échantillon au nom de la direction';
    end if;
  end if;

  if v_sr.status in ('sans_suite', 'refuse') then
    raise exception 'cette fiche est close (statut actuel : %) — elle ne peut plus être validée', v_sr.status;
  end if;

  v_client_le := case when p_partie = 'client' then now() else v_sr.validation_client_le end;
  v_direction_le := case when p_partie = 'direction' then now() else v_sr.validation_direction_le end;

  update sample_requests set
    validation_client_le = v_client_le,
    validation_client_par = case when p_partie = 'client' then auth.uid() else validation_client_par end,
    validation_client_commentaire = case when p_partie = 'client' then p_commentaire else validation_client_commentaire end,
    validation_client_pour_le_client = case when p_partie = 'client' then v_pour_le_client else validation_client_pour_le_client end,
    validation_direction_le = v_direction_le,
    validation_direction_par = case when p_partie = 'direction' then auth.uid() else validation_direction_par end,
    validation_direction_commentaire = case when p_partie = 'direction' then p_commentaire else validation_direction_commentaire end,
    -- Les deux signatures : « validé ». Une seule : « en validation ».
    -- Cast explicite : un CASE de littéraux sort en text, que Postgres
    -- refuse d'affecter à une colonne d'enum.
    status = (case when v_client_le is not null and v_direction_le is not null then 'valide' else 'en_validation' end)::sample_request_status
  where id = p_sample_request_id;

  insert into sample_feedback (sample_request_id, feedback_text, decision)
  values (p_sample_request_id, p_commentaire, 'valide');

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'valider_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('partie', p_partie, 'pour_le_client', v_pour_le_client,
                             'complet', v_client_le is not null and v_direction_le is not null));
end;
$$;

revoke all on function valider_echantillon(uuid, text, text) from public, anon, authenticated;
grant execute on function valider_echantillon(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. refuser_echantillon() — « à ajuster » ou « refusé »
-- ----------------------------------------------------------------------------
-- Une réponse négative de l'une des deux parties fait basculer la fiche tout
-- de suite, et efface la validation déjà posée par l'autre : la série
-- suivante repart de zéro (décision du 06/10).

create or replace function refuser_echantillon(
  p_sample_request_id uuid,
  p_decision sample_decision,  -- 'a_ajuster' | 'refuse'
  p_commentaire text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
begin
  if p_decision not in ('a_ajuster', 'refuse') then
    raise exception 'décision inattendue : % — une validation passe par valider_echantillon()', p_decision;
  end if;

  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'fiche échantillon introuvable';
  end if;

  if not (is_client_of(v_sr.company_id) or is_commercial_or_above()
          or has_permission('validation_echantillon', 'validate')) then
    raise exception 'accès refusé';
  end if;

  update sample_requests set
    status = p_decision::text::sample_request_status,
    validation_client_le = null,
    validation_client_par = null,
    validation_client_commentaire = null,
    validation_client_pour_le_client = false,
    validation_direction_le = null,
    validation_direction_par = null,
    validation_direction_commentaire = null
  where id = p_sample_request_id;

  insert into sample_feedback (sample_request_id, feedback_text, decision)
  values (p_sample_request_id, p_commentaire, p_decision);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'refuser_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('decision', p_decision,
                             'validations_effacees', jsonb_build_object(
                               'client', v_sr.validation_client_le is not null,
                               'direction', v_sr.validation_direction_le is not null)));
end;
$$;

revoke all on function refuser_echantillon(uuid, sample_decision, text) from public, anon, authenticated;
grant execute on function refuser_echantillon(uuid, sample_decision, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. annuler_validation_echantillon() — corriger une erreur
-- ----------------------------------------------------------------------------
-- Direction et administrateur uniquement (décision du 06/10) : retirer l'une
-- des deux validations fait redescendre la fiche d'un cran, jamais au-delà
-- (« en validation » s'il reste l'autre signature, sinon « reçu par le
-- client » — l'étape juste avant la décision).

create or replace function annuler_validation_echantillon(
  p_sample_request_id uuid,
  p_partie text               -- 'client' | 'direction'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sr sample_requests;
  v_client_le timestamptz;
  v_direction_le timestamptz;
begin
  if p_partie not in ('client', 'direction') then
    raise exception 'partie inconnue : % (attendu « client » ou « direction »)', p_partie;
  end if;

  if not has_permission('validation_echantillon', 'validate') then
    raise exception 'accès refusé : seules la direction et l''administration peuvent retirer une validation';
  end if;

  select * into v_sr from sample_requests where id = p_sample_request_id;
  if not found then
    raise exception 'fiche échantillon introuvable';
  end if;

  v_client_le := case when p_partie = 'client' then null else v_sr.validation_client_le end;
  v_direction_le := case when p_partie = 'direction' then null else v_sr.validation_direction_le end;

  if (case when p_partie = 'client' then v_sr.validation_client_le else v_sr.validation_direction_le end) is null then
    raise exception 'aucune validation à retirer de ce côté';
  end if;

  update sample_requests set
    validation_client_le = v_client_le,
    validation_client_par = case when p_partie = 'client' then null else validation_client_par end,
    validation_client_commentaire = case when p_partie = 'client' then null else validation_client_commentaire end,
    validation_client_pour_le_client = case when p_partie = 'client' then false else validation_client_pour_le_client end,
    validation_direction_le = v_direction_le,
    validation_direction_par = case when p_partie = 'direction' then null else validation_direction_par end,
    validation_direction_commentaire = case when p_partie = 'direction' then null else validation_direction_commentaire end,
    status = (case
      when v_client_le is not null or v_direction_le is not null then 'en_validation'
      else 'recu_client'
    end)::sample_request_status
  where id = p_sample_request_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'annuler_validation_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('partie', p_partie));
end;
$$;

revoke all on function annuler_validation_echantillon(uuid, text) from public, anon, authenticated;
grant execute on function annuler_validation_echantillon(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. submit_sample_decision() remplacée
-- ----------------------------------------------------------------------------
-- L'ancienne RPC (0002) posait « validé » sur la seule parole de celui qui
-- cliquait : c'est exactement ce que la double validation vient interdire.
-- Elle est supprimée plutôt que laissée en place à côté des trois nouvelles,
-- pour qu'aucun chemin ne contourne la règle. Son seul appelant était
-- l'application (src/lib/actions/samples.ts), mis à jour dans le même
-- chantier.

drop function if exists submit_sample_decision(uuid, sample_decision, text);
