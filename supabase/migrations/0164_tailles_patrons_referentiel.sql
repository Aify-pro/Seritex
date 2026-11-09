-- ============================================================================
-- 0164 — La taille d'un patron vient du référentiel
-- ============================================================================
--
-- La taille d'un patron était saisie en texte libre (« S ») alors que tout le
-- reste du logiciel utilise la clé du référentiel (« Homme/S ») : le contrôle
-- d'un tracé comparait les deux et signalait un écart à tort. Homme et Femme
-- sont des patrons différents (décision du 2026-11-09).
--
-- Le seul patron existant en taille « S » est un patron Homme (confirmé par le
-- propriétaire). Les noms de tailles du référentiel qui changent suivent.
-- ============================================================================

update patterns set size = 'Homme/S' where size = 'S';

alter table patterns
  add constraint patterns_size_referentiel foreign key (size) references sizes(cle) on update cascade;
