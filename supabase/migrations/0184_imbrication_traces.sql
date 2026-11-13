-- ============================================================
-- 0184 — Imbrication, phase 3 : calculs rattachés à un tracé
-- ============================================================
-- Le calcul automatique se lance depuis la fenêtre d'un tracé (module
-- patronnage), à côté du dépôt d'un fichier Modaris, qui reste possible.
--
--  * imbrication_calculs.trace_id : le tracé pour lequel le calcul a été
--    lancé (contexte : pièces par couche, laize). Un tracé supprimé ne
--    supprime pas l'historique des calculs.
--  * imbrication_calculs.groupe : calculs lancés ENSEMBLE pour être
--    comparés (une laize par calcul : rouleaux disponibles).
--  * traces_placement.imbrication_calcul_id : le fichier du tracé vient de
--    ce calcul (null = fichier déposé, Modaris / Diamino). Posé par
--    l'utilisateur quand il choisit « Utiliser ce tracé » : un calcul n'est
--    jamais rattaché tout seul (décision humaine).
--
-- Aucune nouvelle politique : la pose du lien passe par la mise à jour d'un
-- tracé, déjà gardée par la RLS de traces_placement ; le calcul s'insère
-- avec la politique d'insertion de 0182 (statut en attente, à son nom).
-- ============================================================

alter table imbrication_calculs
  add column if not exists trace_id uuid references traces_placement(id) on delete set null,
  add column if not exists groupe uuid;

create index if not exists imbrication_calculs_trace_idx on imbrication_calculs (trace_id, created_at desc);
create index if not exists imbrication_calculs_groupe_idx on imbrication_calculs (groupe) where groupe is not null;

alter table traces_placement
  add column if not exists imbrication_calcul_id uuid references imbrication_calculs(id) on delete set null;

comment on column imbrication_calculs.trace_id is 'Tracé pour lequel le calcul a été lancé (contexte), null si lancé hors tracé.';
comment on column imbrication_calculs.groupe is 'Calculs lancés ensemble pour être comparés (une laize chacun).';
comment on column traces_placement.imbrication_calcul_id is 'Calcul d''imbrication Seritex dont vient le fichier du tracé ; null = fichier déposé (Modaris / Diamino).';
