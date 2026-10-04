-- ============================================================================
-- 0074 — LIV-0 (fichier a) : rôles « livreur » et « responsable livraison »
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot LIV-0 (L4, Q-LIV-6).
-- Valeurs d'enum ajoutées dans un fichier à part de la migration qui les
-- utilise (0075) : Postgres interdit d'utiliser une valeur d'enum dans la
-- transaction qui l'ajoute — même convention que 0013/0014, 0022/0023,
-- 0049/0050.

alter type user_role add value if not exists 'livreur';
alter type user_role add value if not exists 'responsable_livraison';
