-- ============================================================================
-- Seritex — L'ordre de tracé se pilote par modèle d'article
-- Réf. : lot C2 du chantier ODF, suite du lot C1 (0032_referentiel_textiles)
-- ============================================================================
--
-- Constat de la recette bout-en-bout (13/09/2026) : une fiche de placement
-- (« OT », fiches_placement) pouvait être validée puis liée à un ODF sans
-- jamais porter d'article, de quantité, de dispatching ni de tracé — cadre 1
-- (designation_article, reference_modele) et cadre 3 (tissu_type, grammage,
-- laize_utile_cm) sont du texte libre, sans lien avec la nomenclature.
--
-- Ce lot ajoute uniquement product_model_id : le reste (désignation, tissu,
-- grammage, laize) continue d'exister en colonnes texte/numériques, mais
-- devient des valeurs FIGÉES À LA SÉLECTION du modèle (même traitement que
-- client_code/client_libelle déjà en place) plutôt que retapées à la main —
-- traité côté application (createFiche/updateFiche/generateFicheFromOdf),
-- pas ici. Décision d'Ayman sur le regroupement : un OT par modèle
-- d'article, peu importe la couleur — pas par textile (deux modèles peuvent
-- partager un tissu sans partager un patron).
-- ============================================================================

alter table fiches_placement
  add column if not exists product_model_id uuid references product_models(id);

create index if not exists idx_fiches_placement_product_model on fiches_placement(product_model_id);

comment on column fiches_placement.product_model_id is
  'Modèle choisi en cadre 1 (lot C2). Pilote désignation_article, tissu_type, grammage et laize_utile_cm, figés à la sélection depuis product_models/textiles — plus de saisie libre une fois un modèle choisi. Null tant que la fiche reste une demande sans modèle (aucun champ n''est obligatoire à la création).';
