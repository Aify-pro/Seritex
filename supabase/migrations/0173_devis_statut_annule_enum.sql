-- ============================================================================
-- 0173 — Statut « annulé » pour les devis (proformas)
-- ============================================================================
--
-- Décision du 2026-11-10 : un devis peut être annulé, même accepté ; son ODF
-- est annulé avec lui (0174). La valeur d'énumération est ajoutée seule dans
-- cette migration : PostgreSQL n'autorise pas l'usage d'une nouvelle valeur
-- dans la transaction qui la crée (même découpage que 0013, 0049, 0099).
-- ============================================================================

alter type quote_status add value if not exists 'annule';
