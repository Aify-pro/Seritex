-- ============================================================================
-- Seritex — Export Sage (CSV) et rapprochement des fiches de mouvement stock
-- ============================================================================
--
-- Décision produit (Ayman, 16/09) : le gestionnaire de stock doit pouvoir
-- exporter les mouvements de stock (stock_movements) vers un fichier CSV au
-- format d'import Sage — par ODF (déjà le périmètre de generate_stock_
-- export_fiche depuis 0020) ou globalement, tous ODF confondus. Une fois ce
-- CSV importé côté Sage, il doit pouvoir reporter dans Seritex le numéro de
-- la fiche de mouvement que Sage lui a renvoyée, pour rapprocher/valider
-- l'export.
--
-- Format CSV et connexion réelle à Sage volontairement HORS PÉRIMÈTRE ici
-- (aucune spec Sage fournie à ce stade) — seule l'architecture est posée :
-- le mapping de colonnes exact se règlera plus tard, sans changement de
-- schéma, quand la connexion réelle sera disponible (même philosophie que
-- /parametres/sage : "la logique et le modèle de données sont intégrés dès
-- maintenant ; la connexion réelle... sera assurée plus tard").
--
-- Pas de nouvelle table pour le rapprochement : une fiche stock_export_
-- fiches EST déjà le batch exporté chez Sage (un mouvement n'appartient
-- qu'à une fiche au plus, exported_in_fiche_id) — Sage ne renvoie qu'un
-- seul numéro par import, donc le rapprochement se pose sur la fiche, pas
-- mouvement par mouvement.

-- ============================================================================
-- 1. stock_export_fiches : fiche globale (ODF nullable) + rapprochement Sage
-- ============================================================================
-- ODF nullable : une fiche "globale" (tous ODF confondus) ne peut plus
-- porter un production_order_id unique — ses mouvements restent chacun
-- rattachés à leur propre ODF via stock_movements.production_order_id,
-- inchangé.

alter table stock_export_fiches alter column production_order_id drop not null;

alter table stock_export_fiches
  add column sage_numero text,
  add column sage_rapproche_le timestamptz,
  add column sage_rapproche_par uuid references app_users(id);

comment on column stock_export_fiches.production_order_id is
  'ODF concerné — null pour une fiche générée globalement (tous ODF confondus, migration 0038).';
comment on column stock_export_fiches.sage_numero is
  'Numéro de la fiche de mouvement renvoyé par Sage une fois le CSV importé — saisi manuellement par le gestionnaire de stock tant qu''aucune connexion Sage réelle n''existe (migration 0038).';

-- ============================================================================
-- 2. generate_stock_export_fiche() : p_production_order_id devient optionnel
-- ============================================================================
-- Reprend la version 0023 à l'identique (même autorisation, même mécanique)
-- — seule la portée du filtre change : null = tous les mouvements non
-- exportés, toutes ODF confondues.

create or replace function generate_stock_export_fiche(p_production_order_id uuid default null)
returns table (id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_fiche stock_export_fiches;
  v_count int;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : la génération d''une fiche d''export stock est réservée à la direction/production/gestion de stock';
  end if;

  if p_production_order_id is not null and not exists (
    select 1 from production_orders where id = p_production_order_id
  ) then
    raise exception 'ordre de fabrication introuvable';
  end if;

  select count(*) into v_count from stock_movements
  where exported_in_fiche_id is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);
  if v_count = 0 then
    if p_production_order_id is null then
      raise exception 'aucun mouvement de stock non exporté, toutes ODF confondues';
    else
      raise exception 'aucun mouvement de stock non exporté pour cet ordre de fabrication';
    end if;
  end if;

  insert into stock_export_fiches (production_order_id, generated_by)
  values (p_production_order_id, auth.uid())
  returning * into v_fiche;

  update stock_movements
  set exported_in_fiche_id = v_fiche.id
  where exported_in_fiche_id is null
    and (p_production_order_id is null or production_order_id = p_production_order_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_stock_export_fiche', 'stock_export_fiche', v_fiche.id,
          jsonb_build_object('production_order_id', p_production_order_id, 'nb_mouvements', v_count));

  return query select v_fiche.id, v_fiche.numero;
end;
$$;
revoke all on function generate_stock_export_fiche(uuid) from public, anon, authenticated;
grant execute on function generate_stock_export_fiche(uuid) to authenticated;

-- ============================================================================
-- 3. record_sage_reconciliation() : rapprochement d'une fiche déjà générée
-- ============================================================================
-- Même périmètre de rôles que generate_stock_export_fiche — c'est le même
-- métier (export/suivi Sage), pas une action de validation de direction.

create or replace function record_sage_reconciliation(p_fiche_id uuid, p_sage_numero text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role not in ('administrateur', 'responsable_production', 'gestionnaire_stock') then
    raise exception 'accès refusé : le rapprochement Sage est réservé à la direction/production/gestion de stock';
  end if;

  if p_sage_numero is null or trim(p_sage_numero) = '' then
    raise exception 'numéro de fiche Sage obligatoire';
  end if;

  update stock_export_fiches
  set sage_numero = trim(p_sage_numero),
      sage_rapproche_le = now(),
      sage_rapproche_par = auth.uid()
  where id = p_fiche_id;

  if not found then
    raise exception 'fiche d''export introuvable';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_sage_reconciliation', 'stock_export_fiche', p_fiche_id,
          jsonb_build_object('sage_numero', trim(p_sage_numero)));
end;
$$;
revoke all on function record_sage_reconciliation(uuid, text) from public, anon, authenticated;
grant execute on function record_sage_reconciliation(uuid, text) to authenticated;
