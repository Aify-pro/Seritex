-- ============================================================================
-- 0152 — Semi-finis, étape 4a : contrat d'étape, stock tampon par atelier,
--        verrouillage à l'entrée en personnalisation, destination d'un lot
-- ============================================================================
--
-- Chantier semi-finis (S13, S16, S17, S18, S25, S47-S49), 2026-10-29.
--
--   1. Contrat d'étape (§4.10, document semi-finis-contrat-etape.md) : les
--      catégories d'atelier déclarent leurs propriétés. Cette étape ajoute :
--        personnalise : entrer dans une section de cette catégorie rend le
--                       produit spécifique à la ligne d'ODF (S13) — vrai pour
--                       Impression ;
--        granularite  : déclaration au kit ou par composant (§4.7) — « kit »
--                       partout pour l'instant.
--   2. Verrouillage : quand un lot est scanné à l'entrée d'une section de
--      personnalisation, il est verrouillé sur sa ligne d'ODF (date et
--      section notées). Un lot verrouillé ne pourra plus être réorienté
--      (réorientation : étape 4b).
--   3. Stock tampon par atelier (S25) : un lot est détenu par la section de
--      son dernier scan d'entrée ; scanné en sortie, il est « en transit » ;
--      jamais scanné, il est à la section qui l'a créé (la Coupe).
--   4. Destination d'un lot (S17) : ce que le scan affiche à l'atelier —
--      ODF, article, modèle, tailles, couleur de chaque composant, verrou —
--      jamais le client.
--
-- Ajout seul : scan_article_lot, les lots, les déclarations et le flux ne
-- changent pas (le verrou est posé par un déclencheur sur le scan).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CONTRAT D'ÉTAPE
-- ----------------------------------------------------------------------------

alter table atelier_categories
  add column if not exists personnalise boolean not null default false,
  add column if not exists granularite text not null default 'kit'
    constraint atelier_categories_granularite_valide check (granularite in ('kit', 'composant'));

comment on column atelier_categories.personnalise is
  'Contrat d''étape (0152, S13) : entrer dans une section de cette catégorie rend le produit spécifique à la ligne d''ODF (verrouillage du lot au scan d''entrée).';
comment on column atelier_categories.granularite is
  'Contrat d''étape (0152, §4.7) : déclaration au kit (une pièce complète) ou par composant (semi-fini).';

update atelier_categories set personnalise = true where cle = 'impression';

-- ----------------------------------------------------------------------------
-- 2. VERROUILLAGE À L'ENTRÉE EN PERSONNALISATION
-- ----------------------------------------------------------------------------

alter table article_lots
  add column if not exists verrouille_le timestamptz,
  add column if not exists verrouille_section_id uuid references sections(id);

comment on column article_lots.verrouille_le is
  'Lot verrouillé sur sa ligne d''ODF à son entrée dans une section de personnalisation (0152, S13) : il ne peut plus être réorienté.';

create or replace function article_lot_events_verrou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type = 'entree_section' and new.section_id is not null and exists (
       select 1 from sections s join atelier_categories ac on ac.id = s.categorie_id
       where s.id = new.section_id and ac.personnalise) then
    update article_lots
    set verrouille_le = new.created_at, verrouille_section_id = new.section_id
    where id = new.article_lot_id and verrouille_le is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_article_lot_events_verrou on article_lot_events;
create trigger trg_article_lot_events_verrou
  after insert on article_lot_events
  for each row execute function article_lot_events_verrou();

-- Lots déjà entrés en personnalisation (reprise).
update article_lots al
set verrouille_le = e.created_at, verrouille_section_id = e.section_id
from (
  select distinct on (ev.article_lot_id) ev.article_lot_id, ev.created_at, ev.section_id
  from article_lot_events ev
  join sections s on s.id = ev.section_id
  join atelier_categories ac on ac.id = s.categorie_id
  where ev.type = 'entree_section' and ac.personnalise
  order by ev.article_lot_id, ev.created_at
) e
where e.article_lot_id = al.id and al.verrouille_le is null;

-- ----------------------------------------------------------------------------
-- 3. STOCK TAMPON PAR ATELIER
-- ----------------------------------------------------------------------------

