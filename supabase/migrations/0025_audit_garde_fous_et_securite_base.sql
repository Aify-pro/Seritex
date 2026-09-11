-- ============================================================================
-- Seritex — Correctifs de l'audit des 12 lots (10/09/2026), volet base
-- Réf. : audit « Audit des 12 lots Seritex », constats A3, G1, G2, G3
-- ============================================================================
--
-- Quatre corrections indépendantes, aucune fonctionnelle : elles ferment des
-- portes restées ouvertes, elles n'ouvrent rien. Aucun écran ne change, aucun
-- parcours utilisateur existant n'est modifié.
--
--   1. Symétrie du verrou Coupe : record_work_order_quantity() refuse la
--      section Coupe, comme close_matelas() refuse tout ce qui n'est pas la
--      Coupe (constat A3).
--   2. Trois fonctions SECURITY DEFINER héritées restaient exécutables par
--      `anon` (constat G1).
--   3. Quatre générateurs de numéros sans search_path figé (constat G2).
--   4. patronnage_compteur_ot : RLS activée sans aucune policy — état rendu
--      explicite (constat G3).

-- ============================================================================
-- 1. VERROU COUPE — record_work_order_quantity() (constat A3, lot 4)
-- ============================================================================
-- Le lot 4 demandait que la quantité de la section Coupe soit calculée depuis
-- les tracés clôturés et « remplace toute saisie manuelle pour cette section
-- spécifiquement ». Le terminal le fait déjà (liste des matelas à clôturer au
-- lieu du bouton « Ajouter une quantité »), mais la base ne l'imposait pas :
-- un appel direct à l'API REST pouvait gonfler quantity_done d'un sous-ODF
-- Coupe sans passer par le moindre matelas — donc sans poids de déchet, sans
-- justification d'écart et sans anomalie.
--
-- close_matelas() porte déjà le contrôle inverse (« la clôture de matelas ne
-- s'applique qu'à la section Coupe ») : on rétablit la symétrie, dans l'esprit
-- du lot 2 — verrouiller au niveau RLS plutôt qu'uniquement côté application.
--
-- Recréée à l'identique de la version 0009, avec un seul ajout : le contrôle
-- de section, placé après le contrôle de rôle et avant toute écriture.

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
  v_section_name text;
  v_po_status production_order_status;
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

  -- Contrôle inverse de celui de close_matelas() : aucune saisie manuelle de
  -- quantité sur la Coupe, quel que soit le rôle. La quantité de cette section
  -- ne peut venir que d'une clôture de matelas (close_matelas), qui exige le
  -- poids de déchet et déclenche l'anomalie en cas d'écart.
  select name into v_section_name from sections where id = v_wo.section_id;
  if v_section_name = 'Coupe' then
    raise exception 'la quantité de la section Coupe ne se saisit pas à la main : elle est calculée à la clôture de chaque matelas';
  end if;

  if p_quantity = 0 then
    raise exception 'la quantité à ajouter ne peut pas être nulle';
  end if;

  select status into v_po_status from production_orders where id = v_wo.production_order_id;
  if v_po_status in ('terminee', 'annulee') then
    raise exception 'impossible de saisir une quantité : cet ordre de fabrication est clôturé';
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

-- Les droits d'exécution posés en 0009 survivent au create or replace, mais on
-- les réaffirme : une fonction recréée ne doit jamais dépendre de l'historique.
revoke all on function record_work_order_quantity(uuid, int, text) from public, anon, authenticated;
grant execute on function record_work_order_quantity(uuid, int, text) to authenticated;

-- ============================================================================
-- 2. FONCTIONS SECURITY DEFINER APPELABLES SANS ÊTRE CONNECTÉ (constat G1)
-- ============================================================================
-- Ces trois fonctions datent de la médiathèque (0003) et de l'échantillonnage
-- (0004), antérieures à la règle « revoke ... from anon » systématisée à
-- partir du lot 1 : elles n'ont jamais été rétroportées. Étant SECURITY
-- DEFINER, elles s'exécutent avec les droits du propriétaire — un appel non
-- authentifié à l'API REST les atteignait. Leur contrôle interne repose sur
-- auth.uid(), donc l'impact réel était faible, mais la porte n'a pas à rester
-- ouverte.

revoke all on function add_media_file(uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function add_media_file(uuid, text, text, text, bigint, text, text) to authenticated;

revoke all on function add_media_file_version(uuid, text, text, bigint, text, text) from public, anon;
grant execute on function add_media_file_version(uuid, text, text, bigint, text, text) to authenticated;

revoke all on function link_sample_to_production_order(uuid, uuid) from public, anon;
grant execute on function link_sample_to_production_order(uuid, uuid) to authenticated;

-- ============================================================================
-- 3. SEARCH_PATH FIGÉ SUR LES GÉNÉRATEURS DE NUMÉROS (constat G2)
-- ============================================================================
-- Quatre fonctions de trigger sans `set search_path` : generate_sample_number
-- (0004) et les trois générateurs des lots 6, 7 et 10. Elles ne sont pas
-- SECURITY DEFINER, donc le risque est théorique — mais un search_path non
-- figé reste une porte d'escalade classique (table ou séquence masquée dans un
-- schéma prioritaire) et le linter Supabase les remonte à chaque passage.
-- Corps strictement inchangés : seule la clause search_path est ajoutée.

create or replace function generate_sample_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sample_number is null then
    new.sample_number := 'ECH-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('sample_number_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function generate_article_lot_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code is null then
    new.code := 'LOT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('article_lot_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function generate_waste_bag_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.code is null then
    new.code := 'SAC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('waste_bag_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

create or replace function generate_stock_export_fiche_numero()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.numero is null then
    new.numero := 'FMS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('stock_export_fiche_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 4. patronnage_compteur_ot : REFUS EXPLICITE PLUTÔT QU'IMPLICITE (constat G3)
-- ============================================================================
-- La table est volontairement inaccessible : seule patronnage_prochain_numero_ot()
-- (SECURITY DEFINER) y touche. Mais « RLS activée, aucune policy » est un état
-- qui se lit comme un oubli — et le linter Supabase le signale comme tel.
-- On écrit l'intention : refus pour tout le monde, y compris un futur grant
-- posé par distraction.

drop policy if exists patronnage_compteur_ot_aucun_acces_direct on patronnage_compteur_ot;
create policy patronnage_compteur_ot_aucun_acces_direct on patronnage_compteur_ot
  for all using (false) with check (false);

comment on table patronnage_compteur_ot is
  'Séquence annuelle des numéros OT. Accessible uniquement via patronnage_prochain_numero_ot() (SECURITY DEFINER) : la policy de refus total est volontaire, pas un oubli.';
