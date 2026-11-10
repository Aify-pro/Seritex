-- ============================================================================
-- 0174 — Annulation d'un devis (proforma) et de son ODF
-- ============================================================================
--
-- Décisions du 2026-11-10 :
--   - un devis s'annule toujours, même accepté et même si son ODF est en
--     production, avec un motif obligatoire ;
--   - réservé à l'administrateur et à la Direction (module de droits
--     « annulation_devis », droit Valider) ;
--   - l'annulation du devis annule l'ODF qui en est né (l'application le
--     demande en confirmation) : les deux passent « annulé » ;
--   - la demande est rouverte (statut « en analyse ») si elle n'a plus aucun
--     autre devis en cours ;
--   - les pièces déjà coupées restent en stock tampon, rattachées à l'ODF
--     annulé : les écrans de stock tampon les montrent comme « ODF annulé » et
--     les paquets se réorientent vers un autre ODF en production avec la
--     réorientation existante (0153) ;
--   - un ODF terminé n'est jamais annulé : le devis ne s'annule plus (la
--     marchandise est produite, c'est un retour ou un avoir).
--
-- Rien ne change pour Sage : le devis Sage (miroir en lecture) et les bons de
-- commande déjà copiés ne sont pas touchés.
-- Moteur d'ODF : l'annulation reprend exactement les effets de
-- cancel_production_order (0082) ; la fonction existante n'est pas modifiée.
-- ============================================================================

alter table quotes
  add column if not exists annule_le timestamptz,
  add column if not exists annule_par uuid references app_users(id),
  add column if not exists annule_motif text;

comment on column quotes.annule_motif is
  'Motif de l''annulation du devis (0174) ; l''ODF né du devis est annulé avec lui.';

-- ----------------------------------------------------------------------------
-- 1. DROIT : module « annulation_devis »
-- ----------------------------------------------------------------------------

insert into modules (key, label, description, display_order) values
  ('annulation_devis', 'Annulation de devis',
   'Annule un devis, même accepté, et l''ODF qui en est né — motif obligatoire', 168)
on conflict (key) do nothing;

do $$
declare
  v_mod uuid := (select id from modules where key = 'annulation_devis');
  v_role record;
begin
  for v_role in select id, key from roles loop
    insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
    values (
      v_role.id, v_mod,
      v_role.key in ('administrateur', 'direction'),
      false, false, false, false,
      v_role.key in ('administrateur', 'direction'),
      false
    )
    on conflict (role_id, module_id) do nothing;
  end loop;
end $$;

create or replace function peut_annuler_devis()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_admin() or has_permission('annulation_devis', 'validate');
$$;

revoke all on function peut_annuler_devis() from public, anon, authenticated;
grant execute on function peut_annuler_devis() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. GARDE-FOU DES STATUTS DE DEVIS (reprise de 0063)
-- ----------------------------------------------------------------------------
-- Ajouts : « annulé » n'est atteint que par annuler_devis() (drapeau de
-- transaction), et un devis annulé ne change plus de statut.

create or replace function guard_quote_validation()
returns trigger
language plpgsql
as $$
begin
  -- Pas de session utilisateur (migration, service_role, seed) : non soumis.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('brouillon', 'en_validation_interne') then
      raise exception 'Un devis doit être validé en interne avant d''être envoyé au client.';
    end if;
    new.validated_by := null;
    new.validated_at := null;
    return new;
  end if;

  -- UPDATE : validated_* ne se modifient que par la transition de validation.
  new.validated_by := old.validated_by;
  new.validated_at := old.validated_at;

  if new.status is distinct from old.status then
    if old.status = 'annule' then
      raise exception 'Un devis annulé ne change plus de statut.';
    end if;
    if new.status = 'annule' then
      if coalesce(current_setting('seritex.annulation_devis', true), '') <> 'on' then
        raise exception 'Un devis s''annule par l''action « Annuler le devis » (motif obligatoire).';
      end if;
      return new;
    end if;
  end if;

  if new.status is distinct from old.status and old.status in ('brouillon', 'en_validation_interne') then
    if new.status = 'envoye' then
      if not is_quote_validator() then
        raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent valider un devis.';
      end if;
      new.validated_by := auth.uid();
      new.validated_at := now();
    elsif old.status = 'en_validation_interne' and new.status = 'brouillon' then
      if not is_quote_validator() then
        raise exception 'Seules les personnes habilitées (signature enregistrée) peuvent renvoyer un devis.';
      end if;
    elsif new.status <> 'en_validation_interne' then
      raise exception 'Un devis non validé ne peut pas changer de statut (% → %).', old.status, new.status;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. APERÇU AVANT CONFIRMATION
