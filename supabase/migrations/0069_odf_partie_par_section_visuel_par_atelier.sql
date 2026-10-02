-- ============================================================================
-- Seritex — ODF : travail réparti par PARTIE de pièce + visuel par atelier
-- ============================================================================
-- Demande Ayman, 02/10 :
--
-- 1. Un article peut être réparti entre deux sections d'une même catégorie
--    non pas par nombre de pièces, mais par PARTIE de la pièce : une partie du
--    T-shirt en DTF et l'autre en sérigraphie ; les manches montées à la
--    bonneterie et le col au bunker. Chaque atelier travaille alors sur toutes
--    les pièces, pour sa partie. L'application ne doit plus y voir un doublon
--    (l'avertissement « le total des pièces ne correspond pas » ne concernait
--    que la répartition par quantité).
--
-- 2. Quand plusieurs ateliers d'impression sont retenus sur un article, chacun
--    a son propre visuel (celui qui part en DTF n'est pas celui qui part en
--    sérigraphie) : un visuel est affecté à un atelier précis.
--
-- Aucun changement de validate_production_order() : la quantité planifiée du
-- sous-ODF reste coalesce(quantite, quantité de l'article), donc la quantité
-- totale pour une section « par partie » (quantite null). L'exigence « un
-- visuel joint à l'article » reste celle de la migration 0036/0037.
-- ============================================================================

-- 1. Partie de la pièce confiée à la section (libre : « Manches », « Col »,
--    « Poitrine »…). Null = la section travaille sur l'ensemble de la pièce.
alter table production_order_line_sections
  add column partie text
    constraint production_order_line_sections_partie_valide
      check (partie is null or (char_length(btrim(partie)) between 1 and 80));

comment on column production_order_line_sections.partie is
  'Partie de la pièce confiée à cette section (ex. Manches, Col). Renseignée : la section travaille sur toutes les pièces de l''article, pour cette partie seulement — elle n''entre plus dans le contrôle « total des ateliers d''une catégorie = quantité de l''article ». Null : l''ensemble de la pièce.';

-- 2. Visuel affecté à une section (atelier d'impression) pour un article.
--    Table d'affectation plutôt qu'une colonne sur production_order_media_files :
--    un visuel peut venir du devis (quote_line_media_files, lecture seule côté
--    ODF) et doit pouvoir être affecté lui aussi. Un visuel non affecté reste
--    simplement « à l'article », comme avant.
create table production_order_line_section_visuels (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  section_id uuid not null references sections(id),
  media_file_id uuid not null references media_files(id) on delete cascade,
  added_by uuid references app_users(id),
  added_at timestamptz not null default now(),
  unique (production_order_line_id, section_id, media_file_id)
);

create index idx_pols_visuels_line on production_order_line_section_visuels(production_order_line_id);
create index idx_pols_visuels_odf on production_order_line_section_visuels(production_order_id);
create index idx_pols_visuels_media on production_order_line_section_visuels(media_file_id);

comment on table production_order_line_section_visuels is
  'Visuel(s) d''exploitation affecté(s) à un atelier précis pour un article d''ODF (ex. DTF vs sérigraphie). Le fichier est joint à l''article (production_order_media_files) ou hérité du devis ; cette table dit seulement dans quel atelier il part.';

alter table production_order_line_section_visuels enable row level security;

-- Même lecture que production_order_media_files ; écriture figée au même
-- point (migration 0042) : modifiable jusqu'à la validation de l'ODF.
create policy pols_visuels_select on production_order_line_section_visuels for select
  using (is_production_manager() or current_role_name() = 'commercial');

create policy pols_visuels_write on production_order_line_section_visuels for insert
  with check (
    is_production_manager()
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_line_section_visuels.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

create policy pols_visuels_delete on production_order_line_section_visuels for delete
  using (
    is_production_manager()
    and not exists (
      select 1 from production_orders po
      where po.id = production_order_line_section_visuels.production_order_id
        and po.status not in ('brouillon', 'en_attente_validation', 'refuse')
    )
  );

revoke all on production_order_line_section_visuels from public, anon;
grant select, insert, delete on production_order_line_section_visuels to authenticated;
