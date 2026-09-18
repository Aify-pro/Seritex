-- ============================================================================
-- Seritex — Nouveau rôle « Comptabilité »
-- Réf. : circuit de validation de l'ODF (demande Ayman, 18/09) — avant de
-- pouvoir soumettre un ODF à validation, la comptabilité doit attester que
-- le compte du client est en règle.
-- ============================================================================
--
-- Valeur d'enum ajoutée séparément de la migration qui l'utilisera
-- (0050_circuit_validation_odf.sql) : Postgres interdit d'utiliser une
-- valeur d'enum ajoutée dans la même transaction que son ajout — même
-- convention que 0022/0023 (gestionnaire_stock) et 0013/0014 (matelas_cloture).

alter type user_role add value 'comptabilite';
