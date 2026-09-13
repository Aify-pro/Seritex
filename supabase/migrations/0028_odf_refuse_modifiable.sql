-- ============================================================================
-- Seritex — Un ODF refusé n'est plus un cul-de-sac
-- Réf. : retour métier du 13/09/2026 — « un refus de validation peut être
--        pour une simple erreur de saisie »
-- ============================================================================
--
-- Deux défauts se cumulaient, et se renforçaient l'un l'autre :
--
--   1. submit_production_order() n'accepte que le statut `brouillon`. Un ODF
--      refusé ne pouvait donc plus jamais être resoumis : le seul recours
--      était de l'annuler et de tout ressaisir, alors qu'un refus sanctionne
--      souvent une faute de frappe.
--   2. Le motif du refus n'était écrit que dans audit_log.metadata — donc
--      invisible depuis la fiche. La personne chargée de corriger ne voyait
--      ni pourquoi son ODF avait été refusé, ni quoi corriger.
--
-- `refuse` et `annulee` retrouvent ainsi des poids différents : le premier
-- est une étape du dialogue, le second une fin de parcours.

-- ============================================================================
-- 1. LE MOTIF DU REFUS DEVIENT UNE DONNÉE DE L'ODF
-- ============================================================================
-- Même trio que la clôture (cloture_note / closed_by / closed_at) : le motif,
-- qui l'a posé, quand. Effacés à la resoumission — un motif traité n'a pas à
-- rester affiché sur un ODF qu'on vient de corriger, et status_history garde
-- l'historique complet des allers-retours.
alter table production_orders
  add column if not exists refus_motif text,
  add column if not exists refuse_par uuid references app_users(id),
  add column if not exists refuse_le timestamptz;

comment on column production_orders.refus_motif is
  'Motif du dernier refus de validation, affiché sur la fiche pour que la correction soit possible. Effacé à la resoumission ; l''historique des refus successifs reste dans status_history et audit_log.';

-- ============================================================================
-- 2. REFUS — le motif est désormais conservé
-- ============================================================================
create or replace function refuse_production_order(
  p_production_order_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de refuser un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_attente_validation' then
    raise exception 'cet ordre de fabrication n''est pas en attente de validation (statut actuel : %)', v_po.status;
  end if;

  update production_orders
  set status = 'refuse',
      refus_motif = nullif(trim(coalesce(p_reason, '')), ''),
      refuse_par = auth.uid(),
      refuse_le = now()
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'refuse', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'refuse_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ============================================================================
-- 3. SOUMISSION — depuis un brouillon OU depuis un refus
-- ============================================================================
-- Identique à la version 0009, avec deux changements : le statut de départ
-- accepte `refuse`, et la resoumission solde le motif précédent.
create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_sections where production_order_id = p_production_order_id) then
    raise exception 'aucune section retenue : sélectionnez au moins une section avant de soumettre';
  end if;
  if not exists (select 1 from production_order_sizes where production_order_id = p_production_order_id) then
    raise exception 'aucune quantité par taille renseignée avant de soumettre';
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id, '{}'::jsonb);
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;
revoke all on function refuse_production_order(uuid, text) from public, anon, authenticated;
grant execute on function refuse_production_order(uuid, text) to authenticated;
