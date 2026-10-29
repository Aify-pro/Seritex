-- ============================================================================
-- 0153 — Semi-finis, étape 4b : paquets QR par pièce, réorientation entre
--        lignes d'ODF
-- ============================================================================
--
-- Chantier semi-finis, décisions S47-S48 (2026-10-29).
--
--   1. Paquets par pièce (S47) : à la clôture d'un matelas regroupé (0150),
--      un lot QR par article d'ODF × taille pour la pièce coupée (ex. « 60
--      manches M — ODF A »), porté par l'atelier de coupe puis scanné d'atelier
--      en atelier comme les autres lots (0086, 0152). Le lot « t-shirts » de
--      l'assemblage (0150) sert au suivi après le montage.
--   2. Les pièces d'un article coupé par pièces sont désormais comptées par
--      ses paquets (attribution courante) : besoin en pièces, assemblage en
--      t-shirts complets et stock tampon suivent les paquets.
--   3. Réorientation (S48) : un chef de production réoriente un paquet (ou une
--      partie, par découpage du lot) vers une autre ligne d'ODF qui a besoin
--      du même semi-fini, dans la même couleur et le même tissu, tant que le
--      paquet n'est pas verrouillé (entré en personnalisation) et dans la
--      limite des pièces pas encore assemblées. Motif obligatoire, tracé.
--   4. Découpage et regroupement de paquets : un sous-lot garde sa pièce et son
--      verrou ; on ne regroupe pas des pièces différentes.
--
-- Ajout seul côté moteur : scan, découpage, regroupement et déclarations ne
-- changent pas (déclencheurs et nouvelles fonctions). Reprises de fonctions
-- de 0149/0150 (besoin en pièces, assemblage, stock tampon) : mêmes règles,
-- comptage par paquets. Aucune donnée existante modifiée (aucun matelas
-- regroupé clôturé au 2026-10-29).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PAQUETS PAR PIÈCE
-- ----------------------------------------------------------------------------

alter table article_lots
  add column if not exists semi_fini_id uuid references product_models(id),
  add column if not exists cloture_pieces_id uuid references clotures_matelas_pieces(id);

create index if not exists idx_article_lots_semi_fini on article_lots(semi_fini_id) where semi_fini_id is not null;

comment on column article_lots.semi_fini_id is
  'Paquet de pièces (0153, S47) : le semi-fini du paquet (manche, col…) ; null pour un lot de t-shirts.';

alter table article_lot_events drop constraint if exists article_lot_events_type_check;
alter table article_lot_events add constraint article_lot_events_type_check
  check (type in ('entree_section', 'sortie_section', 'declaration', 'decoupage', 'regroupement', 'mise_en_colis', 'reorientation'));

-- Un paquet par article × taille à la clôture pièce par pièce (0150).
create or replace function pieces_coupees_paquet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cloture_pieces_id is null or new.quantite <= 0 or new.semi_fini_id is null then
    return new;
  end if;
  insert into article_lots (production_order_id, production_order_line_id, trace_id, categorie, composition_taille,
                            etape_courante, created_by, semi_fini_id, cloture_pieces_id)
  values (new.production_order_id, new.production_order_line_id, new.trace_id, 'semi_fini',
          jsonb_build_object(new.taille, new.quantite),
          (select wo.etape from work_orders wo
           where wo.production_order_line_id = new.production_order_line_id and section_categorie_cle(wo.section_id) = 'coupe'
           order by wo.etape nulls last limit 1),
          auth.uid(), new.semi_fini_id, new.cloture_pieces_id);
  return new;
end;
$$;

drop trigger if exists trg_pieces_coupees_paquet on pieces_coupees;
create trigger trg_pieces_coupees_paquet
  after insert on pieces_coupees
  for each row execute function pieces_coupees_paquet();

