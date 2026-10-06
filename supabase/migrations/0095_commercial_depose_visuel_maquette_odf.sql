-- ============================================================================
-- 0095 — Le commercial peut déposer maquette/visuel sur un article d'ODF
-- ============================================================================
-- Demande Ayman, 05/10 (suite de 0094) : depuis la fiche échantillon, le
-- commercial doit pouvoir déposer la maquette et les visuels même quand la
-- fiche est rattachée en direct à un article d'ODF (pas de ligne de devis).
-- Jusqu'ici l'écriture sur production_order_media_files était réservée au
-- responsable production / administrateur (0019, resserrée par 0042), alors
-- que la lecture était déjà ouverte au commercial (0019) : il voyait les
-- fichiers de l'article sans pouvoir en ajouter.
--
-- Ce qui NE change pas :
--   - le verrouillage de 0042 : plus aucun dépôt ni retrait dès que l'ODF
--     dépasse brouillon / en_attente_validation / refusé ;
--   - l'affectation d'un visuel à un atelier précis (0069, insert) reste au
--     responsable production / administrateur : c'est un acte d'atelier, le
--     commercial n'a pas d'écran pour ça. Seule la SUPPRESSION d'affectation
--     s'ouvre au commercial, pour qu'un visuel qu'il retire de l'article ne
--     laisse pas derrière lui une affectation orpheline (le code de retrait
--     supprime les deux : voir detachMediaFileFromSampleArticle).
--   - l'écran ODF lui-même reste inaccessible au commercial (rôles de
--     src/app/(app)/atelier/production/[id]/page.tsx) : son point d'entrée
--     est la fiche échantillon.
-- ============================================================================

drop policy if exists production_order_media_files_write on production_order_media_files;
create policy production_order_media_files_write on production_order_media_files for insert
  with check (
    (is_production_manager() or is_commercial_or_above())
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_media_files.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists production_order_media_files_delete on production_order_media_files;
create policy production_order_media_files_delete on production_order_media_files for delete
  using (
    (is_production_manager() or is_commercial_or_above())
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_media_files.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

drop policy if exists pols_visuels_delete on production_order_line_section_visuels;
create policy pols_visuels_delete on production_order_line_section_visuels for delete
  using (
    (is_production_manager() or is_commercial_or_above())
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_line_section_visuels.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );
