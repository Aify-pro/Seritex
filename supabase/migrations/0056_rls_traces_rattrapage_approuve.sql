-- ============================================================================
-- Seritex — Correctif : un tracé de rattrapage approuvé redevient éditable
-- ============================================================================
--
-- Constat : sur une fiche « Bon pour coupe » dont l'ODF est « en_production »,
-- un tracé de rattrapage APPROUVÉ (est_correctif and approuve_par is not null)
-- est déverrouillé côté application (assertTraceEditable), mais la RLS de
-- traces_placement refuse toute mise à jour : la ligne n'est pas modifiée et
-- Postgres ne lève AUCUNE erreur (0 ligne affectée). Effet visible : on dépose
-- un DXF, l'analyse est enregistrée, mais le nom du fichier n'apparaît jamais
-- sur le tracé — « il ne se passe rien ».
--
-- Cause : la migration 0012 avait prévu ces exceptions (update : rattrapage
-- approuvé ; delete : demande en attente), puis 0027/0037 ont réécrit les
-- policies update/delete (passage à production_order_line_id) sans les
-- reprendre. On les rétablit ici, à l'identique de 0012, avec la jointure
-- actuelle (fiches_placement → production_order_lines → production_orders).
--
-- Périmètre volontairement minimal : seules les policies UPDATE et DELETE de
-- traces_placement changent. Les droits requis (has_permission) sont ceux déjà
-- en vigueur ; INSERT et SELECT ne sont pas touchés.

drop policy if exists traces_placement_update on traces_placement;
create policy traces_placement_update on traces_placement
  for update
  using (
    has_permission('patronnage', 'modify')
    and (
      (est_correctif and approuve_par is not null)
      or not exists (
        select 1 from fiches_placement fp
        join production_order_lines pol on pol.id = fp.production_order_line_id
        join production_orders po on po.id = pol.production_order_id
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
        join production_order_lines pol on pol.id = fp.production_order_line_id
        join production_orders po on po.id = pol.production_order_id
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
        join production_order_lines pol on pol.id = fp.production_order_line_id
        join production_orders po on po.id = pol.production_order_id
        where fp.id = traces_placement.fiche_id
          and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
      )
    )
  );
