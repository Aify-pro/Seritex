-- ============================================================================
-- Seritex — Module Production, lot 3 : tracé de rattrapage
-- Réf. : claude_logique-ordre-fabrication-consolidee.md,
--        claude_cahier-des-charges-technique-production.md (lot 3)
-- ============================================================================
--
-- Une fiche Patronnage "Bon pour coupe" (et, en cascade, ses tracés) est
-- figée : ni l'application (assertFicheModifiable) ni la RLS depuis le lot 2
-- ne permettent plus d'y toucher. Le tracé de rattrapage est l'unique porte
-- de sortie prévue : un chef de section demande un tracé correctif motivé,
-- un chef de production (has_permission('patronnage','validate')) l'approuve
-- ou le refuse. Une fois approuvé, ce tracé précis redevient éditable comme
-- n'importe quel tracé normal (dépôt DXF, dimensions matelas...) — le reste
-- de la fiche/des autres tracés reste figé.
--
-- Décisions actées ici (cahier des charges laissait le schéma à affiner) :
--   - Colonnes ajoutées : est_correctif, justification, approuve_par,
--     approuve_le (prévues par le cahier des charges) + demande_par,
--     demande_le (mêmes conventions que valide_par/valide_le,
--     archive_par/archive_le déjà sur fiches_placement — traçabilité
--     complète de qui a demandé, pas seulement qui a approuvé).
--   - Trois états portés par les colonnes nullables (pas de colonne statut
--     dédiée, même logique que fiches_placement.valide_le) :
--       est_correctif=false                        → tracé normal
--       est_correctif=true, approuve_par is null    → demande en attente
--       est_correctif=true, approuve_par is not null → rattrapage approuvé
--   - La demande et l'approbation/le refus passent par des fonctions RPC
--     security definer (même mécanisme que validate_production_order) :
--     c'est la seule façon propre de créer/modifier une ligne alors que la
--     RLS générale bloque tout sur une fiche bon_pour_coupe. Une fois
--     approuvé, le tracé redevient éditable par le circuit normal
--     (uploadTraceDxf, updateTrace...) via les carve-outs RLS ci-dessous —
--     pas besoin de RPC dédiées pour chaque champ.
--   - Le déclenchement n'est ouvert que si fiche.statut = 'bon_pour_coupe' :
--     avant ce statut, le circuit normal (addTrace) suffit déjà, pas besoin
--     du mécanisme de rattrapage.

-- ============================================================================
-- 1. COLONNES
-- ============================================================================

alter table traces_placement
  add column est_correctif boolean not null default false,
  add column justification text,
  add column demande_par uuid references app_users(id),
  add column demande_le timestamptz,
  add column approuve_par uuid references app_users(id),
  add column approuve_le timestamptz,
  add constraint traces_placement_correctif_justifie
    check (not est_correctif or justification is not null);

comment on column traces_placement.est_correctif is
  'Tracé de rattrapage (lot 3) : ajouté après que la fiche soit passée "Bon pour coupe", via request_corrective_trace(). false = tracé du circuit normal.';
comment on column traces_placement.approuve_par is
  'Chef de production ayant approuvé la demande (approve_corrective_trace()). Null tant que la demande est en attente — c''est ce qui déverrouille le tracé pour édition normale.';

-- File d'attente d'approbation : index partiel, ne porte que les demandes en
-- attente (une poignée de lignes en pratique, pas tous les tracés).
create index idx_traces_placement_correctif_pending
  on traces_placement (fiche_id)
  where est_correctif and approuve_par is null;

-- ============================================================================
-- 2. RPC — DEMANDE (chef de section, ou tout rôle avec create/modify sur le
--    module patronnage)
-- ============================================================================

create or replace function request_corrective_trace(
  p_fiche_id uuid,
  p_justification text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche fiches_placement;
  v_next_ordre int;
  v_trace_id uuid;
begin
  if not (has_permission('patronnage', 'create') or has_permission('patronnage', 'modify')) then
    raise exception 'accès refusé : votre rôle ne permet pas de demander un tracé de rattrapage';
  end if;
  if p_justification is null or trim(p_justification) = '' then
    raise exception 'justification obligatoire pour un tracé de rattrapage';
  end if;

  select * into v_fiche from fiches_placement where id = p_fiche_id;
  if not found then
    raise exception 'fiche introuvable';
  end if;
  if v_fiche.statut <> 'bon_pour_coupe' then
    raise exception 'un tracé de rattrapage ne se demande que sur une fiche déjà "Bon pour coupe" (statut actuel : %) — utilisez l''ajout de tracé normal', v_fiche.statut;
  end if;

  select coalesce(max(ordre), 0) + 1 into v_next_ordre from traces_placement where fiche_id = p_fiche_id;

  insert into traces_placement (
    fiche_id, ordre, reference, est_correctif, justification, demande_par, demande_le
  ) values (
    p_fiche_id, v_next_ordre, v_fiche.numero_ot || '-T' || v_next_ordre || '-R',
    true, trim(p_justification), auth.uid(), now()
  ) returning id into v_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'request_corrective_trace', 'trace_placement', v_trace_id,
          jsonb_build_object('fiche_id', p_fiche_id, 'justification', p_justification));

  return v_trace_id;
