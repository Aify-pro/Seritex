-- ============================================================================
-- Seritex — Visuel et maquette rattachables dès le devis
-- ============================================================================
-- Correctif métier (demande Ayman, 16/09) sur le chantier maquette/visuel de
-- la migration 0040 : les deux n'ont ni la même origine ni le même cycle de
-- vie.
--
--   - MAQUETTE : établie dès le devis, validée par le client en l'acceptant
--     — avant même l'échantillon. Une seule par ligne. Si elle n'a pas été
--     chargée au moment du devis, l'ODF permet de rattraper (c'est déjà le
--     comportement de la migration 0040, inchangé) — mais dès qu'une
--     maquette existe au niveau du devis, c'est elle qui fait foi : l'écran
--     ODF l'affiche en lecture seule plutôt que d'en proposer une autre.
--   - VISUEL(S) : le ou les fichiers d'exploitation que la section
--     Impression utilise pour travailler. Peuvent être déposés à n'importe
--     quel moment, du devis jusqu'à l'ODF — jamais exclusifs, jamais
--     remplacés : l'ODF affiche l'union de ceux du devis et des siens.
--
-- Cette migration ajoute donc l'équivalent, au niveau de la ligne de devis,
-- de production_order_media_files (0019/0037) : quote_line_media_files.
-- Même table media_files, mêmes catégories ("visuel"/"maquette", 0040) —
-- seul le point de rattachement change.
-- ============================================================================

create table quote_line_media_files (
  id uuid primary key default gen_random_uuid(),
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  media_file_id uuid not null references media_files(id) on delete cascade,
  added_by uuid references app_users(id),
  added_at timestamptz not null default now(),
  unique (quote_line_id, media_file_id)
);

create index idx_quote_line_media_files_line on quote_line_media_files(quote_line_id);

alter table quote_line_media_files enable row level security;

-- Même cloisonnement que quote_lines (0002) : le client voit (et doit
-- pouvoir ouvrir la maquette pour la valider), seul commercial/administrateur
-- dépose ou retire.
create policy quote_line_media_files_select on quote_line_media_files for select
  using (exists (
    select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_media_files.quote_line_id
      and (is_admin() or current_role_name() = 'commercial' or is_client_of(q.company_id))
  ));
create policy quote_line_media_files_write on quote_line_media_files for insert
  with check (exists (
    select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_media_files.quote_line_id and is_commercial_or_above()
  ));
create policy quote_line_media_files_delete on quote_line_media_files for delete
  using (exists (
    select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = quote_line_media_files.quote_line_id and is_commercial_or_above()
  ));

revoke all on quote_line_media_files from public, anon;
grant select, insert, delete on quote_line_media_files to authenticated;
