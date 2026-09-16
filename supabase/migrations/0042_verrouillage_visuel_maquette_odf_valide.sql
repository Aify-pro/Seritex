-- ============================================================================
-- Seritex — Verrouillage du visuel/maquette d'ODF une fois l'ODF validé
-- ============================================================================
-- Demande Ayman, 16/09 : « une fois l'ODF validé tout se verrouille, et
-- pareil pour le visuel ». jusqu'ici, attachMediaFileToLine/
-- detachMediaFileFromLine (migration 0040) ne contrôlaient que le rôle, pas
-- le statut de l'ODF — un visuel ou une maquette restait modifiable même en
-- production, contrairement aux sections retenues et à la fiche Patronnage.
--
-- Point de verrouillage : le même que fiches_placement/traces_placement
-- (migration 0037) — figé dès que le statut sort de brouillon/en_attente_
-- validation/refuse — et PAS le point plus précoce utilisé pour la
-- configuration produit (modèle/couleur/tailles, verrouillée dès la
-- soumission). Nécessaire : validate_production_order() exige un visuel
-- pour toute section Impression retenue — le verrouiller dès la soumission
-- interdirait de corriger un visuel manquant avant la validation.
-- ============================================================================

drop policy if exists production_order_media_files_write on production_order_media_files;
create policy production_order_media_files_write on production_order_media_files for insert
  with check (
    is_production_manager()
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_media_files.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists production_order_media_files_delete on production_order_media_files;
create policy production_order_media_files_delete on production_order_media_files for delete
  using (
    is_production_manager()
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_media_files.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );
