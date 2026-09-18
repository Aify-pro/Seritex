-- ============================================================================
-- Seritex — Quantité de pièces par section retenue sur un article d'ODF
-- ============================================================================
-- Demande Ayman, 18/09 : quand plusieurs ateliers d'une même catégorie
-- (ex. deux sections Couture) sont retenus sur un même article, le travail
-- est partagé entre eux — chaque atelier ne fait qu'une partie des pièces.
-- Jusqu'ici, rien ne le disait : chaque sous-ODF recevait la quantité
-- totale de l'article (validate_production_order() : quantity_planned =
-- production_order_lines.quantity), soit deux fois trop de pièces planifiées.
--
-- 1. production_order_line_sections.quantite : nombre de pièces confiées à
--    CETTE section pour CET article. Nullable — null signifie « la quantité
--    totale de l'article », ce qui garde à l'identique toutes les lignes
--    existantes et le cas courant d'une section seule dans sa catégorie.
-- 2. validate_production_order() : le sous-ODF généré reprend cette
--    quantité (coalesce(quantite, quantité de l'article)). Seule la ligne
--    d'insertion du work_order change, le reste est recréé à l'identique de
--    0045.
--
-- Le contrôle « total des ateliers d'une même catégorie = quantité de
-- l'article » reste un AVERTISSEMENT côté application, pas un blocage de
-- validation : le chef de production peut légitimement vouloir s'en écarter.
-- ============================================================================

alter table production_order_line_sections
  add column quantite int
    constraint production_order_line_sections_quantite_positive check (quantite is null or quantite >= 0);

comment on column production_order_line_sections.quantite is
  'Pièces confiées à cette section pour cet article. Null = quantité totale de l''article (production_order_lines.quantity). Reprise comme quantity_planned du sous-ODF à la validation.';

-- ============================================================================
-- validate_production_order() — quantité planifiée par section
-- ============================================================================

create or replace function validate_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_line production_order_lines;
  v_line_section record;
  v_line_seq int := 0;
  v_seq_in_line int;
  v_seq int := 0;
  v_wo_id uuid;
  v_prev_wo_id uuid;
  v_fiche fiches_placement;
  v_size record;
  v_traced_qty numeric;
  v_surplus jsonb := '{}'::jsonb;
  v_requires_trace boolean;
  v_requires_visuel boolean;
  v_taux_defaut numeric;
  v_taux_categorie numeric;
  v_taux_effectif numeric;
  v_surplus_pct numeric;
begin
  if not has_permission('ordres_fabrication', 'validate') then
    raise exception 'accès refusé : votre rôle ne permet pas de valider un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_attente_validation' then
    raise exception 'cet ordre de fabrication n''est pas en attente de validation (statut actuel : %)', v_po.status;
  end if;

  select taux_acceptation_surplus_defaut into v_taux_defaut from fabrication_settings limit 1;
  v_taux_defaut := coalesce(v_taux_defaut, 10.00);

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id order by created_at
  loop
    v_line_seq := v_line_seq + 1;

    -- Fiche de tracé obligatoire (section 10 du document de logique),
    -- par article : dès qu'une section retenue sur CET article appartient à
    -- une catégorie marquée requiert_fiche_trace (cle='coupe' aujourd'hui).
    -- Capture au passage le taux d'acceptation propre à cette catégorie
    -- (null si elle suit le taux par défaut) — une seule ligne attendue en
    -- pratique (une seule catégorie tracée par article), limit 1 en défense.
    select ac.taux_acceptation_surplus_trace into v_taux_categorie
    from production_order_line_sections pls
    join sections s on s.id = pls.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    where pls.production_order_line_id = v_line.id and ac.requiert_fiche_trace = true
    limit 1;
    v_requires_trace := found;
    v_taux_effectif := coalesce(v_taux_categorie, v_taux_defaut);

    if v_requires_trace then
      select * into v_fiche from fiches_placement where production_order_line_id = v_line.id;
      if not found then
        raise exception 'article « % » : une section exigeant une fiche de tracé est retenue — aucune fiche Patronnage liée à cet article', v_line.description;
      end if;
      if v_fiche.statut <> 'bon_pour_coupe' then
        raise exception 'article « % » : la fiche Patronnage liée (%) n''est pas au statut "Bon pour coupe" (statut actuel : %)',
          v_line.description, v_fiche.numero_ot, v_fiche.statut;
      end if;

      -- Contrôle de quantité tracée vs demandée, taille par taille (section
      -- 11), désormais sur les tailles de CET article seul.
      for v_size in
        select taille, quantite_demandee from production_order_sizes where production_order_line_id = v_line.id
      loop
        select coalesce(sum(
                 coalesce((tp.repartition_par_couche ->> v_size.taille)::numeric, 0)
                 * coalesce(tp.nb_plis, 0)
               ), 0)
          into v_traced_qty
        from traces_placement tp
        where tp.fiche_id = v_fiche.id;

        if v_traced_qty < v_size.quantite_demandee then
          raise exception 'article « % », taille % : quantité tracée insuffisante (% tracée(s) pour % demandée(s), fiche %)',
            v_line.description, v_size.taille, v_traced_qty, v_size.quantite_demandee, v_fiche.numero_ot;
        elsif v_traced_qty > v_size.quantite_demandee then
          v_surplus := v_surplus || jsonb_build_object(
            v_line.description || ' — ' || v_size.taille, v_traced_qty - v_size.quantite_demandee
          );

          if v_size.quantite_demandee > 0 then
            v_surplus_pct := (v_traced_qty - v_size.quantite_demandee) / v_size.quantite_demandee * 100;
            if v_surplus_pct >= v_taux_effectif then
              -- Le "%" littéral est concaténé DANS l'argument (round(...)::text || '%')
              -- plutôt qu'échappé en %% dans le format : accolé à un espace réservé
              -- de substitution, "%" + "%%" est ambigu pour l'analyseur de RAISE
              -- (parcours glouton gauche→droite, "%%%" se lit [%% littéral][%
              -- substitution] et non l'inverse) — passer par le texte évite le piège.
              raise exception 'article « % », taille % : surplus tracé de % (% tracée(s) pour % demandée(s)) — dépasse le taux d''acceptation autorisé (%), fiche %',
                v_line.description, v_size.taille, round(v_surplus_pct, 2)::text || '%',
                v_traced_qty, v_size.quantite_demandee, v_taux_effectif::text || '%', v_fiche.numero_ot;
            end if;
          end if;
        end if;
      end loop;
    end if;

    -- Visuel/maquette obligatoire (migration 0036), désormais par article :
    -- toute section retenue sur CET article dont la catégorie exige un
    -- visuel (ex. Impression).
    select exists (
      select 1 from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = v_line.id and ac.requiert_visuel = true
    ) into v_requires_visuel;

    if v_requires_visuel then
      if not exists (
        select 1 from production_order_media_files pmf
        join media_files mf on mf.id = pmf.media_file_id
        where pmf.production_order_line_id = v_line.id and mf.category = 'visuel'
      ) then
        raise exception 'article « % » : une section exigeant un visuel est retenue — aucun visuel/maquette joint à cet article', v_line.description;
      end if;
    end if;

    -- Sous-ODF : un OT par section retenue SUR CET ARTICLE, dans son propre
    -- ordre — la chaîne de prédécesseurs redémarre à chaque article, deux
    -- articles ne se bloquant jamais l'un l'autre.
    v_seq_in_line := 0;
    v_prev_wo_id := null;
    for v_line_section in
      select * from production_order_line_sections
      where production_order_line_id = v_line.id
      order by ordre asc, created_at asc
    loop
      v_seq_in_line := v_seq_in_line + 1;
      v_seq := v_seq + 1;
      insert into work_orders (
        reference, production_order_id, production_order_line_id, section_id, quantity_planned, planned_start
      ) values (
        v_po.reference || '-L' || v_line_seq || '-OT' || v_seq_in_line,
        v_po.id, v_line.id, v_line_section.section_id, coalesce(v_line_section.quantite, v_line.quantity), now()
      ) returning id into v_wo_id;

      if v_prev_wo_id is not null then
        update work_orders set predecessor_work_order_id = v_prev_wo_id where id = v_wo_id;
      end if;
      v_prev_wo_id := v_wo_id;
    end loop;
  end loop;

  if v_seq = 0 then
    raise exception 'aucune section retenue sur cet ordre de fabrication';
  end if;

  update production_orders
  set status = 'en_production', launched_at = now(), launched_by = auth.uid(),
      mention_surplus_traces = nullif(v_surplus, '{}'::jsonb)
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq, 'surplus_traces', v_surplus));
end;
$$;

revoke all on function validate_production_order(uuid) from public, anon, authenticated;
grant execute on function validate_production_order(uuid) to authenticated;
