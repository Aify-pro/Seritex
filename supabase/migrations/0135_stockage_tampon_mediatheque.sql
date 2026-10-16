-- ============================================================================
-- Seritex — Médiathèque : rôle d'une cible de stockage (stockage / tampon)
--
-- Une cible « tampon » n'est utilisée que lorsqu'AUCUNE cible « stockage » (NAS,
-- Drive…) n'est joignable au moment du dépôt : le fichier y attend (copie
-- « en_attente »), puis est déplacé vers le stockage dès qu'il redevient
-- joignable, et la copie du tampon est supprimée.
-- Aucune donnée existante n'est modifiée : toutes les cibles restent « stockage ».
-- ============================================================================

create type storage_target_role as enum ('stockage', 'tampon');

alter table storage_targets
  add column role storage_target_role not null default 'stockage';

comment on column storage_targets.role is
  'stockage = destination définitive ; tampon = relais temporaire quand aucun stockage n''est joignable (vidé automatiquement).';
