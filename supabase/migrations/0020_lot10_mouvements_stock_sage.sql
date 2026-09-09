-- ============================================================================
-- Seritex — Module Production, lot 10 : mouvements de stock & fiches
-- d'import Sage
-- Réf. : claude_logique-ordre-fabrication-consolidee.md (sections 16, 19, 20),
--        claude_cahier-des-charges-technique-production.md (lot 10)
-- ============================================================================
--
-- Rappel du principe (section 19) : Seritex n'écrit jamais directement dans
-- Sage. La bilatéralité se résout par génération de FICHES D'IMPORT que Sage
-- exploite manuellement — jamais par écriture directe (ni SQL, ni API).
--
-- Décisions actées ici, après vérification de l'état réel du schéma et du
-- code (lots 6/7/9) — à discuter si besoin :
--
--   - **Pas de nouvelle saisie dédiée** : les mouvements de stock ne sont
--     jamais saisis directement par un utilisateur, ils se DÉRIVENT des deux
--     événements qui portent déjà la bonne information, à l'intérieur des
--     fonctions existantes (même transaction, cohérence garantie) :
--       1. `record_pesee(reception_tissu | retour_stock)` (lot 7) → mouvement
--          `sortie_mp` / `retour_mp`, poids_kg déjà connu à cet instant.
--       2. `create_article_lot(categorie = semi_fini | fini)` (lot 6) →
--          mouvement `entree_semi_fini` / `entree_fini`, quantité = somme de
--          `composition_taille` (pièces), déjà connue à cet instant.
--     `record_pesee(sortie_lot)` et `record_bag_weighing` (déchets) ne
--     génèrent VOLONTAIREMENT aucun mouvement : ce sont des pesées de
--     réconciliation matière interne (section 16), sans pendant Sage — pour
--     les déchets, section 21 est explicite ("Sage ne peut pas voir cette
--     information"). `create_article_lot(categorie = dechet)` non plus, même
--     raison (chiffons vendus, traçabilité Seritex uniquement).
--
--   - **Écart avec le mapping naïf "sortie_lot → mouvement"** : à première
--     lecture de la section 19 on pourrait vouloir générer le mouvement au
--     moment où le lot est PESÉ (`sortie_lot`, quand il quitte physiquement
--     la section). Mais Sage compte le stock de produits fini/semi-fini en
--     PIÈCES, pas en kilos (`composition_taille` sur `article_lots`), et ce
--     nombre de pièces est connu dès la CRÉATION du lot, pas à sa pesée
--     (qui ne mesure qu'un poids, utile uniquement à la réconciliation
--     matière du tracé). D'où le choix de générer le mouvement à la création
--     du lot plutôt qu'à sa pesée.
--
--   - **`article_ref` nullable, sans FK** : polymorphe selon `type` —
--     `stock_item_view.sage_reference` pour sortie_mp/retour_mp (renseigné
--     par l'utilisateur au moment de la pesée, nouveau paramètre optionnel
--     de `record_pesee`), `product_models.sage_reference` pour
--     entree_semi_fini/entree_fini (déjà présent en base depuis la migration
--     0005, mais jusqu'ici jamais éditable depuis l'application — un éditeur
--     minimal est ajouté dans Paramètres > Modèles de produits par ce lot).
--     Pas de FK possible vers deux tables différentes selon le type, même
--     principe que `pesees.reference_id` (migration 0017).
--     Volontairement NULLABLE et non bloquant : `stock_item_view` démarre
--     vide (aucune synchronisation Sage réelle, section 7.1b) et de
--     nombreux modèles de produits n'auront pas encore de référence Sage
--     saisie — rendre le champ obligatoire casserait aujourd'hui le
--     fonctionnement déjà en production des pesées (lot 7). Un mouvement
--     sans article_ref reste visible et exportable ; à l'écran, il est
--     signalé comme incomplet plutôt que bloqué (repli acceptable, même
--     esprit que la section 20 pour la comparaison de stock).
--
--   - **Unité par type** : 'kg' pour sortie_mp/retour_mp (l'atelier travaille
--     au kilo, section 16), 'piece' pour entree_semi_fini/entree_fini (unité
--     de comptage Sage pour du semi-fini/fini) — pas de troisième unité
--     nécessaire aujourd'hui.
--
--   - **`sortie_semi_fini` : type conservé dans le schéma, mais aucune
--     source automatique aujourd'hui.** Il correspondrait à la consommation
--     d'un semi-fini par la section suivante (section 19), mais la pesée
--     (lot 7) et la création de lot (lot 6) ne portent aujourd'hui que sur
--     la section Coupe — la section qui "consomme" un semi-fini n'a encore
--     aucun événement enregistré en base (section 16 : "les autres sections
--     [montage...] restent une réflexion pour une prochaine session"). Le
--     type reste dans le CHECK pour rester fidèle au cahier des charges et
--     ne pas bloquer une migration future, mais restera vide en pratique
--     tant qu'un mécanisme de saisie pour les sections suivantes n'existe
--     pas — gap documenté, pas une omission.
--
--   - **Génération de la fiche réservée à responsable_production/
--     administrateur** : la fiche conditionne la sortie commerciale (BL,
--     section 19) — même périmètre d'autorité que `validate_production_
--     order` (lot 1), pas une action de chef de section.
--
--   - **Numérotation** : même mécanique que `article_lots.code`/
--     `sacs_dechets.code` (séquence + trigger), format `FMS-AAAA-NNNNN`
--     ("Fiche Mouvement de Stock").

-- ============================================================================
-- 1. TABLE `stock_export_fiches`
-- ============================================================================

create sequence stock_export_fiche_seq;

create table stock_export_fiches (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  production_order_id uuid not null references production_orders(id),
  generated_at timestamptz not null default now(),
  generated_by uuid references app_users(id)
);

create or replace function generate_stock_export_fiche_numero()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null then
    new.numero := 'FMS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('stock_export_fiche_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create trigger trg_generate_stock_export_fiche_numero
  before insert on stock_export_fiches
  for each row execute function generate_stock_export_fiche_numero();

create index idx_stock_export_fiches_odf on stock_export_fiches(production_order_id);

alter table stock_export_fiches enable row level security;

create policy stock_export_fiches_select on stock_export_fiches
  for select using (current_role_name() <> 'client');

-- ============================================================================
-- 2. TABLE `stock_movements`
-- ============================================================================

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references production_orders(id),
  type text not null check (type in ('sortie_mp', 'entree_semi_fini', 'sortie_semi_fini', 'entree_fini', 'retour_mp')),
  -- Polymorphe, sans FK — voir décision en tête de fichier.
  article_ref text,
  quantite_ou_poids numeric not null check (quantite_ou_poids > 0),
  unite text not null check (unite in ('kg', 'piece')),
  exported_in_fiche_id uuid references stock_export_fiches(id),
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create index idx_stock_movements_odf on stock_movements(production_order_id);

-- File des mouvements pas encore exportés : la requête la plus fréquente
-- (calcul de ce qu'une nouvelle fiche va reprendre), même principe que
-- idx_sacs_dechets_en_cours (lot 7).
create index idx_stock_movements_unexported on stock_movements(production_order_id) where exported_in_fiche_id is null;

alter table stock_movements enable row level security;

create policy stock_movements_select on stock_movements
  for select using (current_role_name() <> 'client');

-- ============================================================================
-- 3. `record_pesee()` — ajout du mouvement sortie_mp / retour_mp
-- ============================================================================
-- Reprise à l'identique (migration 0017) + nouveau paramètre optionnel
-- `p_article_ref`, en dernière position (défaut null) : aucun appel existant
-- ne casse. Non obligatoire — voir décision en tête de fichier.

create or replace function record_pesee(
  p_type text,
  p_production_order_id uuid,
  p_poids_kg numeric,
  p_reference_id uuid default null,
  p_article_ref text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_po_status production_order_status;
  v_reference_id uuid;
  v_id uuid;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la saisie de pesées est réservée à la section Coupe';
    end if;
  elsif v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : votre rôle ne permet pas de saisir une pesée';
  end if;

  if p_type not in ('reception_tissu', 'sortie_lot', 'retour_stock') then
    raise exception 'type de pesée invalide pour record_pesee (%) — un sac de déchets se pèse via record_bag_weighing', p_type;
  end if;

  select status into v_po_status from production_orders where id = p_production_order_id;
  if not found then
    raise exception 'ordre de fabrication introuvable';
  end if;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible d''enregistrer une pesée : cet ordre de fabrication est clôturé';
  end if;

  if p_poids_kg is null or p_poids_kg <= 0 then
    raise exception 'poids invalide (kg, > 0)';
  end if;

  -- reference_id n'a de sens que pour sortie_lot (le lot article pesé en
  -- sortie) — ignoré silencieusement pour les deux autres types, aucune
  -- entité amont à référencer.
  if p_type = 'sortie_lot' then
    if p_reference_id is null then
      raise exception 'référence du lot article obligatoire pour une pesée de type sortie_lot';
    end if;
    if not exists (
      select 1 from article_lots where id = p_reference_id and production_order_id = p_production_order_id
    ) then
      raise exception 'ce lot article n''appartient pas à cet ordre de fabrication';
    end if;
    v_reference_id := p_reference_id;
  else
    v_reference_id := null;
  end if;

  insert into pesees (type, reference_id, poids_kg, production_order_id, user_id)
  values (p_type, v_reference_id, p_poids_kg, p_production_order_id, auth.uid())
  returning id into v_id;

  -- Lot 10 : sortie_mp / retour_mp — sortie_lot n'a volontairement pas de
  -- pendant Sage ici, voir décision en tête de fichier.
  if p_type in ('reception_tissu', 'retour_stock') then
    insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
    values (
      p_production_order_id,
      case p_type when 'reception_tissu' then 'sortie_mp' else 'retour_mp' end,
      p_article_ref,
      p_poids_kg,
      'kg',
      auth.uid()
    );
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_pesee', 'pesee', v_id,
          jsonb_build_object('type', p_type, 'production_order_id', p_production_order_id,
                              'poids_kg', p_poids_kg, 'reference_id', v_reference_id,
                              'article_ref', p_article_ref));

  return v_id;
end;
$$;
revoke all on function record_pesee(text, uuid, numeric, uuid, text) from public, anon, authenticated;
grant execute on function record_pesee(text, uuid, numeric, uuid, text) to authenticated;

-- ============================================================================
-- 4. `create_article_lot()` — ajout du mouvement entree_semi_fini / entree_fini
-- ============================================================================
-- Reprise à l'identique (migration 0016) + génération du mouvement de stock
-- pour semi_fini/fini. Signature inchangée (aucun nouveau paramètre requis :
-- toute l'information nécessaire — composition, modèle de produit — est déjà
-- disponible via production_orders/product_models).

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
declare
  v_role user_role;
  v_section uuid;
  v_section_name text;
  v_lot article_lots;
  v_sage_reference text;
  v_total_pieces numeric;
begin
  select role, section_id into v_role, v_section from app_users where id = auth.uid();

  if v_role = 'chef_section' then
    select name into v_section_name from sections where id = v_section;
    if v_section_name <> 'Coupe' then
      raise exception 'accès refusé : la génération de lots est réservée à la section Coupe';
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
    where tp.id = p_trace_id and fp.odf_id = p_production_order_id
  ) then
    raise exception 'ce tracé n''appartient pas à cet ordre de fabrication';
  end if;

  insert into article_lots (production_order_id, trace_id, categorie, composition_taille, created_by)
  values (p_production_order_id, p_trace_id, p_categorie, coalesce(p_composition_taille, '{}'::jsonb), auth.uid())
  returning * into v_lot;

  -- Lot 10 : entree_semi_fini / entree_fini — dechet n'a volontairement pas
  -- de pendant Sage ici, voir décision en tête de fichier. Aucun mouvement
  -- si la composition par taille est vide (rien de quantifiable pour Sage
  -- à cet instant) : la composition n'est aujourd'hui pas modifiable après
  -- coup (lot 6), donc un lot créé sans composition n'aura jamais de
  -- mouvement — limite connue, pas traitée par ce lot.
  if p_categorie in ('semi_fini', 'fini') then
    select coalesce(sum(value::numeric), 0) into v_total_pieces
    from jsonb_each_text(coalesce(p_composition_taille, '{}'::jsonb));

    if v_total_pieces > 0 then
      select pm.sage_reference into v_sage_reference
      from production_orders po
      join product_models pm on pm.id = po.product_model_id
      where po.id = p_production_order_id;

      insert into stock_movements (production_order_id, type, article_ref, quantite_ou_poids, unite, created_by)
      values (
        p_production_order_id,
        case p_categorie when 'semi_fini' then 'entree_semi_fini' else 'entree_fini' end,
        v_sage_reference,
        v_total_pieces,
        'piece',
        auth.uid()
      );
    end if;
  end if;

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
-- 5. RPC `generate_stock_export_fiche()` (section 19)
-- ============================================================================
-- "Une fiche peut être générée à tout moment tant que l'ODF est ouvert, ne
-- reprend que les mouvements pas encore inclus dans une fiche précédente" —
-- livraisons partielles à Sage en cours de production.

create or replace function generate_stock_export_fiche(p_production_order_id uuid)
returns table (id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role user_role;
  v_fiche stock_export_fiches;
  v_count int;
begin
  select role into v_role from app_users where id = auth.uid();
  if v_role not in ('administrateur', 'responsable_production') then
    raise exception 'accès refusé : la génération d''une fiche d''export stock est réservée à la direction/production';
  end if;

  if not exists (select 1 from production_orders where id = p_production_order_id) then
    raise exception 'ordre de fabrication introuvable';
  end if;

  select count(*) into v_count from stock_movements
  where production_order_id = p_production_order_id and exported_in_fiche_id is null;
  if v_count = 0 then
    raise exception 'aucun mouvement de stock non exporté pour cet ordre de fabrication';
  end if;

  insert into stock_export_fiches (production_order_id, generated_by)
  values (p_production_order_id, auth.uid())
  returning * into v_fiche;

  update stock_movements
  set exported_in_fiche_id = v_fiche.id
  where production_order_id = p_production_order_id and exported_in_fiche_id is null;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'generate_stock_export_fiche', 'stock_export_fiche', v_fiche.id,
          jsonb_build_object('production_order_id', p_production_order_id, 'nb_mouvements', v_count));

  return query select v_fiche.id, v_fiche.numero;
end;
$$;
revoke all on function generate_stock_export_fiche(uuid) from public, anon, authenticated;
grant execute on function generate_stock_export_fiche(uuid) to authenticated;