end;
$$;
revoke all on function request_corrective_trace(uuid, text) from public, anon;
grant execute on function request_corrective_trace(uuid, text) to authenticated;

-- ============================================================================
-- 3. RPC — APPROBATION / REFUS (chef de production, has_permission('patronnage','validate'))
-- ============================================================================

create or replace function approve_corrective_trace(p_trace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
begin
  if not has_permission('patronnage', 'validate') then
    raise exception 'accès refusé : seul un chef de production peut approuver un tracé de rattrapage';
  end if;

  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if not v_trace.est_correctif then
    raise exception 'ce tracé n''est pas une demande de rattrapage';
  end if;
  if v_trace.approuve_par is not null then
    raise exception 'ce tracé de rattrapage est déjà approuvé';
  end if;

  update traces_placement
  set approuve_par = auth.uid(), approuve_le = now()
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id)
  values (auth.uid(), 'approve_corrective_trace', 'trace_placement', p_trace_id);
end;
$$;
revoke all on function approve_corrective_trace(uuid) from public, anon;
grant execute on function approve_corrective_trace(uuid) to authenticated;

create or replace function reject_corrective_trace(p_trace_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
begin
  if not has_permission('patronnage', 'validate') then
    raise exception 'accès refusé : seul un chef de production peut refuser un tracé de rattrapage';
  end if;

  select * into v_trace from traces_placement where id = p_trace_id;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  if not v_trace.est_correctif or v_trace.approuve_par is not null then
    raise exception 'seule une demande de rattrapage en attente peut être refusée';
  end if;

  -- Journalisé avant suppression : la demande refusée n'a jamais fait partie
  -- du circuit normal, rien d'autre n'y fait référence.
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'reject_corrective_trace', 'trace_placement', p_trace_id,
          jsonb_build_object('motif', p_motif));

  delete from traces_placement where id = p_trace_id;
end;
$$;
revoke all on function reject_corrective_trace(uuid, text) from public, anon;
grant execute on function reject_corrective_trace(uuid, text) to authenticated;

-- ============================================================================
-- 4. RLS — CARVE-OUTS SUR LES POLICIES POSÉES AU LOT 2
-- ============================================================================
-- Un tracé de rattrapage approuvé (est_correctif and approuve_par is not
-- null) reste éditable/supprimable malgré le verrou ODF ordinaire — c'est le
-- sens même du rattrapage. Une demande en attente (est_correctif and
-- approuve_par is null) reste supprimable par son demandeur (annulation
-- avant traitement) même si la fiche est verrouillée par ailleurs.
-- L'insertion, elle, ne passe jamais par ce chemin normal : seule la RPC
-- request_corrective_trace() (security definer) crée une ligne correctif.

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (
    has_permission('patronnage', 'modify')
    and (
      (est_correctif and approuve_par is not null)
      or not exists (
        select 1 from fiches_placement fp
        join production_orders po on po.id = fp.odf_id
        where fp.id = traces_placement.fiche_id
          and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
      )
    )
  )
  with check (
    has_permission('patronnage', 'modify')
    and (
      (est_correctif and approuve_par is not null)
      or not exists (
        select 1 from fiches_placement fp
        join production_orders po on po.id = fp.odf_id
        where fp.id = traces_placement.fiche_id
          and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
      )
    )
  );

drop policy if exists traces_placement_delete on traces_placement;
create policy traces_placement_delete on traces_placement
  for delete
  using (
    (has_permission('patronnage', 'modify') or has_permission('patronnage', 'delete'))
    and (
      (est_correctif and approuve_par is null)
      or not exists (
        select 1 from fiches_placement fp
        join production_orders po on po.id = fp.odf_id
        where fp.id = traces_placement.fiche_id
          and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
      )
    )
  );
