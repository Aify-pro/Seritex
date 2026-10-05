-- ============================================================================
-- 0094 — Échantillon par ligne d'article + maquette/visuels dans le pipe
-- ============================================================================
-- Demande Ayman, 05/10 :
--   1. Un échantillon se fait à partir d'une LIGNE D'ARTICLE, pas d'un devis
--      entier : une même proforma peut porter plusieurs modèles. Le lien par
--      ligne existe depuis 0051 (sample_requests.quote_line_id) mais restait
--      facultatif ; il devient obligatoire à la création dès que la demande
--      porte au moins une ligne de devis. Une demande sans devis (échantillon
--      lancé avant chiffrage) reste possible sans ligne, à rattacher ensuite.
--   2. La maquette et le ou les visuels de l'article se déposent depuis la
--      fiche échantillon et doivent se retrouver sur l'article de l'ODF,
--      quelle que soit la technique d'impression : « il faut que le fichier
--      rentre au moins dans le pipe ».
--      AUCUNE nouvelle table pour ça : les fichiers vont là où ils vivent
--      déjà — quote_line_media_files (0041) pour la ligne de devis,
--      production_order_media_files.production_order_line_id (0037) pour un
--      échantillon rattaché directement à un article d'ODF. L'écran ODF
--      affiche déjà l'union des fichiers du devis et des siens, et 0069
--      permet d'affecter chaque visuel à l'atelier qui l'utilise (DTF,
--      sérigraphie…) : rien à propager, rien à dédoubler.
--      Cette migration n'apporte donc que la fonction qui dit si un article
--      exige un visuel, pour afficher l'avertissement « aucun visuel joint »
--      (non bloquant, décision du 05/10).
--   3. Correctif : depuis 0081 une demande peut être sans client (demande
--      interne / ODF stock). enforce_sample_links (0051) confondait « demande
--      introuvable » et « demande sans client », et company_id était NOT NULL
--      sur sample_requests : impossible d'échantillonner un article interne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Échantillon d'une demande interne (sans client) — cf. 0081
-- ----------------------------------------------------------------------------
-- Les policies de sample_requests (0002/0051) restent valables telles
-- quelles : `is_staff() or is_client_of(company_id)` en lecture devient
-- « staff seulement » quand company_id est null, is_commercial_or_above() en
-- écriture ne dépend pas de l'entreprise.

alter table sample_requests alter column company_id drop not null;

comment on column sample_requests.company_id is
  'Entreprise de la demande rattachée. NULL = échantillon d''une demande interne / stock (0081, 0094) : visible du staff uniquement.';

-- ----------------------------------------------------------------------------
-- 2. article_exige_visuel() — un visuel est-il attendu sur cet article ?
-- ----------------------------------------------------------------------------
-- Même notion que validate_production_order() / le circuit 0050 :
-- atelier_categories.requiert_visuel (ex. Impression). Deux niveaux de
-- lecture selon l'avancement de l'article :
--   - article d'ODF : les sections réellement retenues pour la ligne
--     (production_order_line_sections) — la vérité une fois l'ODF monté ;
--   - ligne de devis seule : le parcours type par défaut du modèle (ART-H,
--     0077), seule indication disponible avant l'ODF. Un modèle sans
--     parcours type ne dit rien : la fonction renvoie false (avertissement
--     silencieux plutôt que faux positif sur tous les articles).
-- Réponse indicative, jamais bloquante : elle n'alimente qu'un
-- avertissement d'écran, pas un garde-fou.

