-- ============================================================================
-- 0101 — Qui a pris la décision sur l'échantillon
-- ============================================================================
-- Demande Ayman, 06/10 (suite de 0100) : la fiche imprimée doit porter, pour
-- un échantillon « à ajuster » ou « refusé », le MOTIF et la personne qui a
-- répondu — hors du cartouche de signature, qui ne garde que les validations.
--
-- `sample_feedback` (schéma initial) conserve le texte, la décision et la
-- date, mais pas l'auteur : seul audit_log le savait, ce qui n'est pas une
-- source d'affichage. On l'ajoute ici et les deux RPC de 0100 le remplissent.
-- Les lignes antérieures restent sans auteur (affichage « — »), aucun
-- rattrapage possible sans inventer une information.
-- ============================================================================

alter table sample_feedback
  add column decided_by uuid references app_users(id);

comment on column sample_feedback.decided_by is
  'Utilisateur qui a posé la décision (0101). NULL pour les décisions antérieures à cette migration.';

-- ----------------------------------------------------------------------------
-- Les deux RPC de 0100, à l'identique sauf `decided_by`.
-- ----------------------------------------------------------------------------

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
    status = (case when v_client_le is not null and v_direction_le is not null then 'valide' else 'en_validation' end)::sample_request_status
  where id = p_sample_request_id;

  insert into sample_feedback (sample_request_id, feedback_text, decision, decided_by)
  values (p_sample_request_id, p_commentaire, 'valide', auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'valider_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('partie', p_partie, 'pour_le_client', v_pour_le_client,
                             'complet', v_client_le is not null and v_direction_le is not null));
end;
$$;

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

  insert into sample_feedback (sample_request_id, feedback_text, decision, decided_by)
  values (p_sample_request_id, p_commentaire, p_decision, auth.uid());

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'refuser_echantillon', 'sample_request', p_sample_request_id,
          jsonb_build_object('decision', p_decision,
                             'validations_effacees', jsonb_build_object(
                               'client', v_sr.validation_client_le is not null,
                               'direction', v_sr.validation_direction_le is not null)));
end;
$$;

revoke all on function valider_echantillon(uuid, text, text) from public, anon, authenticated;
grant execute on function valider_echantillon(uuid, text, text) to authenticated;
revoke all on function refuser_echantillon(uuid, sample_decision, text) from public, anon, authenticated;
grant execute on function refuser_echantillon(uuid, sample_decision, text) to authenticated;