-- Un sous-lot (découpage) garde la pièce et le verrou de son lot d'origine.
create or replace function article_lots_herite_paquet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent article_lots;
begin
  if new.parent_lot_id is not null then
    select * into v_parent from article_lots where id = new.parent_lot_id;
    new.semi_fini_id := coalesce(new.semi_fini_id, v_parent.semi_fini_id);
    new.cloture_pieces_id := coalesce(new.cloture_pieces_id, v_parent.cloture_pieces_id);
    new.verrouille_le := coalesce(new.verrouille_le, v_parent.verrouille_le);
    new.verrouille_section_id := coalesce(new.verrouille_section_id, v_parent.verrouille_section_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_article_lots_herite_paquet on article_lots;
create trigger trg_article_lots_herite_paquet
  before insert on article_lots
  for each row execute function article_lots_herite_paquet();

-- Regroupement : pas de mélange de pièces (ni pièces avec t-shirts) ; le lot
-- regroupé reprend la pièce commune.
create or replace function article_lot_events_regroupement_paquets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_sf uuid;
begin
  if new.type <> 'regroupement' then
    return new;
  end if;
  select count(distinct coalesce(src.semi_fini_id::text, 'tshirt')), min(src.semi_fini_id::text)::uuid
    into v_n, v_sf
  from article_lot_events e
  join article_lots src on src.id = e.article_lot_id
  where e.type = 'regroupement' and e.related_lot_id = new.related_lot_id
    and src.statut = 'regroupe';
  if v_n > 1 then
    raise exception 'on ne regroupe que des paquets de la même pièce (ou des lots de t-shirts entre eux)';
  end if;
  update article_lots set semi_fini_id = v_sf where id = new.related_lot_id and semi_fini_id is distinct from v_sf and statut <> 'regroupe';
  return new;
end;
$$;

drop trigger if exists trg_article_lot_events_regroupement_paquets on article_lot_events;
create trigger trg_article_lot_events_regroupement_paquets
  after insert on article_lot_events
  for each row execute function article_lot_events_regroupement_paquets();

-- ----------------------------------------------------------------------------
-- 2. PIÈCES COMPTÉES PAR PAQUETS (reprises de 0149 et 0150)
-- ----------------------------------------------------------------------------

-- Pièces attribuées à un article pour un semi-fini et une taille : ses paquets
-- actifs (un lot découpé ou regroupé est remplacé par ses sous-lots).
create or replace function pieces_attribuees(p_line_id uuid, p_semi_fini_id uuid, p_taille text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(coalesce((al.composition_taille ->> p_taille)::numeric, 0)), 0)::int
  from article_lots al
  where al.production_order_line_id = p_line_id and al.semi_fini_id = p_semi_fini_id
    and al.statut not in ('eclate', 'regroupe');
$$;

create or replace function besoin_pieces_ligne(p_line_id uuid, p_semi_fini_id uuid, p_trace_exclu uuid default null)
returns table (taille text, demandees int, coupees int, prevues int, reste int)
language sql
stable
security definer
set search_path = public
as $$
  with qte as (
    select coalesce(sum(nl.quantite_par_piece), 0) as par_piece
    from production_order_lines pol
    join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id
    where pol.id = p_line_id
  )
  select pos.taille,
         (pos.quantite_demandee * (select par_piece from qte))::int,
         x.coupees, x.prevues,
         (pos.quantite_demandee * (select par_piece from qte))::int - x.coupees - x.prevues
  from production_order_sizes pos
  cross join lateral (
    select
      pieces_attribuees(p_line_id, p_semi_fini_id, pos.taille) as coupees,
      coalesce((select sum(coalesce((t.repartition_par_couche ->> pos.taille)::numeric, 0) * tc.nb_couches)
                from trace_couches tc
                join traces_placement t on t.id = tc.trace_id
                join fiches_placement fp on fp.id = t.fiche_id
                where tc.production_order_line_id = p_line_id and fp.semi_fini_id = p_semi_fini_id
                  and t.statut in ('bon_pour_coupe', 'en_coupe')
                  and t.id is distinct from p_trace_exclu), 0)::int as prevues
  ) x
  where pos.production_order_line_id = p_line_id;
$$;

create or replace function kits_coupes_actualiser(p_line_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_wo work_orders;
  v_delta jsonb := '{}'::jsonb;
  v_total int := 0;
begin
  select * into v_line from production_order_lines where id = p_line_id;
  if not found or not ligne_coupee_par_pieces(p_line_id) then
    return 0;
  end if;
  select * into v_wo from work_orders
  where production_order_line_id = p_line_id and section_categorie_cle(section_id) = 'coupe'
  order by etape nulls last, created_at limit 1;
  if v_wo.id is null then
    return 0;
  end if;

  with sf as (
    select nl.semi_fini_id, sum(nl.quantite_par_piece) as qte
    from nomenclature_lines nl
    where nl.product_model_id = v_line.product_model_id and nl.semi_fini_id is not null
    group by nl.semi_fini_id
  ),
  possible as (
    select pos.taille,
           (select min(floor(pieces_attribuees(p_line_id, sf.semi_fini_id, pos.taille) / sf.qte)) from sf)::int as kits
    from production_order_sizes pos
    where pos.production_order_line_id = p_line_id
  ),
  deja as (
    select kv.key as taille, sum(kv.value::numeric)::int as n
    from work_order_events e
    cross join lateral jsonb_each_text(coalesce(e.quantites_obtenues, '{}'::jsonb)) kv
    where e.work_order_id = v_wo.id and e.event_type = 'matelas_cloture' and e.trace_id is null
    group by kv.key
  )
  select coalesce(jsonb_object_agg(p.taille, p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), '{}'::jsonb),
         coalesce(sum(p.kits - coalesce(d.n, 0)) filter (where p.kits - coalesce(d.n, 0) > 0), 0)::int
    into v_delta, v_total
  from possible p left join deja d on d.taille = p.taille
  where p.kits is not null;

  if v_total <= 0 then
    return 0;
  end if;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment, resultat, quantites_obtenues)
  values (v_wo.id, 'matelas_cloture', auth.uid(), v_total,
          'Assemblage des pièces coupées par ordres regroupés (t-shirts complets)', 'ok', v_delta);
  update work_orders
  set quantity_done = quantity_done + v_total,
      actual_start = coalesce(actual_start, now()),
      actual_end = case when quantity_done + v_total >= quantity_planned then now() else null end
  where id = v_wo.id;
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'assembler_kits_coupes', 'work_order', v_wo.id,
          jsonb_build_object('production_order_line_id', p_line_id, 'kits', v_delta));
  return v_total;