-- Détenteur d'un lot : section du dernier scan d'entrée ; en transit après
-- un scan de sortie ; sinon la section qui l'a créé (Coupe).
create or replace function lot_detenteur(p_lot_id uuid)
returns table (section_id uuid, en_transit boolean, depuis timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with dernier as (
    select ev.type, ev.section_id, ev.created_at
    from article_lot_events ev
    where ev.article_lot_id = p_lot_id and ev.type in ('entree_section', 'sortie_section')
    order by ev.created_at desc
    limit 1
  ),
  creation as (
    select coalesce(w.section_id,
                    (select wo.section_id from work_orders wo
                     where wo.production_order_line_id = al.production_order_line_id
                       and section_categorie_cle(wo.section_id) = 'coupe'
                     order by wo.etape nulls last limit 1)) as section_id,
           al.created_at
    from article_lots al
    left join work_order_events e on e.id = al.work_order_event_id
    left join work_orders w on w.id = e.work_order_id
    where al.id = p_lot_id
  )
  select case when d.type = 'entree_section' then d.section_id
              when d.type is null then c.section_id end,
         coalesce(d.type = 'sortie_section', false),
         coalesce(d.created_at, c.created_at)
  from creation c
  left join dernier d on true;
$$;

-- Lots en cours détenus par une section (ou en transit depuis elle).
create or replace function stock_tampon_atelier(p_section_id uuid)
returns table (lot_id uuid, code text, categorie text, production_order_id uuid, odf text, article text,
               composition_taille jsonb, en_transit boolean, depuis timestamptz, verrouille boolean)
language sql
stable
security definer
set search_path = public
as $$
  select al.id, al.code, al.categorie, po.id, po.reference, pol.description,
         al.composition_taille, d.en_transit, d.depuis, al.verrouille_le is not null
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  cross join lateral lot_detenteur(al.id) d
  where is_staff()
    and al.statut = 'en_cours'
    and po.status not in ('terminee', 'annulee')
    and (d.section_id = p_section_id
         or (d.en_transit and exists (select 1 from article_lot_events ev
                                      where ev.article_lot_id = al.id and ev.type = 'sortie_section'
                                        and ev.section_id = p_section_id
                                        and ev.created_at = d.depuis)))
  order by d.en_transit, po.reference, al.code;
$$;

-- ----------------------------------------------------------------------------
-- 4. DESTINATION D'UN LOT (affichée au scan, jamais le client)
-- ----------------------------------------------------------------------------

create or replace function destination_lot(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'code', al.code,
    'categorie', al.categorie,
    'odf', po.reference,
    'article', pol.description,
    'modele', pm.name,
    'tailles', al.composition_taille,
    'couleur_unique', cu.name,
    'couleurs_zones', coalesce((
      select jsonb_agg(jsonb_build_object('zone', coalesce(z.zone_label, zc.zone_key), 'couleur', c.name) order by z.display_order)
      from production_order_line_zone_colors zc
      join colors c on c.id = zc.color_id
      left join product_zone_templates z on z.product_model_id = pol.product_model_id and z.zone_key = zc.zone_key
      where zc.production_order_line_id = pol.id), '[]'::jsonb),
    -- Couleur de chaque composant de la nomenclature (0143) : imposée, ou
    -- celle de sa zone, ou la couleur unique de la ligne.
    'composants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'composant', nl.designation,
               'quantite', nl.quantite_par_piece,
               'couleur', coalesce(ci.name, cz.name, cu.name)) order by nl.created_at)
      from nomenclature_lines nl
      left join colors ci on ci.id = nl.couleur_imposee_id
      left join production_order_line_zone_colors zc on zc.production_order_line_id = pol.id and zc.zone_key = nl.zone_key
      left join colors cz on cz.id = zc.color_id
      where nl.product_model_id = pol.product_model_id and (nl.semi_fini_id is not null or nl.mp_id is not null)), '[]'::jsonb),
    'verrouille', al.verrouille_le is not null,
    'verrouille_section', (select name from sections where id = al.verrouille_section_id),
    'detenteur', (select s.name from lot_detenteur(al.id) d join sections s on s.id = d.section_id),
    'en_transit', (select d.en_transit from lot_detenteur(al.id) d)
  )
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  left join product_models pm on pm.id = pol.product_model_id
  left join colors cu on cu.id = pol.couleur_unique_id
  where al.code = upper(btrim(p_code)) and is_staff();
$$;

revoke all on function lot_detenteur(uuid) from public, anon, authenticated;
revoke all on function stock_tampon_atelier(uuid) from public, anon, authenticated;
revoke all on function destination_lot(text) from public, anon, authenticated;
grant execute on function stock_tampon_atelier(uuid) to authenticated;
grant execute on function destination_lot(text) to authenticated;