create or replace function article_exige_visuel(
  p_quote_line_id uuid,
  p_production_order_line_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_production_order_line_id is not null then exists (
      select 1
      from production_order_line_sections pls
      join sections s on s.id = pls.section_id
      join atelier_categories ac on ac.id = s.categorie_id
      where pls.production_order_line_id = p_production_order_line_id
        and ac.requiert_visuel = true
    )
    when p_quote_line_id is not null then exists (
      select 1
      from quote_lines ql
      join model_routes mr on mr.product_model_id = ql.product_model_id and mr.par_defaut
      join model_route_steps mrs on mrs.route_id = mr.id
      left join sections s on s.id = mrs.section_id
      left join atelier_categories ac_section on ac_section.id = s.categorie_id
      left join atelier_categories ac_step on ac_step.cle = mrs.atelier_category
      where ql.id = p_quote_line_id
        and coalesce(ac_section.requiert_visuel, ac_step.requiert_visuel, false) = true
    )
    else false
  end;
$$;

revoke all on function article_exige_visuel(uuid, uuid) from public, anon, authenticated;
grant execute on function article_exige_visuel(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. enforce_sample_links() — ligne d'article obligatoire s'il y a un devis
-- ----------------------------------------------------------------------------
-- Reprend la version 0051 à l'identique (demande de la même entreprise,
-- ligne de devis de la demande, verrou une fois l'ODF généré) et ajoute :
--   - la ligne de devis est obligatoire à la création dès que la demande
--     porte au moins une ligne de devis (un échantillon se fait par article,
--     pas pour un devis entier) ;
--   - une demande sans client est acceptée (company_id des deux côtés null),
--     et « demande introuvable » n'est plus confondu avec « sans client ».

create or replace function enforce_sample_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_quote_request_id uuid;
  v_derived_line_id uuid;
  v_old_derived_line_id uuid;
  v_line_company_id uuid;
begin
  -- 1. Demande obligatoire à la création, même entreprise que la fiche
  --    (y compris « pas d'entreprise » des deux côtés, cf. 0081).
  if TG_OP = 'INSERT' and new.request_id is null then
    raise exception 'une fiche échantillon doit être rattachée à une demande';
  end if;

  if new.request_id is not null
     and (TG_OP = 'INSERT' or new.request_id is distinct from old.request_id) then
    select id, company_id into v_request from requests where id = new.request_id;
    if not found then
      raise exception 'demande introuvable';
    end if;
    if v_request.company_id is distinct from new.company_id then
      raise exception 'la demande doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  -- 2. Un échantillon se fait par ligne d'article : dès que la demande porte
  --    un devis, la ligne est obligatoire à la création (0094). Avant tout
  --    chiffrage, la fiche peut vivre sans ligne et se rattacher ensuite.
  if TG_OP = 'INSERT' and new.quote_line_id is null and new.request_id is not null
     and exists (
       select 1 from quote_lines ql join quotes q on q.id = ql.quote_id
       where q.request_id = new.request_id
     ) then
    raise exception 'cette demande porte un devis : choisissez la ligne d''article concernée par l''échantillon';
  end if;

  -- 3. Lien à une ligne de devis verrouillé une fois l'ODF généré.
  if TG_OP = 'UPDATE' and old.quote_line_id is not null
     and new.quote_line_id is distinct from old.quote_line_id then
    select id into v_old_derived_line_id
    from production_order_lines where quote_line_id = old.quote_line_id
    order by created_at limit 1;
    if v_old_derived_line_id is not null then
      raise exception 'échantillon verrouillé : la ligne de devis liée est déjà passée en ordre de fabrication';
    end if;
  end if;

  if new.quote_line_id is not null then
    select q.request_id into v_quote_request_id
    from quote_lines ql join quotes q on q.id = ql.quote_id
    where ql.id = new.quote_line_id;
    if not found then
      raise exception 'ligne de devis introuvable';
    end if;
    if new.request_id is null or v_quote_request_id is distinct from new.request_id then
      raise exception 'la ligne de devis doit appartenir à un devis de la demande de l''échantillon';
    end if;

    if (TG_OP = 'INSERT' or new.quote_line_id is distinct from old.quote_line_id)
       and not is_commercial_or_above() then
      raise exception 'accès refusé : seul le commercial peut lier un échantillon à une ligne de devis';
    end if;

    select id into v_derived_line_id
    from production_order_lines where quote_line_id = new.quote_line_id
    order by created_at limit 1;

    if v_derived_line_id is not null then
      -- Ligne de devis inchangée : l'article d'ODF ne peut pas être
      -- remplacé à la main. Ligne nouvellement posée : l'article en découle.
      if TG_OP = 'UPDATE'
         and new.quote_line_id is not distinct from old.quote_line_id
         and new.production_order_line_id is distinct from v_derived_line_id then
        raise exception 'échantillon verrouillé : il suit l''article d''ODF issu de sa ligne de devis';
      end if;
      new.production_order_line_id := v_derived_line_id;
      return new;
    end if;
  end if;

  -- 4. Lien direct à un article d'ODF (0044) : staff + même entreprise.
  if new.production_order_line_id is not null
     and (TG_OP = 'INSERT' or new.production_order_line_id is distinct from old.production_order_line_id) then
    if not (is_commercial_or_above() or is_production_manager()) then
      raise exception 'accès refusé : seul le commercial ou le responsable production peut lier un échantillon à un article d''ordre de fabrication';
    end if;

    select po.company_id into v_line_company_id
    from production_order_lines pol
    join production_orders po on po.id = pol.production_order_id
    where pol.id = new.production_order_line_id;

    if not found then
      raise exception 'article d''ordre de fabrication introuvable';
    end if;
    if v_line_company_id is distinct from new.company_id then
      raise exception 'l''article référencé doit appartenir à la même entreprise que l''échantillon';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function enforce_sample_links() from public, anon, authenticated;
