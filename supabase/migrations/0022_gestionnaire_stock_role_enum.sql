-- ============================================================================
-- Seritex — Nouveau rôle « Gestionnaire de stock »
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 16) —
-- « le gestionnaire de stock enregistre la livraison de tissu à la section
-- comme un mouvement de stock » (entrée), à distinguer du rôle « peseur »
-- (sortie : lot produit, sac de déchets, retour de tissu).
-- ============================================================================
--
-- Remonté en usage réel : la section Coupe (chef_section) pouvait jusqu'ici
-- saisir elle-même la réception de tissu (pesée d'entrée), ce qui n'est pas
-- son rôle — c'est celui du gestionnaire de stock. Ce chantier introduit ce
-- 7e rôle système, séparément de la migration qui l'utilisera
-- (0023_gestionnaire_stock_role.sql) : Postgres interdit d'utiliser une
-- valeur d'enum ajoutée dans la même transaction que son ajout — même
-- convention que 0013/0014 (lot 4, valeur 'matelas_cloture').

alter type user_role add value 'gestionnaire_stock';