-- ----------------------------------------------------------------------------
-- Les ODF nés du devis et ce qu'ils deviennent ; pièces déjà en stock tampon
-- (paquets en cours) qui resteront à réattribuer.

create or replace function annulation_devis_apercu(p_quote_id uuid)
returns table (production_order_id uuid, reference text, statut text, paquets int, pieces int, annulable boolean)
language sql
stable
security definer
set search_path = public
as $$
  select po.id, po.reference, po.status::text,
         (select count(*)::int from article_lots al
          where al.production_order_id = po.id and al.semi_fini_id is not null and al.statut = 'en_cours'),
         (select coalesce(sum(kv.value::numeric), 0)::int from article_lots al
          cross join lateral jsonb_each_text(al.composition_taille) kv
          where al.production_order_id = po.id and al.semi_fini_id is not null and al.statut = 'en_cours'),
         po.status <> 'terminee'
  from production_orders po
  where peut_annuler_devis() and po.quote_id = p_quote_id and po.status <> 'annulee'
  order by po.created_at;
$$;

revoke all on function annulation_devis_apercu(uuid) from public, anon, authenticated;
grant execute on function annulation_devis_apercu(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. ANNULER LE DEVIS (et ses ODF)
-- ----------------------------------------------------------------------------

create or replace function annuler_devis(p_quote_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_po production_orders;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
  v_note text;
  v_odf text[] := '{}';
  v_request_status request_status;
  v_rouverte boolean := false;
begin
  if not peut_annuler_devis() then
    raise exception 'accès refusé : l''annulation d''un devis est réservée à l''administrateur et à la Direction';
  end if;
  if v_motif is null then
    raise exception 'le motif de l''annulation est obligatoire';
  end if;
  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'devis introuvable';
  end if;
  if v_quote.status = 'annule' then
    raise exception 'le devis % est déjà annulé', v_quote.reference;
  end if;

  select * into v_po from production_orders
  where quote_id = p_quote_id and status = 'terminee'
  order by created_at limit 1;
  if found then
    raise exception 'l''ODF % est terminé : le devis % ne peut plus être annulé (la marchandise est produite — passez par un retour ou un avoir)',
      v_po.reference, v_quote.reference;
  end if;

  -- Devis : seul passage autorisé vers « annulé » (garde-fou ci-dessus).
  perform set_config('seritex.annulation_devis', 'on', true);
  update quotes
  set status = 'annule',
      annule_le = now(),
      annule_par = auth.uid(),
      annule_motif = v_motif,
      modification_ouverte_le = null,
      modification_ouverte_par = null,
      modification_motif = null
  where id = p_quote_id;
  perform set_config('seritex.annulation_devis', 'off', true);

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('quote', p_quote_id, v_quote.status::text, 'annule', auth.uid());

  -- ODF nés du devis : mêmes effets que cancel_production_order (0082).
  v_note := format('Annulé avec le devis %s : %s', v_quote.reference, v_motif);
  for v_po in
    select * from production_orders
    where quote_id = p_quote_id and status not in ('terminee', 'annulee')
    order by created_at
    for update
  loop
    update production_orders
    set status = 'annulee', closed_at = now(), closed_by = auth.uid(), cloture_note = v_note
    where id = v_po.id;

    update stock_reservations r set statut = 'liberee'
    from production_order_lines l
    where l.id = r.production_order_line_id and l.production_order_id = v_po.id and r.statut = 'reservee';

    insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
    values ('production_order', v_po.id, v_po.status::text, 'annulee', auth.uid());
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'cancel_production_order', 'production_order', v_po.id,
            jsonb_build_object('reason', v_note, 'quote_id', p_quote_id));
    v_odf := v_odf || v_po.reference;
  end loop;

  -- Demande rouverte, sauf si un autre devis y est encore en cours.
  if v_quote.request_id is not null and not exists (
    select 1 from quotes q
    where q.request_id = v_quote.request_id and q.id <> p_quote_id
      and q.status not in ('annule', 'refuse', 'expire')
  ) then
    select status into v_request_status from requests where id = v_quote.request_id for update;
    if v_request_status is distinct from 'en_analyse' then
      update requests set status = 'en_analyse' where id = v_quote.request_id;
      insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
      values ('request', v_quote.request_id, v_request_status::text, 'en_analyse', auth.uid());
    end if;
    v_rouverte := true;
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'annuler_devis', 'quote', p_quote_id,
          jsonb_build_object('motif', v_motif, 'statut_avant', v_quote.status, 'odf', to_jsonb(v_odf), 'demande_rouverte', v_rouverte));

  return jsonb_build_object('odf', to_jsonb(v_odf), 'demande_rouverte', v_rouverte);
end;
$$;

revoke all on function annuler_devis(uuid, text) from public, anon, authenticated;
grant execute on function annuler_devis(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. STOCK TAMPON : les pièces des ODF annulés restent visibles
-- ----------------------------------------------------------------------------
-- Reprises de 0153 : mêmes calculs ; les ODF annulés ne sont plus écartés,
-- ils sont signalés (odf_annule) pour être réattribués. Seuls les ODF
-- terminés sortent du stock tampon.

drop function if exists stock_tampon_semi_fini(uuid);
create function stock_tampon_semi_fini(p_semi_fini_id uuid)
returns table (production_order_id uuid, odf text, line_id uuid, article text, taille text, coupees int, assemblees int, en_attente int, odf_annule boolean)
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
         greatest(l.coupees - a.assemblees, 0), po.status = 'annulee'
  from lignes l
  join production_order_lines pol on pol.id = l.line_id
  join production_orders po on po.id = pol.production_order_id
  cross join lateral (
    select case when ligne_coupee_par_pieces(l.line_id) then pieces_assemblees(l.line_id, p_semi_fini_id, l.taille)
                else l.coupees end as assemblees
  ) a
  where is_staff() and po.status <> 'terminee'
  order by po.status = 'annulee' desc, po.reference, pol.created_at, l.taille;
$$;

drop function if exists paquets_semi_fini(uuid);
create function paquets_semi_fini(p_semi_fini_id uuid)
returns table (lot_id uuid, code text, production_order_id uuid, odf text, line_id uuid, article text,
               composition_taille jsonb, detenteur text, en_transit boolean, verrouille boolean, odf_annule boolean)
language sql
stable
security definer
set search_path = public
as $$
  select al.id, al.code, po.id, po.reference, al.production_order_line_id, pol.description,
         al.composition_taille, s.name, d.en_transit, al.verrouille_le is not null, po.status = 'annulee'
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  cross join lateral lot_detenteur(al.id) d
  left join sections s on s.id = d.section_id
  where is_staff() and al.semi_fini_id = p_semi_fini_id and al.statut = 'en_cours'
    and po.status <> 'terminee'
  order by po.status = 'annulee' desc, po.reference, al.code;
$$;

-- Paquets en cours d'un ODF (fiche d'un ODF annulé : pièces à réattribuer).
create or replace function paquets_odf(p_production_order_id uuid)
returns table (lot_id uuid, code text, semi_fini_id uuid, semi_fini text, odf text, line_id uuid, article text,
               composition_taille jsonb, detenteur text, en_transit boolean, verrouille boolean)
language sql
stable
security definer
set search_path = public
as $$
  select al.id, al.code, al.semi_fini_id, sf.name, po.reference, al.production_order_line_id, pol.description,
         al.composition_taille, s.name, d.en_transit, al.verrouille_le is not null
  from article_lots al
  join production_orders po on po.id = al.production_order_id
  join product_models sf on sf.id = al.semi_fini_id
  left join production_order_lines pol on pol.id = al.production_order_line_id
  cross join lateral lot_detenteur(al.id) d
  left join sections s on s.id = d.section_id
  where is_staff() and al.production_order_id = p_production_order_id and al.statut = 'en_cours'
  order by sf.name, al.code;
$$;

revoke all on function stock_tampon_semi_fini(uuid) from public, anon, authenticated;
revoke all on function paquets_semi_fini(uuid) from public, anon, authenticated;
revoke all on function paquets_odf(uuid) from public, anon, authenticated;
grant execute on function stock_tampon_semi_fini(uuid) to authenticated;
grant execute on function paquets_semi_fini(uuid) to authenticated;
grant execute on function paquets_odf(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. COUPE : un matelas regroupé se clôture même si l'ODF d'un article est
--    annulé
-- ----------------------------------------------------------------------------
-- Sans cela, le matelas qui contient l'article d'un ODF annulé ne pourrait
-- plus être clôturé et bloquerait la coupe des autres ODF. Reprise de 0155 à
-- l'identique, deux ajouts : le statut « annulee » est admis pour un article,
-- et ses pièces ne sont pas assemblées en t-shirts (elles restent en stock
-- tampon, à réorienter).

create or replace function cloturer_matelas_regroupe(
  p_trace_id uuid,
  p_lignes jsonb,            -- [{ "line_id": uuid, "couches_reelles": int, "obtenus": { "<semi_fini_id>": { "<taille>": int } } }]
  p_longueur_cm numeric,
  p_laize_cm numeric,
  p_poids_tissu_kg numeric,
  p_dechets_kg numeric,
  p_justification text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trace traces_placement;
  v_fiche fiches_placement;
  v_cloture uuid;
  v_l jsonb;
  v_line production_order_lines;
  v_status production_order_status;
  v_prevues int;
  v_reelles int;
  v_total_couches int := 0;
  v_p record;
  v_obtenu int;
  v_manque boolean := false;
  v_kits jsonb := '{}'::jsonb;
  v_justif text := nullif(btrim(coalesce(p_justification, '')), '');
  v_incomplete record;
begin
  if not peut_couper() then
    raise exception 'accès refusé : la clôture d''un matelas est réservée à la Coupe et aux responsables';
  end if;
  select * into v_trace from traces_placement where id = p_trace_id for update;
  if not found then
    raise exception 'tracé introuvable';
  end if;
  select * into v_fiche from fiches_placement where id = v_trace.fiche_id;
  if not v_fiche.regroupee then
    raise exception 'ce tracé n''est pas un matelas regroupé : il se clôture par la clôture habituelle';
  end if;
  if v_trace.statut in ('annule', 'previsionnel', 'termine') then
    raise exception 'ce matelas ne peut pas être clôturé (statut : %)', v_trace.statut;
  end if;
  if coalesce(p_longueur_cm, 0) <= 0 or coalesce(p_laize_cm, 0) <= 0 or coalesce(p_poids_tissu_kg, 0) <= 0 or p_dechets_kg is null or p_dechets_kg < 0 then
    raise exception 'longueur, laize, poids du tissu et déchets du matelas sont obligatoires';
  end if;
  if jsonb_array_length(coalesce(p_lignes, '[]'::jsonb)) = 0 then
    raise exception 'indiquez les pièces obtenues pour chaque article du matelas';
  end if;
  if not exists (select 1 from trace_semi_finis where trace_id = p_trace_id) then
    raise exception 'ce matelas n''a aucune pièce déclarée';
  end if;
  select * into v_incomplete from trace_lignes_incompletes(p_trace_id) limit 1;
  if v_incomplete.line_id is not null then
    raise exception 'l''article « % » n''a pas dans sa nomenclature : %', v_incomplete.article, v_incomplete.manquants;
  end if;

  -- Contrôles par article : couches réelles, et pour chaque semi-fini et
  -- chaque taille, pièces jamais au-dessus du prévu.
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    select * into v_line from production_order_lines where id = (v_l ->> 'line_id')::uuid;
    select nb_couches into v_prevues from trace_couches
    where trace_id = p_trace_id and production_order_line_id = v_line.id;
    if v_prevues is null then
      raise exception 'l''article « % » n''a pas de couches dans ce matelas', coalesce(v_line.description, '?');
    end if;
    select status into v_status from production_orders where id = v_line.production_order_id;
    -- 0174 : l'article d'un ODF annulé se clôture aussi ; ses pièces restent
    -- en stock tampon (paquets) pour être réorientées.
    if v_status not in ('en_production', 'annulee') then
      raise exception 'l''ODF de l''article « % » n''est pas en production (statut : %)', v_line.description, v_status;
    end if;
    v_reelles := (v_l ->> 'couches_reelles')::int;
    if v_reelles is null or v_reelles <= 0 or v_reelles > v_prevues then
      raise exception 'article « % » : couches réelles entre 1 et % (jamais au-dessus du tracé)', v_line.description, v_prevues;
    end if;
    if v_reelles < v_prevues then
      v_manque := true;
    end if;
    v_total_couches := v_total_couches + v_reelles;
    for v_p in
      select tsf.semi_fini_id, tsf.taille, tsf.quantite_par_couche, pm.name as sf_nom
      from trace_semi_finis tsf join product_models pm on pm.id = tsf.semi_fini_id
      where tsf.trace_id = p_trace_id
    loop
      v_obtenu := coalesce((v_l -> 'obtenus' -> (v_p.semi_fini_id::text) ->> v_p.taille)::int, 0);
      if v_obtenu < 0 or v_obtenu > v_p.quantite_par_couche * v_reelles then
        raise exception 'article « % », % % : % pièces obtenues pour au plus % (% × % couches)',
          v_line.description, v_p.sf_nom, v_p.taille, v_obtenu, v_p.quantite_par_couche * v_reelles, v_p.quantite_par_couche, v_reelles;
      end if;
      if v_obtenu < v_p.quantite_par_couche * v_prevues then
        v_manque := true;
      end if;
    end loop;
  end loop;
  if exists (select 1 from trace_couches tc where tc.trace_id = p_trace_id
             and not exists (select 1 from jsonb_array_elements(p_lignes) x where (x ->> 'line_id')::uuid = tc.production_order_line_id)) then
    raise exception 'indiquez les pièces obtenues pour chacun des articles du matelas';
  end if;
  if v_manque and v_justif is null then
    raise exception 'justification obligatoire : des pièces ou des couches manquent par rapport au tracé (aucune tolérance)';
  end if;

  insert into clotures_matelas_pieces (trace_id, cloture_par, longueur_reelle_cm, laize_reelle_cm, poids_tissu_kg, dechets_kg, justification)
  values (p_trace_id, auth.uid(), p_longueur_cm, p_laize_cm, p_poids_tissu_kg, p_dechets_kg, v_justif)
  returning id into v_cloture;

  for v_l in select * from jsonb_array_elements(p_lignes) loop
    select * into v_line from production_order_lines where id = (v_l ->> 'line_id')::uuid;
    v_reelles := (v_l ->> 'couches_reelles')::int;
    insert into clotures_matelas_pieces_lignes (cloture_id, production_order_line_id, couches_reelles, poids_tissu_kg, dechets_kg)
    values (v_cloture, v_line.id, v_reelles,
            round(p_poids_tissu_kg * v_reelles / v_total_couches, 3),
            round(p_dechets_kg * v_reelles / v_total_couches, 3));
    insert into pieces_coupees (cloture_pieces_id, trace_id, production_order_id, production_order_line_id,
                                source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
    select v_cloture, p_trace_id, v_line.production_order_id, v_line.id,
           'trace', 'semi_fini', tsf.semi_fini_id, pm.name, tsf.taille, tsf.quantite_par_couche, v_reelles,
           coalesce((v_l -> 'obtenus' -> (tsf.semi_fini_id::text) ->> tsf.taille)::int, 0)
    from trace_semi_finis tsf join product_models pm on pm.id = tsf.semi_fini_id
    where tsf.trace_id = p_trace_id;
  end loop;

  update traces_placement
  set statut = 'termine', termine_le = now(), demarre_le = coalesce(demarre_le, now())
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cloturer_matelas_regroupe', 'trace_placement', p_trace_id,
          jsonb_build_object('lignes', p_lignes, 'poids_tissu_kg', p_poids_tissu_kg, 'dechets_kg', p_dechets_kg,
                             'manque', v_manque, 'justification', v_justif));

  -- Assemblage en t-shirts complets et écarts de coupe, article par article.
  -- ODF annulé : pas d'assemblage, les pièces restent à réorienter (0174).
  for v_l in select * from jsonb_array_elements(p_lignes) loop
    if (select po.status from production_order_lines l join production_orders po on po.id = l.production_order_id
        where l.id = (v_l ->> 'line_id')::uuid) = 'annulee' then
      continue;
    end if;
    v_kits := v_kits || jsonb_build_object(v_l ->> 'line_id', kits_coupes_actualiser((v_l ->> 'line_id')::uuid));
    begin
      perform ecart_coupe_actualiser((v_l ->> 'line_id')::uuid, true);
    exception when others then
      raise warning 'écart de coupe non calculé : %', sqlerrm;
    end;
  end loop;
  return jsonb_build_object('cloture_id', v_cloture, 'kits_assembles', v_kits);
end;
$$;

