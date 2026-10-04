-- ============================================================================
-- 0072 — SF-1 : socle de l'en-cours (étapes, déclarations par taille, finition)
-- ============================================================================
--
-- Plan d'exécution du 2026-10-03, lot SF-1 (décisions D7, D8, P1).
--
-- Jusqu'ici, hors coupe, record_work_order_quantity() cumulait un total SANS
-- taille, quantity_rejected n'était jamais écrit et rien ne contrôlait ce que
-- l'étape précédente avait réellement sorti : on ne savait pas où étaient les
-- pièces, taille par taille. Ce lot pose le socle :
--
--   1. Catégorie d'atelier « Finition » (et sa section si aucune n'existe) :
--      dernière étape OBLIGATOIRE de chaque article d'ODF (D8). C'est la seule
--      à décider du 2e choix (D7) ; elle déclare aussi des déchets.
--   2. Étapes : production_order_line_sections.etape (même numéro = sections
--      en parallèle) et work_orders.etape (recopiée à la validation). Valeur
--      initiale = rang de `ordre`, donc un parcours inchangé pour l'existant.
--      Mode de parallélisme d'une étape, déduit de `partie` (0069) :
--        - « quantite » : les sections se partagent les pièces → sorties ADDITIONNÉES ;
--        - « partie »   : chaque section fait une partie de la pièce → MINIMUM.
--      Une étape « mixte » est interdite en version 1 (Q-SF-6).
--   3. production_declarations : déclarations par taille, en ajout seul
--      (aucun UPDATE ni DELETE : RLS + déclencheur). Une erreur se corrige par
--      une contre-déclaration motivée (correct_declaration()).
--   4. line_stage_flow() : entrée, bonnes, déchets, 1er/2e choix et en-cours
--      par étape × taille. Entrée = Bonnes + Déchets + En cours, partout.
--        - entrée de l'étape 1 sans coupe ni stock = répartition de tailles de
--          la ligne (règle de repli P1, vente d'unis possible dès ce lot) ;
--        - coupe : pièces des matelas clôturés (close_matelas) ;
--        - étape suivante : sorties de l'étape précédente (somme ou minimum).
--   5. declare_production() : contrôle des types par catégorie et « jamais
--      plus que l'entrée » (verrou sur la ligne) ; tient à jour
--      work_orders.quantity_done / quantity_rejected (compatibilité) et
--      déclenche les accroches on_production_declared() — vides ici, garnies
--      par LIV-1 (expédition) et SF-4 (mouvements de stock).
--   6. create_article_lot() ne crée PLUS aucun mouvement de stock :
--      product_models.sage_reference est faux en production (TSM02, TSM21) et
--      gonflait un stock semi-fini que Sage ne doit pas voir (D1, D3).
--   7. request_closure() renvoie le bilan par taille ; s'il reste de
--      l'en-cours, un motif est exigé (SF-4 le remplacera par un blocage).
--   8. Vue odf_first_choice_by_size : point d'accroche de la livraison.
--
-- Règle « on ajoute, on ne casse pas » : aucune colonne ni fonction utilisée
-- par le code en production n'est supprimée ou renommée.
-- record_work_order_quantity(uuid, int, text) et request_closure(uuid) restent
-- appelables avec la même signature.
-- ============================================================================

-- ============================================================================
-- 1. CATÉGORIE ET SECTION « FINITION »
-- ============================================================================

insert into atelier_categories (nom, cle, display_order)
values ('Finition', 'finition', 90)
on conflict (cle) do nothing;

do $$
declare
  v_categorie uuid := (select id from atelier_categories where cle = 'finition');
begin
  if exists (select 1 from sections where categorie_id = v_categorie) then
    return;
  end if;
  -- Une section déjà nommée « Finition » mais sans catégorie est rattachée
  -- plutôt que dupliquée (sections.name est unique).
  update sections set categorie_id = v_categorie
  where lower(name) = 'finition' and categorie_id is null;
  if found then
    return;
  end if;
  if exists (select 1 from sections where lower(name) = 'finition') then
    insert into sections (name, description, display_order, categorie_id)
    values ('Finition (atelier)', 'Dernière étape de chaque article : 1er choix, 2e choix, déchets, boutons, emballage', 900, v_categorie);
  else
    insert into sections (name, description, display_order, categorie_id)
    values ('Finition', 'Dernière étape de chaque article : 1er choix, 2e choix, déchets, boutons, emballage', 900, v_categorie);
  end if;
end $$;

-- ============================================================================
-- 2. ÉTAPES
-- ============================================================================

alter table production_order_line_sections add column if not exists etape int;
alter table production_order_line_sections
  add constraint production_order_line_sections_etape_positive check (etape is null or etape >= 1);

update production_order_line_sections pls
set etape = r.rang
from (
  select id, dense_rank() over (partition by production_order_line_id order by ordre, created_at) as rang
  from production_order_line_sections
) r
where r.id = pls.id and pls.etape is null;

-- Le code en production insère sans `etape` : l'étape reprend alors l'ordre
-- (parcours en série, le comportement d'avant ce lot).
create or replace function production_order_line_sections_default_etape()
returns trigger
language plpgsql
as $$
begin
  if new.etape is null then
    new.etape := greatest(coalesce(new.ordre, 1), 1);
  end if;
  return new;
end;
$$;

create trigger trg_production_order_line_sections_default_etape
  before insert or update on production_order_line_sections
  for each row execute function production_order_line_sections_default_etape();

comment on column production_order_line_sections.etape is
  'Étape du parcours de l''article (SF-1, migration 0072). Même numéro = sections en parallèle : elles se partagent les pièces (partie null, sorties additionnées) ou chacune fait une partie de la pièce (partie renseignée, minimum des sorties). Dernière étape : toujours la Finition.';

alter table work_orders add column if not exists etape int;

update work_orders wo
set etape = pls.etape
from production_order_line_sections pls
where pls.production_order_line_id = wo.production_order_line_id
  and pls.section_id = wo.section_id
  and wo.etape is null;

comment on column work_orders.etape is
  'Étape du parcours de l''article, recopiée de production_order_line_sections à la validation de l''ODF (SF-1, migration 0072).';

-- Catégorie (clé) d'une section — null si elle n'en a pas.
create or replace function section_categorie_cle(p_section_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select ac.cle from sections s left join atelier_categories ac on ac.id = s.categorie_id where s.id = p_section_id;
$$;

-- Section Finition par défaut (la première active de la catégorie).
create or replace function default_finition_section_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from sections s join atelier_categories ac on ac.id = s.categorie_id
  where ac.cle = 'finition' and s.active
  order by s.display_order, s.name
  limit 1;
$$;

-- Ajoute la Finition en dernière étape d'une ligne qui n'en a pas (D8).
create or replace function ensure_line_finition(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section uuid;
begin
  if exists (
    select 1 from production_order_line_sections pls
    where pls.production_order_line_id = p_line_id and section_categorie_cle(pls.section_id) = 'finition'
  ) then
    return;
  end if;

  v_section := default_finition_section_id();
  if v_section is null then
    raise exception 'aucune section active de catégorie Finition : créez-en une dans Paramètres > Sections d''atelier';
  end if;

  insert into production_order_line_sections (production_order_line_id, section_id, ordre, etape)
  select p_line_id, v_section,
         coalesce(max(ordre), 0) + 1,
         coalesce(max(etape), 0) + 1
  from production_order_line_sections
  where production_order_line_id = p_line_id;
end;
$$;

-- Contrôle du parcours d'une ligne (soumission et validation) :
--   - la Finition est présente, seule dans la DERNIÈRE étape, et nulle part ailleurs ;
--   - Coupe (et Stock, SF-2) seulement en première étape ;
--   - pas d'étape « mixte » : dans une étape à plusieurs sections, toutes
--     portent une partie, ou aucune (Q-SF-6).
create or replace function check_line_route(p_line_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desc text;
  v_last int;
  v_first int;
  v_bad record;
begin
  select description into v_desc from production_order_lines where id = p_line_id;

  select max(etape), min(etape) into v_last, v_first
  from production_order_line_sections where production_order_line_id = p_line_id;

  if v_last is null then
    raise exception 'article « % » : aucune section retenue', v_desc;
  end if;

  if not exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id and etape = v_last
      and section_categorie_cle(section_id) = 'finition'
  ) then
    raise exception 'article « % » : la Finition doit être la dernière étape du parcours', v_desc;
  end if;

  if exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id
      and (
        (etape = v_last and section_categorie_cle(section_id) is distinct from 'finition')
        or (etape <> v_last and section_categorie_cle(section_id) = 'finition')
      )
  ) then
    raise exception 'article « % » : la Finition doit être seule dans la dernière étape, et nulle part ailleurs', v_desc;
  end if;

  if exists (
    select 1 from production_order_line_sections
    where production_order_line_id = p_line_id and etape <> v_first
      and section_categorie_cle(section_id) in ('coupe', 'stock')
  ) then
    raise exception 'article « % » : la Coupe (ou le Stock) ne peut être que la première étape', v_desc;
  end if;

  for v_bad in
    select etape
    from production_order_line_sections
    where production_order_line_id = p_line_id
    group by etape
    having count(*) > 1
       and count(*) filter (where partie is not null) not in (0, count(*))
  loop
    raise exception 'article « % », étape % : mélange de sections « par partie » et « par quantité » — interdit en version 1, séparez-les en deux étapes', v_desc, v_bad.etape;
  end loop;
end;
$$;

-- ============================================================================
-- 3. DÉCLARATIONS PAR TAILLE (ajout seul)
-- ============================================================================

create table production_declarations (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references work_orders(id) on delete cascade,
  production_order_line_id uuid not null references production_order_lines(id) on delete cascade,
  taille text not null references sizes(cle) on update cascade,
  type text not null
    constraint production_declarations_type_valide
      check (type in ('bonne', 'dechet', 'premier_choix', 'deuxieme_choix', 'preleve')),
  quantite int not null,
  corrige_declaration_id uuid references production_declarations(id),
  motif text,
  -- Lot QR de bout en bout (SF-5) : la déclaration peut citer un lot.
  article_lot_id uuid references article_lots(id),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  constraint production_declarations_quantite_signe
    check (quantite > 0 or (quantite < 0 and corrige_declaration_id is not null)),
  constraint production_declarations_correction_motivee
    check (corrige_declaration_id is null or (motif is not null and btrim(motif) <> ''))
);

create index idx_production_declarations_line_taille on production_declarations(production_order_line_id, taille);
create index idx_production_declarations_wo on production_declarations(work_order_id);
create index idx_production_declarations_corrige on production_declarations(corrige_declaration_id);

comment on table production_declarations is
  'Déclarations de production par taille (SF-1, migration 0072). Ajout seul : une erreur se corrige par une contre-déclaration (quantité négative, corrige_declaration_id, motif). Types autorisés selon la catégorie de la section : Coupe = déchets (les bonnes viennent des matelas clôturés) ; Stock = prélevé ; Finition = 1er choix, 2e choix, déchets ; autres = bonnes, déchets.';

alter table production_declarations enable row level security;

create policy production_declarations_select on production_declarations
  for select using (is_staff());

revoke all on production_declarations from public, anon;
grant select on production_declarations to authenticated;

create or replace function production_declarations_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'les déclarations de production ne se modifient ni ne se suppriment : passez par une contre-déclaration motivée';
end;
$$;

create trigger trg_production_declarations_append_only
  before update or delete on production_declarations
  for each row execute function production_declarations_append_only();

-- Le déclencheur bloque aussi la suppression en cascade : voulu. Seul un ODF
-- lancé porte des déclarations, et un ODF lancé ne se supprime pas, il s'annule.

-- ============================================================================
-- 4. FLUX PAR ÉTAPE × TAILLE
-- ============================================================================

-- Détail par section (sous-ODF) × taille. Une ligne pas encore lancée (aucun
-- sous-ODF) est décrite par ses sections retenues, sans déclaration.
--
-- Pour une section s de l'étape (b = bonnes, d = déchets) :
--   coupe    : produit = pièces des matelas clôturés, b = produit − d
--   stock    : b = prélevé
--   finition : b = 1er choix + 2e choix
--   autres   : b = bonnes
-- Entrée E de l'étape :
--   étape 1 avec coupe : max(répartition, Σ produit) ; avec stock : max(répartition, Σ prélevé) ;
--   étape 1 sans coupe ni stock : répartition de la ligne (P1) ;
--   étape suivante : sortie de l'étape précédente.
-- Mode « quantite » : B = Σ b, D = Σ d, reçu(s) = E − ce que les autres ont déclaré ;
-- Mode « partie »   : B = min b, D = max d, reçu(s) = E.
-- En-cours = E − B − D ; reste(s) = reçu(s) − b(s) − d(s).
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
      v_sum_produit := 0; v_sum_preleve := 0;
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

        etape := v_etape;
        mode := v_mode;
        work_order_id := nullif(v_wo, '')::uuid;
        section_id := (v_unit ->> 'section')::uuid;
        categorie := v_cat;
        taille := v_t;
        entree_etape := v_e;
        recu := case when v_mode = 'partie' then v_e else v_e - (v_sum_b + v_sum_d - v_b - v_d) end;
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

comment on function line_stage_flow_detail(uuid) is
  'Flux de pièces d''une ligne d''ODF, par section (sous-ODF) × taille : reçu, bonnes, déchets, 1er/2e choix, prélevé, reste (SF-1, migration 0072).';

-- Vue agrégée par étape × taille : Entrée = Bonnes + Déchets + En cours.
create or replace function line_stage_flow(p_line_id uuid)
returns table (
  etape int,
  mode text,
  taille text,
  entree int,
  bonnes int,
  dechets int,
  premier_choix int,
  deuxieme_choix int,
  preleve int,
  en_cours int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.etape,
    min(d.mode) as mode,
    d.taille,
    max(d.entree_etape) as entree,
    (case when min(d.mode) = 'partie' then min(d.bonnes) else sum(d.bonnes) end)::int as bonnes,
    (case when min(d.mode) = 'partie' then max(d.dechets) else sum(d.dechets) end)::int as dechets,
    (case when min(d.mode) = 'partie' then min(d.premier_choix) else sum(d.premier_choix) end)::int as premier_choix,
    (case when min(d.mode) = 'partie' then min(d.deuxieme_choix) else sum(d.deuxieme_choix) end)::int as deuxieme_choix,
    sum(d.preleve)::int as preleve,
    (max(d.entree_etape)
      - (case when min(d.mode) = 'partie' then min(d.bonnes) else sum(d.bonnes) end)
      - (case when min(d.mode) = 'partie' then max(d.dechets) else sum(d.dechets) end))::int as en_cours
  from line_stage_flow_detail(p_line_id) d
  left join sizes sz on sz.cle = d.taille
  group by d.etape, d.taille
  order by d.etape, min(sz.groupe), min(sz.display_order), d.taille;
$$;

comment on function line_stage_flow(uuid) is
  'Flux de pièces d''une ligne d''ODF par étape × taille : entrée, bonnes, déchets, 1er/2e choix, prélevé, en-cours (Entrée = Bonnes + Déchets + En cours). SF-1, migration 0072.';

-- Ce qu'un sous-ODF a reçu, déclaré et doit encore traiter, taille par taille
-- (terminal de section).
create or replace function work_order_flow(p_work_order_id uuid)
returns table (
  taille text,
  recu int,
  bonnes int,
  dechets int,
  premier_choix int,
  deuxieme_choix int,
  preleve int,
  coupe_produit int,
  reste int
)
language sql
stable
security definer
set search_path = public
as $$
  select d.taille, d.recu, d.bonnes, d.dechets, d.premier_choix, d.deuxieme_choix, d.preleve, d.coupe_produit, d.reste
  from work_orders w
  cross join lateral line_stage_flow_detail(w.production_order_line_id) d
  where w.id = p_work_order_id and d.work_order_id = p_work_order_id;
$$;

-- Même chose pour plusieurs sous-ODF d'un coup (file d'un terminal de section).
create or replace function work_orders_flow(p_work_order_ids uuid[])
returns table (
  work_order_id uuid,
  taille text,
  recu int,
  bonnes int,
  dechets int,
  premier_choix int,
  deuxieme_choix int,
  preleve int,
  coupe_produit int,
  reste int
)
language sql
stable
security definer
set search_path = public
as $$
  select d.work_order_id, d.taille, d.recu, d.bonnes, d.dechets, d.premier_choix, d.deuxieme_choix, d.preleve, d.coupe_produit, d.reste
  from (select distinct w.production_order_line_id from work_orders w where w.id = any(p_work_order_ids)) l
  cross join lateral line_stage_flow_detail(l.production_order_line_id) d
  where d.work_order_id = any(p_work_order_ids);
$$;

-- Garde-fou commun aux déclarations et aux corrections : aucun reste négatif
-- nulle part sur la ligne (on ne déclare jamais plus que l'entrée, et une
-- correction en amont ne peut pas laisser l'aval au-delà de ce qu'il a reçu).
create or replace function assert_line_flow(p_line_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bad record;
begin
  select d.etape, d.taille, d.recu, d.reste, s.name as section_name
    into v_bad
  from line_stage_flow_detail(p_line_id) d
  left join sections s on s.id = d.section_id
  where d.reste < 0
  order by d.etape
  limit 1;

  if found then
    raise exception 'taille % — % (étape %) : % pièce(s) de plus que ce qui a été reçu (% reçue(s)) — on ne déclare jamais plus que l''entrée',
      split_part(v_bad.taille, '/', 2), v_bad.section_name, v_bad.etape, -v_bad.reste, v_bad.recu;
  end if;
end;
$$;

-- ============================================================================
-- 5. DÉCLARER / CORRIGER
-- ============================================================================

-- Accroche appelée après chaque déclaration ou correction. Vide dans ce lot :
-- LIV-1 y branche l'expédition (1er choix d'un ODF client), SF-4 les
-- mouvements de stock (entrées PF, 2e choix), SF-2 la sortie au prélèvement.
create or replace function on_production_declared(p_declaration_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
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

-- Plusieurs déclarations d'un coup (grille du terminal), atomiques :
-- p_lignes = [{"taille": "Homme/M", "type": "bonne", "quantite": 12}, …]
create or replace function declare_production_batch(
  p_work_order_id uuid,
  p_lignes jsonb,
  p_motif text default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ligne jsonb;
  v_count int := 0;
begin
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' then
    raise exception 'aucune déclaration à enregistrer';
  end if;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    if coalesce((v_ligne ->> 'quantite')::int, 0) > 0 then
      perform declare_production(
        p_work_order_id,
        v_ligne ->> 'taille',
        v_ligne ->> 'type',
        (v_ligne ->> 'quantite')::int,
        coalesce(v_ligne ->> 'motif', p_motif)
      );
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then
    raise exception 'aucune quantité saisie';
  end if;
  return v_count;
end;
$$;

-- Contre-déclaration motivée : annule tout ou partie d'une déclaration.
-- Réservée au responsable production et à l'administrateur.
create or replace function correct_declaration(
  p_declaration_id uuid,
  p_quantite int,
  p_motif text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decl production_declarations;
  v_restant int;
  v_po_status production_order_status;
  v_id uuid;
begin
  if not (current_role_name() in ('administrateur', 'responsable_production')) then
    raise exception 'accès refusé : seuls le responsable production et l''administrateur corrigent une déclaration';
  end if;
  if p_motif is null or btrim(p_motif) = '' then
    raise exception 'un motif est obligatoire pour corriger une déclaration';
  end if;
  if p_quantite is null or p_quantite <= 0 then
    raise exception 'la quantité à annuler doit être un entier positif';
  end if;

  select * into v_decl from production_declarations where id = p_declaration_id;
  if not found then
    raise exception 'déclaration introuvable';
  end if;
  if v_decl.corrige_declaration_id is not null then
    raise exception 'une contre-déclaration ne se corrige pas : corrigez la déclaration d''origine';
  end if;

  select po.status into v_po_status
  from work_orders w join production_orders po on po.id = w.production_order_id
  where w.id = v_decl.work_order_id;
  if v_po_status is distinct from 'en_production' then
    raise exception 'correction impossible : l''ordre de fabrication n''est pas en production (statut : %)', v_po_status;
  end if;

  perform 1 from production_order_lines where id = v_decl.production_order_line_id for update;

  select v_decl.quantite + coalesce(sum(quantite), 0) into v_restant
  from production_declarations where corrige_declaration_id = p_declaration_id;
  if p_quantite > v_restant then
    raise exception 'on ne peut annuler que % pièce(s) sur cette déclaration', v_restant;
  end if;

  insert into production_declarations (
    work_order_id, production_order_line_id, taille, type, quantite, corrige_declaration_id, motif, created_by
  ) values (
    v_decl.work_order_id, v_decl.production_order_line_id, v_decl.taille, v_decl.type, -p_quantite,
    p_declaration_id, btrim(p_motif), auth.uid()
  ) returning id into v_id;

  perform assert_line_flow(v_decl.production_order_line_id);

  update work_orders
  set quantity_done = quantity_done - case when v_decl.type in ('bonne', 'premier_choix', 'deuxieme_choix', 'preleve') then p_quantite else 0 end,
      quantity_rejected = quantity_rejected - case when v_decl.type = 'dechet' then p_quantite else 0 end,
      actual_end = null
  where id = v_decl.work_order_id;

  perform on_production_declared(v_id);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'correct_declaration', 'work_order', v_decl.work_order_id,
          jsonb_build_object('declaration_id', p_declaration_id, 'correction_id', v_id,
                             'quantite_annulee', p_quantite, 'motif', p_motif));
  return v_id;
end;
$$;

revoke all on function line_stage_flow_detail(uuid) from public, anon, authenticated;
revoke all on function line_stage_flow(uuid) from public, anon, authenticated;
revoke all on function work_order_flow(uuid) from public, anon, authenticated;
revoke all on function work_orders_flow(uuid[]) from public, anon, authenticated;
revoke all on function assert_line_flow(uuid) from public, anon, authenticated;
revoke all on function on_production_declared(uuid) from public, anon, authenticated;
revoke all on function declare_production(uuid, text, text, int, text) from public, anon, authenticated;
revoke all on function declare_production_batch(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function correct_declaration(uuid, int, text) from public, anon, authenticated;
revoke all on function ensure_line_finition(uuid) from public, anon, authenticated;
revoke all on function check_line_route(uuid) from public, anon, authenticated;
revoke all on function section_categorie_cle(uuid) from public, anon;
revoke all on function default_finition_section_id() from public, anon;

grant execute on function line_stage_flow_detail(uuid) to authenticated;
grant execute on function line_stage_flow(uuid) to authenticated;
grant execute on function work_order_flow(uuid) to authenticated;
grant execute on function work_orders_flow(uuid[]) to authenticated;
grant execute on function declare_production(uuid, text, text, int, text) to authenticated;
grant execute on function declare_production_batch(uuid, jsonb, text) to authenticated;
grant execute on function correct_declaration(uuid, int, text) to authenticated;
grant execute on function section_categorie_cle(uuid) to authenticated;
grant execute on function default_finition_section_id() to authenticated;

-- ============================================================================
-- 6. record_work_order_quantity() — conservée, bornée par l'en-cours
-- ============================================================================
-- Même signature, même autorisation. Nouveau : si la ligne a une répartition
-- par taille, le cumul ne peut plus dépasser ce que la section a reçu (somme
-- des tailles). Le terminal de section passe désormais par
-- declare_production() ; cette fonction reste pour la compatibilité.

create or replace function record_work_order_quantity(
  p_work_order_id uuid,
  p_quantity int,
  p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_wo work_orders;
  v_categorie_cle text;
  v_po_status production_order_status;
  v_recu int;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  select * into v_wo from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'ordre de travail introuvable';
  end if;

  if not (v_role in ('administrateur', 'responsable_production')
          or (v_role = 'chef_section' and v_wo.section_id = v_section)) then
    raise exception 'accès refusé : cet ordre de travail n''appartient pas à votre section';
  end if;

  select ac.cle into v_categorie_cle
  from sections s left join atelier_categories ac on ac.id = s.categorie_id
  where s.id = v_wo.section_id;
  if v_categorie_cle = 'coupe' then
    raise exception 'la quantité d''une section Coupe ne se saisit pas à la main : elle est calculée à la clôture de chaque matelas';
  end if;

  if p_quantity = 0 then
    raise exception 'la quantité à ajouter ne peut pas être nulle';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de saisir une quantité : cet ordre de fabrication est clôturé';
  end if;

  -- SF-1 : pas au-delà de ce que la section a reçu, si la ligne a des tailles.
  if exists (select 1 from production_order_sizes where production_order_line_id = v_wo.production_order_line_id) then
    perform 1 from production_order_lines where id = v_wo.production_order_line_id for update;
    select coalesce(sum(recu), 0) into v_recu from work_order_flow(p_work_order_id);
    if v_wo.quantity_done + p_quantity > v_recu then
      raise exception 'saisie refusée : % pièce(s) déjà comptée(s) + % dépasse(nt) ce que la section a reçu (%) — déclarez par taille depuis le terminal',
        v_wo.quantity_done, p_quantity, v_recu;
    end if;
  end if;

  update work_orders
  set
    quantity_done = quantity_done + p_quantity,
    actual_start = coalesce(actual_start, now()),
    actual_end = case when quantity_done + p_quantity >= quantity_planned then now() else null end
  where id = p_work_order_id;

  insert into work_order_events (work_order_id, event_type, user_id, quantity, comment)
  values (p_work_order_id, 'quantite_ajoutee', auth.uid(), p_quantity, p_comment);

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_work_order_quantity', 'work_order', p_work_order_id,
          jsonb_build_object('quantity', p_quantity, 'comment', p_comment));
end;
$$;

revoke all on function record_work_order_quantity(uuid, int, text) from public, anon, authenticated;
grant execute on function record_work_order_quantity(uuid, int, text) to authenticated;

-- ============================================================================
-- 7. SOUMISSION ET VALIDATION : FINITION AJOUTÉE, PARCOURS CONTRÔLÉ
-- ============================================================================

-- Accroche appelée en fin de validation (après la création des sous-ODF).
-- Vide ici ; SF-2 y pose les réservations de stock.
create or replace function on_production_order_validated(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;
revoke all on function on_production_order_validated(uuid) from public, anon, authenticated;

-- Reprise de 0050 ; ajouts : Finition ajoutée automatiquement à chaque ligne
-- qui n'en a pas, puis contrôle du parcours (check_line_route).
create or replace function submit_production_order(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_somme int;
  v_line production_order_lines;
  v_line_somme int;
  v_zone_count int;
  v_configured_zone_count int;
  v_requires_infographie boolean;
begin
  if not has_permission('ordres_fabrication', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de soumettre un ordre de fabrication';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;

  if v_po.status not in ('brouillon', 'refuse') then
    raise exception 'seul un ordre de fabrication en brouillon ou refusé peut être soumis (statut actuel : %)', v_po.status;
  end if;

  if not exists (select 1 from production_order_lines where production_order_id = p_production_order_id) then
    raise exception 'aucun article sur cet ordre de fabrication';
  end if;

  if v_po.comptabilite_validee_le is null then
    raise exception 'la validation comptabilité (compte client) est requise avant de soumettre cet ordre de fabrication';
  end if;

  select exists (
    select 1
    from production_order_line_sections pls
    join sections s on s.id = pls.section_id
    join atelier_categories ac on ac.id = s.categorie_id
    join production_order_lines pol on pol.id = pls.production_order_line_id
    where pol.production_order_id = p_production_order_id and ac.requiert_visuel = true
  ) into v_requires_infographie;

  if v_requires_infographie and v_po.infographie_validee_le is null then
    raise exception 'la validation infographie (visuels) est requise avant de soumettre cet ordre de fabrication — au moins un article exige un visuel';
  end if;

  for v_line in
    select * from production_order_lines where production_order_id = p_production_order_id
  loop
    if v_line.product_model_id is null then
      raise exception 'article « % » : aucun modèle de produit sélectionné', v_line.description;
    end if;

    -- SF-1 (D8) : la Finition est ajoutée en dernière étape si elle manque —
    -- une vente d'unis peut ainsi ne passer que par la Finition (P1).
    perform ensure_line_finition(v_line.id);
    perform check_line_route(v_line.id);

    if v_line.couleur_unique_id is null then
      select count(*) into v_zone_count
      from product_zone_templates where product_model_id = v_line.product_model_id;

      if v_zone_count = 0 then
        raise exception 'article « % » : ce modèle n''a pas de gabarit de zones — cochez "modèle uni" et choisissez une couleur', v_line.description;
      end if;

      select count(*) into v_configured_zone_count
      from production_order_line_zone_colors where production_order_line_id = v_line.id;

      if v_configured_zone_count < v_zone_count then
        raise exception 'article « % » : couleur manquante pour au moins une zone (% configurée(s) sur % attendue(s))',
          v_line.description, v_configured_zone_count, v_zone_count;
      end if;
    end if;

    select coalesce(sum(quantite_demandee), 0) into v_line_somme
    from production_order_sizes where production_order_line_id = v_line.id;

    if v_line_somme <> v_line.quantity then
      raise exception 'article « % » : la répartition par taille totalise % pièces alors que l''article en porte % : écart de %',
        v_line.description, v_line_somme, v_line.quantity, abs(v_line_somme - v_line.quantity);
    end if;

    if exists (select 1 from sample_requests where production_order_line_id = v_line.id)
       and not exists (select 1 from sample_requests where production_order_line_id = v_line.id and status = 'valide') then
      raise exception 'article « % » : un échantillon est lié à cet article mais aucun n''a le statut "validé"', v_line.description;
    end if;
  end loop;

  select coalesce(sum(pos.quantite_demandee), 0) into v_somme
  from production_order_sizes pos
  join production_order_lines pol on pol.id = pos.production_order_line_id
  where pol.production_order_id = p_production_order_id;

  if v_somme <> v_po.total_quantity then
    raise exception 'la répartition par taille totalise % pièces alors que la commande en porte % : écart de %',
      v_somme, v_po.total_quantity, abs(v_somme - v_po.total_quantity);
  end if;

  update production_orders
  set status = 'en_attente_validation',
      refus_motif = null,
      refuse_par = null,
      refuse_le = null,
      soumis_le = now(),
      soumis_par = auth.uid()
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_attente_validation', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'submit_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('quantite_repartie', v_somme));
end;
$$;

revoke all on function submit_production_order(uuid) from public, anon, authenticated;
grant execute on function submit_production_order(uuid) to authenticated;

-- Reprise de 0052 ; ajouts : Finition garantie et parcours contrôlé par
-- ligne, étape recopiée sur chaque sous-ODF, accroche de fin de validation.
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

    perform ensure_line_finition(v_line.id);
    perform check_line_route(v_line.id);

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
              raise exception 'article « % », taille % : surplus tracé de % (% tracée(s) pour % demandée(s)) — dépasse le taux d''acceptation autorisé (%), fiche %',
                v_line.description, v_size.taille, round(v_surplus_pct, 2)::text || '%',
                v_traced_qty, v_size.quantite_demandee, v_taux_effectif::text || '%', v_fiche.numero_ot;
            end if;
          end if;
        end if;
      end loop;
    end if;

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

    v_seq_in_line := 0;
    v_prev_wo_id := null;
    for v_line_section in
      select * from production_order_line_sections
      where production_order_line_id = v_line.id
      order by etape asc, ordre asc, created_at asc
    loop
      v_seq_in_line := v_seq_in_line + 1;
      v_seq := v_seq + 1;
      insert into work_orders (
        reference, production_order_id, production_order_line_id, section_id, quantity_planned, planned_start, etape
      ) values (
        v_po.reference || '-L' || v_line_seq || '-OT' || v_seq_in_line,
        v_po.id, v_line.id, v_line_section.section_id, coalesce(v_line_section.quantite, v_line.quantity), now(),
        v_line_section.etape
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

  perform on_production_order_validated(p_production_order_id);

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'en_production', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'validate_production_order', 'production_order', p_production_order_id,
          jsonb_build_object('sous_odf_generes', v_seq, 'surplus_traces', v_surplus));
end;
$$;

revoke all on function validate_production_order(uuid) from public, anon, authenticated;
grant execute on function validate_production_order(uuid) to authenticated;

-- ============================================================================
-- 8. create_article_lot() — PLUS AUCUN MOUVEMENT DE STOCK
-- ============================================================================
-- Reprise de 0053, sans le bloc qui insérait un mouvement entree_semi_fini /
-- entree_fini sur product_models.sage_reference (faux en production). Les
-- types restent autorisés dans stock_movements, ils ne sont plus générés.

create or replace function create_article_lot(
  p_production_order_id uuid,
  p_trace_id uuid,
  p_categorie text,
  p_composition_taille jsonb
) returns table (id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role user_role;
  v_section uuid;
  v_categorie_cle text;
  v_lot article_lots;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select ac.cle into v_categorie_cle
    from sections s left join atelier_categories ac on ac.id = s.categorie_id
    where s.id = v_section;
    if v_categorie_cle is distinct from 'coupe' then
      raise exception 'accès refusé : la génération de lots est réservée à une section de catégorie Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de générer un lot';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if p_categorie not in ('semi_fini', 'fini', 'dechet') then
    raise exception 'catégorie invalide : %', p_categorie;
  end if;
  if p_trace_id is not null and not exists (
    select 1 from traces_placement tp
    join fiches_placement fp on fp.id = tp.fiche_id
    join production_order_lines pol on pol.id = fp.production_order_line_id
    where tp.id = p_trace_id and pol.production_order_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  insert into article_lots (production_order_id, trace_id, categorie, composition_taille, created_by)
  values (p_production_order_id, p_trace_id, p_categorie, coalesce(p_composition_taille, '{}'::jsonb), auth.uid())
  returning * into v_lot;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'create_article_lot', 'article_lot', v_lot.id,
          jsonb_build_object('code', v_lot.code, 'production_order_id', p_production_order_id,
                              'categorie', p_categorie, 'composition_taille', p_composition_taille));

  return query select v_lot.id, v_lot.code;
end;
$$;
revoke all on function create_article_lot(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_article_lot(uuid, uuid, text, jsonb) to authenticated;

-- ============================================================================
-- 9. BILAN ET DEMANDE DE CLÔTURE
-- ============================================================================

alter table production_orders
  add column if not exists bilan_cloture jsonb,
  add column if not exists motif_cloture_en_cours text;

comment on column production_orders.bilan_cloture is
  'Bilan par article × taille figé à la demande de clôture (SF-1, migration 0072) : demandé, 1er choix, 2e choix, déchets, en-cours.';
comment on column production_orders.motif_cloture_en_cours is
  'Motif saisi quand la clôture est demandée alors qu''il reste de l''en-cours (SF-1). SF-4 remplace ce motif par un blocage avec destinations.';

-- Bilan d'un ODF : par article et par taille, demandé / 1er choix / 2e choix /
-- déchets (toutes étapes) / en-cours (toutes étapes).
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
             'en_cours', t.en_cours) order by t.ord), '[]'::jsonb),
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
             sum(f.en_cours)::int as en_cours
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

revoke all on function production_order_balance(uuid) from public, anon, authenticated;
grant execute on function production_order_balance(uuid) to authenticated;

-- Nouvelle forme : renvoie le bilan ; motif exigé s'il reste de l'en-cours.
create or replace function request_closure(p_production_order_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po production_orders;
  v_bilan jsonb;
begin
  if not (has_permission('ordres_fabrication', 'modify')
          and (current_role_name() = 'responsable_production' or is_admin())) then
    raise exception 'accès refusé : seul le chef de production peut demander la clôture';
  end if;

  select * into v_po from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po.status <> 'en_production' then
    raise exception 'cet ordre de fabrication n''est pas en production (statut actuel : %)', v_po.status;
  end if;

  v_bilan := production_order_balance(p_production_order_id);

  if (v_bilan ->> 'en_cours')::int > 0 and (p_motif is null or btrim(p_motif) = '') then
    raise exception 'il reste % pièce(s) en cours sur cet ordre de fabrication : un motif est obligatoire pour demander la clôture', (v_bilan ->> 'en_cours')::int;
  end if;

  update production_orders
  set status = 'demande_cloture', cloture_demandee_at = now(), cloture_demandee_par = auth.uid(),
      bilan_cloture = v_bilan,
      motif_cloture_en_cours = nullif(btrim(coalesce(p_motif, '')), '')
  where id = p_production_order_id;

  insert into status_history (entity_type, entity_id, from_status, to_status, changed_by)
  values ('production_order', p_production_order_id, v_po.status::text, 'demande_cloture', auth.uid());
  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'request_closure', 'production_order', p_production_order_id,
          jsonb_build_object('en_cours', (v_bilan ->> 'en_cours')::int, 'motif', p_motif));

  return v_bilan;
end;
$$;

revoke all on function request_closure(uuid, text) from public, anon, authenticated;
grant execute on function request_closure(uuid, text) to authenticated;

-- Ancienne forme, même signature : délègue sans motif (refusée s'il reste de l'en-cours).
create or replace function request_closure(p_production_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform request_closure(p_production_order_id, null::text);
end;
$$;

revoke all on function request_closure(uuid) from public, anon, authenticated;
grant execute on function request_closure(uuid) to authenticated;

-- ============================================================================
-- 10. POINT D'ACCROCHE DE LA LIVRAISON
-- ============================================================================

create or replace view odf_first_choice_by_size as
  select pol.production_order_id,
         pd.production_order_line_id,
         pd.taille,
         sum(pd.quantite)::int as premier_choix
  from production_declarations pd
  join production_order_lines pol on pol.id = pd.production_order_line_id
  where pd.type = 'premier_choix'
  group by pol.production_order_id, pd.production_order_line_id, pd.taille;

alter view odf_first_choice_by_size set (security_invoker = on);

comment on view odf_first_choice_by_size is
  '1er choix déclaré en finition, par ligne d''ODF × taille (corrections déduites) — point d''accroche de la livraison (SF-1, migration 0072).';

grant select on odf_first_choice_by_size to authenticated;
