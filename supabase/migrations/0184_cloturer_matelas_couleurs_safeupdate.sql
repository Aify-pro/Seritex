-- ============================================================================
-- 0184 — Clôture du matelas par couleur : DELETE compatible pg_safeupdate
-- ============================================================================
-- 0183 a été appliquée en base dans une version antérieure au correctif :
-- cloturer_matelas_couleurs y vide sa table temporaire par « delete from
-- _prevues; », que Supabase (pg_safeupdate) refuse quand l'appel vient de
-- l'application. Le fichier 0183 contient déjà « where true », mais une
-- migration appliquée ne se rejoue pas : on redéfinit ici la fonction, à
-- l'identique de 0183 (droits inchangés, CREATE OR REPLACE les conserve).
-- ============================================================================

create or replace function cloturer_matelas_couleurs(
  p_trace_id uuid,
  p_plis jsonb,
  p_obtenus jsonb,
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
  v_justif text := nullif(btrim(coalesce(p_justification, '')), '');
  v_manque boolean := false;
  v_c record;
  v_p record;
  v_reels int;
  v_obtenu int;
  v_total_obtenu numeric;
  v_kits jsonb := '{}'::jsonb;
  v_line uuid;
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
  perform couches_vers_pieces(p_trace_id);
  if not exists (select 1 from trace_plis_couleur where trace_id = p_trace_id) then
    raise exception 'ce matelas n''a pas de plis par couleur';
  end if;
  if exists (select 1 from trace_couches_pieces where trace_id = p_trace_id and article_id is not null) then
    raise exception 'des couches de ce matelas sont sur des articles saisis sans ODF';
  end if;

  -- Plis réels par couleur : jamais au-dessus du tracé.
  for v_c in select * from trace_plis_couleur where trace_id = p_trace_id loop
    v_reels := nullif(p_plis ->> v_c.cle, '')::int;
    if v_reels is null or v_reels < 0 or v_reels > v_c.nb_plis then
      raise exception 'plis réels de « % » : entre 0 et % (jamais au-dessus du tracé)', libelle_cle_couche(v_c.cle), v_c.nb_plis;
    end if;
    if v_reels < v_c.nb_plis then
      v_manque := true;
    end if;
  end loop;

  -- ODF des articles : en production (ou annulé : les pièces vont en stock tampon).
  for v_line in select distinct production_order_line_id from trace_couches_pieces where trace_id = p_trace_id loop
    if (select po.status from production_order_lines l join production_orders po on po.id = l.production_order_id where l.id = v_line)
       not in ('en_production', 'annulee') then
      raise exception 'l''ODF de l''article « % » n''est pas en production',
        (select description from production_order_lines where id = v_line);
    end if;
  end loop;

  -- Pièces prévues par article × pièce × taille, et pièces obtenues saisies.
  create temporary table if not exists _prevues (line_id uuid, semi_fini_id uuid, taille text, qpc int, couches int, prevues int, obtenus int) on commit drop;
  delete from _prevues where true; -- Supabase (pg_safeupdate) refuse un DELETE sans WHERE
  insert into _prevues (line_id, semi_fini_id, taille, qpc, couches, prevues, obtenus)
  select c.production_order_line_id, c.semi_fini_id, tsf.taille, tsf.quantite_par_couche, c.nb, tsf.quantite_par_couche * c.nb, 0
  from (select production_order_line_id, semi_fini_id, sum(nb_couches)::int as nb
        from trace_couches_pieces where trace_id = p_trace_id group by production_order_line_id, semi_fini_id) c
  join trace_semi_finis tsf on tsf.trace_id = p_trace_id and tsf.semi_fini_id = c.semi_fini_id;

  for v_p in select * from jsonb_array_elements(coalesce(p_obtenus, '[]'::jsonb)) e(x) loop
    v_obtenu := coalesce((v_p.x ->> 'obtenus')::int, 0);
    update _prevues set obtenus = v_obtenu
    where line_id = (v_p.x ->> 'line_id')::uuid and semi_fini_id = (v_p.x ->> 'semi_fini_id')::uuid and taille = v_p.x ->> 'taille';
    if not found then
      raise exception 'pièce saisie absente du tracé pour cet article';
    end if;
  end loop;
  select * into v_p from _prevues where obtenus < 0 or obtenus > prevues limit 1;
  if found then
    raise exception 'article « % », % % : % pièces obtenues pour au plus % (jamais au-dessus du tracé)',
      (select description from production_order_lines where id = v_p.line_id), (select name from product_models where id = v_p.semi_fini_id),
      v_p.taille, v_p.obtenus, v_p.prevues;
  end if;
  if exists (select 1 from _prevues where obtenus < prevues) then
    v_manque := true;
  end if;
  if v_manque and v_justif is null then
    raise exception 'justification obligatoire : des plis ou des pièces manquent par rapport au tracé (aucune tolérance)';
  end if;

  insert into clotures_matelas_pieces (trace_id, cloture_par, longueur_reelle_cm, laize_reelle_cm, poids_tissu_kg, dechets_kg, justification)
  values (p_trace_id, auth.uid(), p_longueur_cm, p_laize_cm, p_poids_tissu_kg, p_dechets_kg, v_justif)
  returning id into v_cloture;

  update trace_plis_couleur set nb_plis_reels = nullif(p_plis ->> cle, '')::int where trace_id = p_trace_id;

  -- Part de chaque article : tissu et déchets au prorata des pièces obtenues.
  select coalesce(sum(obtenus), 0) into v_total_obtenu from _prevues;
  insert into clotures_matelas_pieces_lignes (cloture_id, production_order_line_id, couches_reelles, poids_tissu_kg, dechets_kg)
  select v_cloture, line_id, greatest(1, max(couches)),
         round(p_poids_tissu_kg * case when v_total_obtenu > 0 then sum(obtenus) / v_total_obtenu else 1.0 / count(*) over () end, 3),
         round(p_dechets_kg * case when v_total_obtenu > 0 then sum(obtenus) / v_total_obtenu else 1.0 / count(*) over () end, 3)
  from _prevues group by line_id;

  insert into pieces_coupees (cloture_pieces_id, trace_id, production_order_id, production_order_line_id,
                              source, statut, semi_fini_id, piece, taille, quantite_par_couche, couches, quantite)
  select v_cloture, p_trace_id, pol.production_order_id, pr.line_id,
         'trace', 'semi_fini', pr.semi_fini_id, pm.name, pr.taille, pr.qpc, pr.couches, pr.obtenus
  from _prevues pr
  join production_order_lines pol on pol.id = pr.line_id
  join product_models pm on pm.id = pr.semi_fini_id;

  update traces_placement
  set statut = 'termine', termine_le = now(), demarre_le = coalesce(demarre_le, now())
  where id = p_trace_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'cloturer_matelas_couleurs', 'trace_placement', p_trace_id,
          jsonb_build_object('plis', p_plis, 'obtenus', p_obtenus, 'poids_tissu_kg', p_poids_tissu_kg, 'dechets_kg', p_dechets_kg,
                             'manque', v_manque, 'justification', v_justif));

  -- Assemblage en t-shirts complets et écarts de coupe (articles d'ODF en cours).
  for v_line in select distinct pr.line_id from _prevues pr
                join production_order_lines l on l.id = pr.line_id
                join production_orders po on po.id = l.production_order_id
                where po.status <> 'annulee' loop
    v_kits := v_kits || jsonb_build_object(v_line::text, kits_coupes_actualiser(v_line));
    begin
      perform ecart_coupe_actualiser(v_line, true);
    exception when others then
      raise warning 'écart de coupe non calculé : %', sqlerrm;
    end;
  end loop;
  return jsonb_build_object('cloture_id', v_cloture, 'kits_assembles', v_kits);
end;
$$;