end;
$$;

-- Pièces d'un article déjà assemblées en t-shirts pour un semi-fini et une taille.
create or replace function pieces_assemblees(p_line_id uuid, p_semi_fini_id uuid, p_taille text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (coalesce((select sum(coalesce((e.quantites_obtenues ->> p_taille)::numeric, 0))
                    from work_order_events e join work_orders w on w.id = e.work_order_id
                    where w.production_order_line_id = p_line_id and e.event_type = 'matelas_cloture'
                      and e.trace_id is null), 0)
          * coalesce((select sum(nl.quantite_par_piece) from production_order_lines pol
                      join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id
                      where pol.id = p_line_id), 0))::int;
$$;

create or replace function stock_tampon_semi_fini(p_semi_fini_id uuid)
returns table (production_order_id uuid, odf text, line_id uuid, article text, taille text, coupees int, assemblees int, en_attente int)
language sql
stable
security definer
set search_path = public
as $$
  with lignes as (
    -- Article coupé par pièces : ses paquets (attribution courante).
    select al.production_order_line_id as line_id, kv.key as taille, sum(kv.value::numeric)::int as coupees
    from article_lots al
    cross join lateral jsonb_each_text(al.composition_taille) kv
    where al.semi_fini_id = p_semi_fini_id and al.statut not in ('eclate', 'regroupe')
    group by al.production_order_line_id, kv.key
    union all
    -- Article coupé en t-shirts entiers : pièces reconnues sur ses tracés (0146).
    select pc.production_order_line_id, pc.taille, sum(pc.quantite)::int
    from pieces_coupees pc
    where pc.semi_fini_id = p_semi_fini_id and pc.source = 'trace' and pc.cloture_pieces_id is null
      and not ligne_coupee_par_pieces(pc.production_order_line_id)
    group by pc.production_order_line_id, pc.taille
  )
  select po.id, po.reference, l.line_id, pol.description, l.taille, l.coupees, a.assemblees,
         greatest(l.coupees - a.assemblees, 0)
  from lignes l
  join production_order_lines pol on pol.id = l.line_id
  join production_orders po on po.id = pol.production_order_id
  cross join lateral (
    select case when ligne_coupee_par_pieces(l.line_id) then pieces_assemblees(l.line_id, p_semi_fini_id, l.taille)
                else l.coupees end as assemblees
  ) a
  where is_staff() and po.status not in ('terminee', 'annulee')
  order by po.reference, pol.created_at, l.taille;
$$;

-- ----------------------------------------------------------------------------
-- 3. RÉORIENTATION D'UN PAQUET (S48)
-- ----------------------------------------------------------------------------

-- Couleur(s) d'un composant sur une ligne d'ODF : imposée, sinon celle de sa
-- zone, sinon la couleur unique (même règle que la destination, 0152).
create or replace function couleur_composant(p_line_id uuid, p_semi_fini_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(distinct coalesce(nl.couleur_imposee_id, zc.color_id, pol.couleur_unique_id)::text, ',')
  from production_order_lines pol
  join nomenclature_lines nl on nl.product_model_id = pol.product_model_id and nl.semi_fini_id = p_semi_fini_id
  left join production_order_line_zone_colors zc on zc.production_order_line_id = pol.id and zc.zone_key = nl.zone_key
  where pol.id = p_line_id;
$$;

-- Lignes d'ODF vers lesquelles un paquet peut être réorienté.
create or replace function lignes_compatibles_paquet(p_code text)
returns table (line_id uuid, odf text, article text, couleur text, reste int)
language sql
stable
security definer
set search_path = public
as $$
  with lot as (
    select al.*, (select pm.textile_id from production_order_lines pol join product_models pm on pm.id = pol.product_model_id
                  where pol.id = al.production_order_line_id) as textile_id
    from article_lots al where al.code = upper(btrim(p_code))
  )
  select pol.id, po.reference, pol.description,
         (select string_agg(c.name, ', ') from colors c
          where c.id::text = any(string_to_array(couleur_composant(pol.id, lot.semi_fini_id), ','))),
         (select coalesce(sum(greatest(b.reste, 0)), 0)::int from besoin_pieces_ligne(pol.id, lot.semi_fini_id) b)
  from lot
  join production_order_lines pol on pol.id <> lot.production_order_line_id
  join production_orders po on po.id = pol.production_order_id
  join product_models pm on pm.id = pol.product_model_id
  where has_permission('ordres_fabrication', 'view')
    and lot.semi_fini_id is not null
    and po.status = 'en_production'
    and ligne_coupee_par_pieces(pol.id)
    and exists (select 1 from nomenclature_lines nl where nl.product_model_id = pol.product_model_id and nl.semi_fini_id = lot.semi_fini_id)
    and couleur_composant(pol.id, lot.semi_fini_id) is not distinct from couleur_composant(lot.production_order_line_id, lot.semi_fini_id)
    and pm.textile_id is not distinct from lot.textile_id
  order by po.reference, pol.created_at;
$$;

create or replace function reorienter_paquet(p_code text, p_line_cible uuid, p_composition jsonb, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot article_lots;
  v_cible production_order_lines;
  v_source uuid;
  v_compo jsonb;
  v_taille text;
  v_q int;
  v_dispo int;
  v_paquet uuid;
  v_code text;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : la réorientation des pièces est réservée aux chefs de production';
  end if;
  if v_motif is null then
    raise exception 'un motif est obligatoire pour réorienter des pièces';
  end if;
  v_lot := find_article_lot(p_code);
  if v_lot.semi_fini_id is null then
    raise exception 'le lot % n''est pas un paquet de pièces : seuls les paquets de semi-finis se réorientent', v_lot.code;
  end if;
  if v_lot.statut <> 'en_cours' then
    raise exception 'le paquet % ne peut plus être réorienté (%)', v_lot.code, v_lot.statut;
  end if;
  if v_lot.verrouille_le is not null then
    raise exception 'le paquet % est verrouillé sur sa ligne d''ODF (entré en personnalisation)', v_lot.code;
  end if;
  if not exists (select 1 from lignes_compatibles_paquet(v_lot.code) c where c.line_id = p_line_cible) then
    raise exception 'cette ligne d''ODF ne peut pas recevoir ce paquet : il faut le même semi-fini, la même couleur et le même tissu, sur un ODF en production coupé par pièces';
  end if;
  select * into v_cible from production_order_lines where id = p_line_cible;
  v_source := v_lot.production_order_line_id;
  v_compo := coalesce(nullif(p_composition, '{}'::jsonb), v_lot.composition_taille);

  -- Jamais plus que les pièces de la ligne d'origine pas encore assemblées.
  for v_taille, v_q in select key, value::int from jsonb_each_text(v_compo) loop
    if v_q <= 0 or v_q > coalesce((v_lot.composition_taille ->> v_taille)::int, 0) then
      raise exception 'taille % : % pièce(s) demandée(s), le paquet en contient %', v_taille, v_q, coalesce((v_lot.composition_taille ->> v_taille)::int, 0);
    end if;
    v_dispo := pieces_attribuees(v_source, v_lot.semi_fini_id, v_taille) - pieces_assemblees(v_source, v_lot.semi_fini_id, v_taille);
    if v_q > v_dispo then
      raise exception 'taille % : seulement % pièce(s) pas encore assemblée(s) sur la ligne d''origine', v_taille, v_dispo;
    end if;
  end loop;

  if v_compo = v_lot.composition_taille then
    v_paquet := v_lot.id;
    v_code := v_lot.code;
  else
    select s.id, s.code into v_paquet, v_code from split_article_lot(v_lot.code, v_compo) s;
  end if;
  update article_lots
  set production_order_line_id = v_cible.id, production_order_id = v_cible.production_order_id
  where id = v_paquet;

  insert into article_lot_events (article_lot_id, type, detail, created_by)
  values (v_paquet, 'reorientation',
          jsonb_build_object('de_ligne', v_source, 'vers_ligne', v_cible.id, 'composition', v_compo, 'motif', v_motif),
          auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'reorienter_paquet', 'article_lot', v_paquet,
          jsonb_build_object('code', v_code, 'de_ligne', v_source, 'vers_ligne', v_cible.id, 'composition', v_compo, 'motif', v_motif));

  -- La ligne qui reçoit peut assembler de nouveaux t-shirts ; les écarts se recalculent.
  perform kits_coupes_actualiser(v_cible.id);
  begin
    perform ecart_coupe_actualiser(v_cible.id, false);
    perform ecart_coupe_actualiser(v_source, false);
  exception when others then
    raise warning 'écarts de coupe non recalculés : %', sqlerrm;
  end;
  return jsonb_build_object('code', v_code, 'vers_ligne', v_cible.id);
end;
$$;

-- Paquets d'un semi-fini (fiche du semi-fini, onglet Stock tampon).
create or replace function paquets_semi_fini(p_semi_fini_id uuid)
returns table (lot_id uuid, code text, production_order_id uuid, odf text, line_id uuid, article text,
               composition_taille jsonb, detenteur text, en_transit boolean, verrouille boolean)
language sql
stable
security definer
set search_path = public
as $$
  select al.id, al.code, po.id, po.reference, al.production_order_line_id, pol.description,
         al.composition_taille, s.name, d.en_transit, al.verrouille_le is not null
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  cross join lateral lot_detenteur(al.id) d
  left join sections s on s.id = d.section_id
  where is_staff() and al.semi_fini_id = p_semi_fini_id and al.statut = 'en_cours'
    and po.status not in ('terminee', 'annulee')
  order by po.reference, al.code;
$$;

revoke all on function pieces_coupees_paquet() from public, anon, authenticated;
revoke all on function pieces_attribuees(uuid, uuid, text) from public, anon, authenticated;
revoke all on function pieces_assemblees(uuid, uuid, text) from public, anon, authenticated;
revoke all on function besoin_pieces_ligne(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function kits_coupes_actualiser(uuid) from public, anon, authenticated;
revoke all on function stock_tampon_semi_fini(uuid) from public, anon, authenticated;
revoke all on function couleur_composant(uuid, uuid) from public, anon, authenticated;
revoke all on function lignes_compatibles_paquet(text) from public, anon, authenticated;
revoke all on function reorienter_paquet(text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function paquets_semi_fini(uuid) from public, anon, authenticated;
grant execute on function stock_tampon_semi_fini(uuid) to authenticated;
grant execute on function lignes_compatibles_paquet(text) to authenticated;
grant execute on function reorienter_paquet(text, uuid, jsonb, text) to authenticated;
grant execute on function paquets_semi_fini(uuid) to authenticated;
