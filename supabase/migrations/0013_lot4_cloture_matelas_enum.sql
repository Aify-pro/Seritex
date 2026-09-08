-- ============================================================================
-- Seritex — Module Production, lot 4 : nouvelle valeur d'enum (préalable)
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (section 13)
-- ============================================================================
--
-- Migration séparée à dessein : ALTER TYPE ... ADD VALUE doit être commité
-- avant que la nouvelle valeur ne puisse être utilisée dans une insertion ou
-- une comparaison (Postgres : "unsafe use of new value of enum type" sinon).
-- La suite (colonnes, index, RPC close_matelas qui utilisent cette valeur)
-- est dans 0014_lot4_cloture_matelas.sql, une transaction séparée.

alter type work_order_event_type add value 'matelas_cloture';
