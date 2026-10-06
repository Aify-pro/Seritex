-- ============================================================================
-- 0099 — Statut « en validation » pour la fiche échantillon
-- ============================================================================
-- Réf. : double validation de l'échantillon (demande Ayman, 06/10) — un
-- échantillon n'est « validé » que lorsque le CLIENT et la DIRECTION l'ont
-- tous les deux validé. Entre les deux, la fiche n'est plus simplement
-- « envoyée » : elle attend la seconde signature.
--
-- Valeur d'enum ajoutée séparément de la migration qui l'utilisera
-- (0100_echantillon_double_validation.sql) : Postgres interdit d'utiliser
-- une valeur d'enum ajoutée dans la même transaction que son ajout — même
-- convention que 0049/0050 (comptabilité) et 0022/0023 (gestionnaire stock).

alter type sample_request_status add value 'en_validation' before 'valide';
