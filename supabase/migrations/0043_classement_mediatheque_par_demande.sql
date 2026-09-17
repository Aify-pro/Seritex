-- ============================================================================
-- Seritex — Classement de la médiathèque par demande (n° REQ-XXXX)
-- ============================================================================
-- Correctif métier (demande Ayman, 17/09) : le dépôt direct ajouté dans le
-- lot précédent (migration 0042 et écrans associés) contournait la
-- médiathèque au lieu de l'organiser. Le vrai besoin :
--
--   - un fichier peut être affilié à PLUSIEURS demandes (réutilisation d'une
--     demande à l'autre) — même principe que sample_request_media_files
--     (0003) pour les fiches échantillon, ici appliqué à `requests` ;
--   - un fichier n'apparaît dans le "dossier" d'une demande que s'il y est
--     explicitement affilié — jamais par défaut.
--
-- La fenêtre de sélection visuel/maquette de l'ODF/du devis (écrans) ne
-- proposera donc plus toute la médiathèque du client, mais seulement les
-- fichiers déjà affiliés à LA demande dont dépend cet article (ODF →
-- quotes.request_id, devis → quotes.request_id directement) — voir le code
-- applicatif, cette migration ne fait que poser la table qui le permet.
-- ============================================================================

create table request_media_files (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  media_file_id uuid not null references media_files(id) on delete cascade,
  added_by uuid references app_users(id),
  added_at timestamptz not null default now(),
  unique (request_id, media_file_id)
);

create index idx_request_media_files_request on request_media_files(request_id);
create index idx_request_media_files_media on request_media_files(media_file_id);

alter table request_media_files enable row level security;

-- Même cloisonnement que requests (0002) : le client voit et organise ses
-- propres fichiers (il peut déjà les déposer, migration 0003), le staff
-- production a aussi besoin d'écrire ici — is_commercial_or_above() seul
-- exclurait responsable_production, qui affilie pourtant des fichiers
-- depuis l'écran ODF.
create policy request_media_files_select on request_media_files for select
  using (exists (
    select 1 from requests r where r.id = request_media_files.request_id
      and (is_staff() or is_client_of(r.company_id))
  ));
create policy request_media_files_write on request_media_files for insert
  with check (exists (
    select 1 from requests r where r.id = request_media_files.request_id
      and (is_commercial_or_above() or is_production_manager() or is_client_of(r.company_id))
  ));
create policy request_media_files_delete on request_media_files for delete
  using (exists (
    select 1 from requests r where r.id = request_media_files.request_id
      and (is_commercial_or_above() or is_production_manager() or is_client_of(r.company_id))
  ));

revoke all on request_media_files from public, anon;
grant select, insert, delete on request_media_files to authenticated;

-- ----------------------------------------------------------------------------
-- Backfill : les fichiers déjà attachés à un article d'ODF ou de devis
-- héritent rétroactivement de l'affiliation à leur demande d'origine, pour
-- que l'existant reste cohérent sous le nouveau système (sinon un visuel
-- déjà joint à un article deviendrait invisible dans son propre dossier).
-- ----------------------------------------------------------------------------

insert into request_media_files (request_id, media_file_id, added_by, added_at)
select distinct q.request_id, pomf.media_file_id, pomf.added_by, pomf.added_at
from production_order_media_files pomf
join production_orders po on po.id = pomf.production_order_id
join quotes q on q.id = po.quote_id
on conflict (request_id, media_file_id) do nothing;

insert into request_media_files (request_id, media_file_id, added_by, added_at)
select distinct q.request_id, qlmf.media_file_id, qlmf.added_by, qlmf.added_at
from quote_line_media_files qlmf
join quote_lines ql on ql.id = qlmf.quote_line_id
join quotes q on q.id = ql.quote_id
on conflict (request_id, media_file_id) do nothing;
