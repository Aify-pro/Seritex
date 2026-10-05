-- ============================================================================
-- 0091 — Surplus de production (retour de recette C2)
-- ============================================================================
--
-- Les ateliers produisent parfois plus que ce qu'ils ont reçu (défaut sur le
-- tissu, demande spéciale). Jusqu'ici la base refusait toute déclaration
-- au-delà de l'entrée. Désormais :
--   - type de déclaration « surplus » : pièces ajoutées à ce que la section
--     a reçu, toujours avec un motif ;
--   - declare_production() : une déclaration de bonnes ou de 1er/2e choix
--     au-delà du reste passe si un motif est donné ; l'excédent est
--     enregistré en surplus de la section, puis suit le circuit (étapes
--     suivantes, finition, stock ou expédition) ;
--   - sans motif, le refus reste, avec un message qui l'explique ;
--   - le bilan par taille (production_order_balance) montre le surplus.
-- Signatures inchangées.
-- ============================================================================

alter table production_declarations drop constraint if exists production_declarations_type_valide;
alter table production_declarations add constraint production_declarations_type_valide
  check (type in ('bonne', 'dechet', 'premier_choix', 'deuxieme_choix', 'preleve', 'surplus'));

create or replace function line_stage_flow_detail(p_line_id uuid)
returns table (
  etape int,
  mode text,
  work_order_id uuid,
  section_id uuid,
  categorie text,
  taille text,
  entree_etape int,
  recu int,
  bonnes int,
  dechets int,
  premier_choix int,
  deuxieme_choix int,
  preleve int,
  coupe_produit int,
  reste int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tailles text[];
  v_rep jsonb;
  v_sums jsonb;
  v_coupe jsonb;
  v_prev jsonb := '{}'::jsonb;
  v_next jsonb;
  v_has_wo boolean;
  v_etape int;
  v_first boolean := true;
  v_mode text;
  v_units jsonb;
  v_unit jsonb;
  v_t text;
  v_e int;
  v_sum_b int;
  v_sum_d int;
  v_min_b int;
  v_max_d int;
  v_has_coupe boolean;
  v_has_stock boolean;
  v_sum_produit int;
  v_sum_preleve int;
  v_b int;
  v_d int;
  v_p1 int;
  v_p2 int;
  v_pr int;
  v_produit int;
  v_wo text;
  v_cat text;
  v_s int;
  v_sum_s int;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;

  select coalesce(jsonb_object_agg(pos.taille, pos.quantite_demandee), '{}'::jsonb)
    into v_rep
  from production_order_sizes pos where pos.production_order_line_id = p_line_id;

  select exists (select 1 from work_orders w where w.production_order_line_id = p_line_id) into v_has_wo;

  -- Sommes déclarées, par « sous-ODF|taille|type ».
  select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into v_sums
  from (
    select pd.work_order_id::text || '|' || pd.taille || '|' || pd.type as k, sum(pd.quantite)::int as s
    from production_declarations pd
    where pd.production_order_line_id = p_line_id
    group by 1
  ) x;

  -- Pièces des matelas clôturés, par « sous-ODF|taille ».
  select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into v_coupe
  from (
    select ev.work_order_id::text || '|' || kv.key as k, sum(kv.value::numeric)::int as s
    from work_order_events ev
    join work_orders w on w.id = ev.work_order_id
    cross join lateral jsonb_each_text(coalesce(ev.quantites_obtenues, '{}'::jsonb)) kv
    where w.production_order_line_id = p_line_id and ev.event_type = 'matelas_cloture'
    group by 1
  ) x;

  -- Tailles : la répartition de la ligne, plus toute taille déjà déclarée ou coupée.
  select array_agg(t.cle order by coalesce(sz.groupe, ''), coalesce(sz.display_order, 0), t.cle) into v_tailles
  from (
    select pos.taille as cle from production_order_sizes pos where pos.production_order_line_id = p_line_id
    union
    select pd.taille from production_declarations pd where pd.production_order_line_id = p_line_id
    union
    select split_part(k, '|', 2) from jsonb_object_keys(v_coupe) k
  ) t
  left join sizes sz on sz.cle = t.cle;

  if v_tailles is null then
    return;
  end if;

  for v_etape in
    select distinct u.etape
    from (
      select coalesce(w.etape, pls.etape, pls.ordre) as etape
      from work_orders w
      left join production_order_line_sections pls
        on pls.production_order_line_id = w.production_order_line_id and pls.section_id = w.section_id
      where v_has_wo and w.production_order_line_id = p_line_id
      union
      select pls.etape
      from production_order_line_sections pls
      where not v_has_wo and pls.production_order_line_id = p_line_id
    ) u
    order by u.etape
  loop
    -- Sections (sous-ODF) de l'étape.
    if v_has_wo then
      select coalesce(jsonb_agg(jsonb_build_object(
               'wo', w.id, 'section', w.section_id, 'cat', section_categorie_cle(w.section_id),
               'partie', pls.partie) order by pls.ordre, w.reference), '[]'::jsonb)
        into v_units
      from work_orders w
      left join production_order_line_sections pls
        on pls.production_order_line_id = w.production_order_line_id and pls.section_id = w.section_id
      where w.production_order_line_id = p_line_id
        and coalesce(w.etape, pls.etape, pls.ordre) = v_etape;
    else
      select coalesce(jsonb_agg(jsonb_build_object(
               'wo', null, 'section', pls.section_id, 'cat', section_categorie_cle(pls.section_id),
               'partie', pls.partie) order by pls.ordre), '[]'::jsonb)
        into v_units
      from production_order_line_sections pls
      where pls.production_order_line_id = p_line_id and pls.etape = v_etape;
    end if;

    v_mode := case
      when jsonb_array_length(v_units) > 1
           and exists (select 1 from jsonb_array_elements(v_units) u where u ->> 'partie' is not null)
        then 'partie'
      else 'quantite'
    end;
    v_has_coupe := exists (select 1 from jsonb_array_elements(v_units) u where u ->> 'cat' = 'coupe');
    v_has_stock := exists (select 1 from jsonb_array_elements(v_units) u where u ->> 'cat' = 'stock');
    v_next := '{}'::jsonb;

    foreach v_t in array v_tailles loop
      -- Sommes de l'étape pour cette taille.
      v_sum_b := 0; v_sum_d := 0; v_min_b := null; v_max_d := null;
      v_sum_produit := 0; v_sum_preleve := 0; v_sum_s := 0;
      for v_unit in select * from jsonb_array_elements(v_units) loop
        v_wo := coalesce(v_unit ->> 'wo', '');
        v_cat := v_unit ->> 'cat';
        v_d := coalesce((v_sums ->> (v_wo || '|' || v_t || '|dechet'))::int, 0);
        v_p1 := coalesce((v_sums ->> (v_wo || '|' || v_t || '|premier_choix'))::int, 0);
        v_p2 := coalesce((v_sums ->> (v_wo || '|' || v_t || '|deuxieme_choix'))::int, 0);
        v_pr := coalesce((v_sums ->> (v_wo || '|' || v_t || '|preleve'))::int, 0);
        v_produit := coalesce((v_coupe ->> (v_wo || '|' || v_t))::int, 0);
        v_b := case v_cat
                 when 'coupe' then v_produit - v_d
                 when 'stock' then v_pr
                 when 'finition' then v_p1 + v_p2
                 else coalesce((v_sums ->> (v_wo || '|' || v_t || '|bonne'))::int, 0)
               end;
        v_sum_b := v_sum_b + v_b;
        v_sum_d := v_sum_d + v_d;
        v_min_b := least(coalesce(v_min_b, v_b), v_b);
        v_max_d := greatest(coalesce(v_max_d, v_d), v_d);
        v_sum_produit := v_sum_produit + v_produit;
        v_sum_preleve := v_sum_preleve + v_pr;
        v_sum_s := v_sum_s + coalesce((v_sums ->> (v_wo || '|' || v_t || '|surplus'))::int, 0);
      end loop;

      if v_first then
        v_e := coalesce((v_rep ->> v_t)::int, 0);
        if v_has_coupe then
          v_e := greatest(v_e, v_sum_produit);
        elsif v_has_stock then
          v_e := greatest(v_e, v_sum_preleve);
        end if;
      else
        v_e := coalesce((v_prev ->> v_t)::int, 0);
      end if;

      -- Une ligne par section de l'étape.
      for v_unit in select * from jsonb_array_elements(v_units) loop
        v_wo := coalesce(v_unit ->> 'wo', '');
        v_cat := v_unit ->> 'cat';
        v_d := coalesce((v_sums ->> (v_wo || '|' || v_t || '|dechet'))::int, 0);
        v_p1 := coalesce((v_sums ->> (v_wo || '|' || v_t || '|premier_choix'))::int, 0);
        v_p2 := coalesce((v_sums ->> (v_wo || '|' || v_t || '|deuxieme_choix'))::int, 0);
        v_pr := coalesce((v_sums ->> (v_wo || '|' || v_t || '|preleve'))::int, 0);
        v_produit := coalesce((v_coupe ->> (v_wo || '|' || v_t))::int, 0);
        v_b := case v_cat
                 when 'coupe' then v_produit - v_d
                 when 'stock' then v_pr
                 when 'finition' then v_p1 + v_p2
                 else coalesce((v_sums ->> (v_wo || '|' || v_t || '|bonne'))::int, 0)
               end;

        -- Surplus (pièces produites en plus, déclarées avec motif) : il
        -- s'ajoute à ce que la section a reçu.
        v_s := coalesce((v_sums ->> (v_wo || '|' || v_t || '|surplus'))::int, 0);
        etape := v_etape;
        mode := v_mode;
        work_order_id := nullif(v_wo, '')::uuid;
        section_id := (v_unit ->> 'section')::uuid;
        categorie := v_cat;
        taille := v_t;
        entree_etape := case when v_mode = 'partie' then v_e + v_s else v_e + v_sum_s end;
        recu := case when v_mode = 'partie' then v_e + v_s else v_e + v_sum_s - (v_sum_b + v_sum_d - v_b - v_d) end;
        bonnes := v_b;
        dechets := v_d;
        premier_choix := v_p1;
        deuxieme_choix := v_p2;
        preleve := v_pr;
        coupe_produit := v_produit;
        reste := recu - v_b - v_d;
        return next;
      end loop;

      -- Sortie de l'étape vers la suivante.
      v_next := v_next || jsonb_build_object(
        v_t, case when v_mode = 'partie' then coalesce(v_min_b, 0) else v_sum_b end
      );
    end loop;

    v_prev := v_next;
    v_first := false;
  end loop;
end;
$$;


create or replace function declare_production(
  p_work_order_id uuid,
  p_taille text,
  p_type text,
  p_quantite int,
  p_motif text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_cat text;
  v_po_status production_order_status;
  v_reste int;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  v_cat := section_categorie_cle(v_wo.section_id);

  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)
          or (v_role = 'gestionnaire_stock' and v_cat = 'stock')) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status is distinct from 'en_production' then
    raise exception 'déclaration impossible : l''ordre de fabrication n''est pas en production (statut : %)', v_po_status;
  end if;

  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité déclarée doit être un entier positif';
  end if;
  if not exists (select 1 from sizes where cle = p_taille) then
    raise exception 'taille inconnue du référentiel : %', p_taille;
  end if;

  -- Types autorisés selon la catégorie (D7 : seule la finition fait du 2e choix).
  if not (
    (v_cat = 'coupe' and p_type = 'dechet')
    or (v_cat = 'stock' and p_type = 'preleve')
    or (v_cat = 'finition' and p_type in ('premier_choix', 'deuxieme_choix', 'dechet'))
    or (v_cat is distinct from 'coupe' and v_cat is distinct from 'stock' and v_cat is distinct from 'finition'
        and p_type in ('bonne', 'dechet'))
  ) then
    raise exception 'type de déclaration « % » impossible pour une section de catégorie %', p_type, coalesce(v_cat, 'sans catégorie');
  end if;

  -- Verrou : deux chefs d'équipe qui déclarent en même temps sur le même
  -- article ne peuvent pas dépasser l'entrée à eux deux.
  perform 1 from production_order_lines where id = v_wo.production_order_line_id for update;

  -- Surplus (retour de recette) : un atelier peut produire plus que reçu
  -- (défaut de tissu, demande spéciale). Avec un motif, l'excédent est
  -- déclaré en surplus de la section, puis la déclaration passe.
  if p_type in ('bonne', 'premier_choix', 'deuxieme_choix') then
    select reste into v_reste from work_order_flow(p_work_order_id) where taille = p_taille;
    if p_quantite > greatest(coalesce(v_reste, 0), 0) then
      if p_motif is null or btrim(p_motif) = '' then
        raise exception 'taille % : % pièce(s) de plus que ce qui reste à traiter (%) — indiquez un motif pour déclarer un surplus',
          split_part(p_taille, '/', 2), p_quantite - greatest(coalesce(v_reste, 0), 0), greatest(coalesce(v_reste, 0), 0);
      end if;
      insert into production_declarations (work_order_id, production_order_line_id, taille, type, quantite, motif, created_by)
      values (p_work_order_id, v_wo.production_order_line_id, p_taille, 'surplus',
              p_quantite - greatest(coalesce(v_reste, 0), 0), btrim(p_motif), auth.uid());
    end if;
  end if;

  -- Prélèvement au-delà de la répartition (complément) : motif exigé.
  if p_type = 'preleve' then
    select reste into v_reste from work_order_flow(p_work_order_id) where taille = p_taille;
    if p_quantite > greatest(coalesce(v_reste, 0), 0) and (p_motif is null or btrim(p_motif) = '') then
      raise exception 'prélèvement complémentaire (au-delà de la quantité à prélever) : un motif est obligatoire';
    end if;
  end if;

  insert into production_declarations (work_order_id, production_order_line_id, taille, type, quantite, motif, created_by)
  values (p_work_order_id, v_wo.production_order_line_id, p_taille, p_type, p_quantite, nullif(btrim(coalesce(p_motif, '')), ''), auth.uid())
  returning id into v_id;

  perform assert_line_flow(v_wo.production_order_line_id);

  -- Compatibilité : les compteurs historiques du sous-ODF suivent les déclarations.
  update work_orders
  set quantity_done = quantity_done + case when p_type in ('bonne', 'premier_choix', 'deuxieme_choix', 'preleve') then p_quantite else 0 end,
      quantity_rejected = quantity_rejected + case when p_type = 'dechet' then p_quantite else 0 end,
      actual_start = coalesce(actual_start, now()),
      actual_end = case
        when quantity_done + case when p_type in ('bonne', 'premier_choix', 'deuxieme_choix', 'preleve') then p_quantite else 0 end
             >= quantity_planned then coalesce(actual_end, now())
        else null end
  where id = p_work_order_id;

  perform on_production_declared(v_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'declare_production', 'work_order', p_work_order_id,
          jsonb_build_object('declaration_id', v_id, 'taille', p_taille, 'type', p_type,
                             'quantite', p_quantite, 'motif', p_motif));

  return v_id;
end;
$$;


create or replace function production_order_balance(p_production_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_line production_order_lines;
  v_lines jsonb := '[]'::jsonb;
  v_tailles jsonb;
  v_en_cours int := 0;
  v_line_en_cours int;
begin
  if not is_staff() then
    raise exception 'accès refusé';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id order by created_at
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'taille', t.taille,
             'demande', t.demande,
             'premier_choix', t.premier_choix,
             'deuxieme_choix', t.deuxieme_choix,
             'dechets', t.dechets,
             'en_cours', t.en_cours,
             'surplus', t.surplus) order by t.ord), '[]'::jsonb),
           coalesce(sum(t.en_cours), 0)::int
      into v_tailles, v_line_en_cours
    from (
      select f.taille,
             min(sz.display_order) as ord,
             coalesce((select quantite_demandee from production_order_sizes pos
                       where pos.production_order_line_id = v_line.id and pos.taille = f.taille), 0) as demande,
             sum(f.premier_choix)::int as premier_choix,
             sum(f.deuxieme_choix)::int as deuxieme_choix,
             sum(f.dechets)::int as dechets,
             sum(f.en_cours)::int as en_cours,
             coalesce((select sum(pd.quantite) from production_declarations pd
                       where pd.production_order_line_id = v_line.id and pd.taille = f.taille and pd.type = 'surplus'), 0)::int as surplus
      from line_stage_flow(v_line.id) f
      left join sizes sz on sz.cle = f.taille
      group by f.taille
    ) t;

    v_en_cours := v_en_cours + v_line_en_cours;
    v_lines := v_lines || jsonb_build_object(
      'line_id', v_line.id,
      'description', v_line.description,
      'quantite', v_line.quantity,
      'en_cours', v_line_en_cours,
      'tailles', v_tailles
    );
  end loop;

  return jsonb_build_object('en_cours', v_en_cours, 'lignes', v_lines, 'calcule_le', now());
end;
$$;

