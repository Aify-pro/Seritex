-- ============================================================================
-- 0092 — Lots créés à la clôture d'un matelas (retour de recette C3)
-- ============================================================================
--
-- L'étiquette réellement imprimée en atelier est celle de la clôture d'un
-- matelas, une par taille (référence d'OT, taille, quantité). Les lots QR de
-- SF-5 n'y correspondaient pas : le scan des sections ne reconnaissait rien.
-- Désormais :
--   - chaque clôture de matelas crée un lot par taille obtenue (catégorie
--     semi-fini), relié à la clôture, au tracé et à la ligne d'ODF ;
--   - l'étiquette imprime le code de ce lot et son QR (application) ;
--   - les clôtures déjà faites sur des ODF encore ouverts reçoivent leurs lots.
-- create_article_lot() reste disponible pour un lot créé à la main.
-- ============================================================================

alter table article_lots
  add column if not exists work_order_event_id uuid references work_order_events(id),
  add column if not exists matelas_taille text;

create unique index if not exists article_lots_matelas_taille_unique
  on article_lots(work_order_event_id, matelas_taille)
  where work_order_event_id is not null;

comment on column article_lots.work_order_event_id is
  'Clôture de matelas dont le lot est issu (une étiquette par taille) — retour de recette C3.';

create or replace function create_matelas_lots(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev work_order_events;
  v_wo work_orders;
  v_n int;
begin
  select * into v_ev from work_order_events where id = p_event_id;
  if v_ev.id is null or v_ev.event_type::text <> 'matelas_cloture' then
    return 0;
  end if;
  select * into v_wo from work_orders where id = v_ev.work_order_id;

  insert into article_lots (production_order_id, production_order_line_id, trace_id, categorie, composition_taille,
                            etape_courante, created_by, work_order_event_id, matelas_taille)
  select v_wo.production_order_id, v_wo.production_order_line_id, v_ev.trace_id, 'semi_fini',
         jsonb_build_object(kv.key, kv.value::numeric::int), v_wo.etape, v_ev.user_id, v_ev.id, kv.key
  from jsonb_each_text(coalesce(v_ev.quantites_obtenues, '{}'::jsonb)) kv
  where kv.value::numeric > 0
  on conflict (work_order_event_id, matelas_taille) where work_order_event_id is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function create_matelas_lots(uuid) from public, anon, authenticated;

create or replace function work_order_events_matelas_lots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type::text = 'matelas_cloture' then
    perform create_matelas_lots(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists work_order_events_matelas_lots on work_order_events;
create trigger work_order_events_matelas_lots
  after insert on work_order_events
  for each row execute function work_order_events_matelas_lots();

-- Clôtures déjà faites sur des ODF encore ouverts.
select create_matelas_lots(ev.id)
from work_order_events ev
join work_orders w on w.id = ev.work_order_id
join production_orders po on po.id = w.production_order_id
where ev.event_type::text = 'matelas_cloture'
  and po.status not in ('terminee', 'annulee');
