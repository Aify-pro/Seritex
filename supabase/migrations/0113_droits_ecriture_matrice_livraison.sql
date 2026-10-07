-- ============================================================================
-- 0113 — Droits d'écriture pilotés par la matrice : livraison
-- ============================================================================
-- Lot 4 sur 6. Piloter les expéditions, les tournées, les lieux, les
-- transporteurs, les véhicules et les zones dépendait de « responsable livraison
-- ou administrateur » (et du commercial pour les lieux) codés en dur.
--
--   1. Nouveau module `lieux_livraison` : les lieux de livraison d'un client
--      sont aussi tenus par le commercial. Jusqu'ici, ce droit se lisait à tort
--      dans « livraisons / modifier » (migration 0075 le donnait au commercial) ;
--      ce droit devient celui du PILOTAGE des expéditions, comme la base le
--      faisait déjà, et les lieux ont le leur.
--   2. Ouverture de la matrice (cases cochées en plus) + retrait, pour le
--      commercial seulement, de « livraisons / créer-modifier » : ce droit n'avait
--      qu'un effet, l'affichage de la gestion des lieux sur la fiche client, qui
--      passe à `lieux_livraison`. Sans ce retrait, le commercial gagnerait le
--      pilotage des expéditions.
--   3. Règles de sécurité : « gestion de la livraison » = livraisons / modifier ;
--      transporteurs, véhicules, zones = parametres_livraison ; lieux =
--      lieux_livraison. Le livreur garde ses règles propres (SES expéditions et
--      SES tournées) : c'est un rattachement à la personne, pas un droit.
--   4. Fonctions de livraison.
-- ============================================================================

-- 1. Module -----------------------------------------------------------------
insert into modules (key, label, description, display_order) values
  ('lieux_livraison', 'Lieux de livraison', 'Lieux de livraison des clients : création, modification, lieu par défaut, position', 59)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id)
select r.id, m.id from roles r cross join modules m
where m.key = 'lieux_livraison'
on conflict (role_id, module_id) do nothing;

-- 2. Matrice ----------------------------------------------------------------
create temporary table _seed_droits (module_key text, action text, base_roles text[]);
insert into _seed_droits values
  ('livraisons',           'modify', array['responsable_livraison', 'administrateur']),
  ('livraisons',           'create', array['responsable_livraison', 'administrateur']),
  ('lieux_livraison',      'view',   array['commercial', 'responsable_livraison', 'administrateur', 'responsable_production']),
  ('lieux_livraison',      'create', array['commercial', 'responsable_livraison', 'administrateur']),
  ('lieux_livraison',      'modify', array['commercial', 'responsable_livraison', 'administrateur']),
  ('lieux_livraison',      'delete', array['administrateur']),
  ('parametres_livraison', 'create', array['responsable_livraison', 'administrateur']),
  ('parametres_livraison', 'modify', array['responsable_livraison', 'administrateur']),
  ('parametres_livraison', 'delete', array['administrateur']);

do $$
declare
  s record;
  v_col text;
begin
  for s in select * from _seed_droits loop
    v_col := case s.action when 'view' then 'can_view' when 'create' then 'can_create' when 'modify' then 'can_modify' when 'delete' then 'can_delete' end;
    execute format(
      'update role_permissions rp set %I = true from roles r, modules m
        where rp.role_id = r.id and rp.module_id = m.id and m.key = %L and r.base_role::text = any (%L::text[])',
      v_col, s.module_key, s.base_roles);
  end loop;
end $$;

drop table _seed_droits;

-- Le droit du commercial sur les LIEUX est passé sur son module : on lui retire
-- celui qui ouvrirait le pilotage des expéditions.
update role_permissions rp
set can_create = false, can_modify = false
from roles r, modules m
where rp.role_id = r.id and rp.module_id = m.id and m.key = 'livraisons' and r.base_role = 'commercial';

-- 3. Règles de sécurité -------------------------------------------------------
do $$
declare
  c record;
  p record;
  v_act text;
  v_qual text;
  v_check text;
  v_sql text;
  v_changed int;
  cfg jsonb := '[
    {"t":"shipments",            "m":"livraisons", "ct":"mod"},
    {"t":"shipment_packages",    "m":"livraisons", "ct":"mod"},
    {"t":"delivery_rounds",      "m":"livraisons", "ct":"mod"},
    {"t":"delivery_round_stops", "m":"livraisons", "ct":"mod"},
    {"t":"delivery_places",      "m":"lieux_livraison", "commercial":true},
    {"t":"carriers",             "m":"parametres_livraison"},
    {"t":"vehicles",             "m":"parametres_livraison"},
    {"t":"delivery_zones",       "m":"parametres_livraison"}
  ]';
begin
  for c in select * from jsonb_to_recordset(cfg) as x(t text, m text, ct text, commercial boolean) loop
    v_changed := 0;
    for p in select * from pg_policies where schemaname = 'public' and tablename = c.t loop
      continue when p.cmd = 'SELECT';
      continue when coalesce(p.qual, '') || coalesce(p.with_check, '') like '%has_permission(%';

      -- Tables opérationnelles : toute écriture de gestion = Modifier ; référentiels : Créer / Modifier / Supprimer.
      v_act := case when c.ct = 'mod' then 'modify'
                    when p.cmd = 'INSERT' then 'create' when p.cmd = 'DELETE' then 'delete' else 'modify' end;
      v_qual := p.qual;
      v_check := p.with_check;

      -- « gestion de la livraison OU administrateur » (ou commercial pour les lieux) devient un seul droit.
      v_qual  := replace(v_qual,  'is_delivery_manager() OR is_admin()', format('has_permission(%L, %L)', c.m, v_act));
      v_check := replace(v_check, 'is_delivery_manager() OR is_admin()', format('has_permission(%L, %L)', c.m, v_act));
      if coalesce(c.commercial, false) then
        v_qual  := replace(v_qual,  'is_delivery_manager() OR is_commercial_or_above()', format('has_permission(%L, %L)', c.m, v_act));
        v_check := replace(v_check, 'is_delivery_manager() OR is_commercial_or_above()', format('has_permission(%L, %L)', c.m, v_act));
      end if;
      -- Suppression réservée à l'administrateur : « Supprimer » du module.
      if p.cmd = 'DELETE' then
        v_qual := replace(v_qual, 'is_admin()', format('has_permission(%L, ''delete'')', c.m));
      end if;

      continue when v_qual is not distinct from p.qual and v_check is not distinct from p.with_check;
      if (coalesce(v_qual, '') || coalesce(v_check, '')) ~ 'is_delivery_manager\(\)' then
        raise exception 'livraison : contrôle de rôle restant dans la règle % de % : % %', p.policyname, p.tablename, v_qual, v_check;
      end if;

      v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
      if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
      v_changed := v_changed + 1;
    end loop;
    raise notice 'droits-matrice : % règle(s) adaptée(s) sur %', v_changed, c.t;
  end loop;
end $$;

-- 4. Fonctions ----------------------------------------------------------------
-- Mêmes définitions qu'avant ; seul le contrôle de rôle est remplacé par le droit de la matrice.

-- assert_delivery_manager
CREATE OR REPLACE FUNCTION public.assert_delivery_manager()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_permission('livraisons', 'modify') then
    raise exception 'accès refusé : réservé au service livraison';
  end if;
end;
$function$;

-- assign_package_lot
CREATE OR REPLACE FUNCTION public.assign_package_lot(p_package_id uuid, p_lot_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pkg shipment_packages;
  v_lot article_lots;
  v_ok boolean;
begin
  if not (has_permission('livraisons', 'modify') or has_permission('ordres_fabrication', 'modify')) then
    raise exception 'accès refusé : réservé au service livraison et à la production';
  end if;
  select * into v_pkg from shipment_packages where id = p_package_id;
  if not found then
    raise exception 'colis introuvable';
  end if;
  if p_lot_code is null or btrim(p_lot_code) = '' then
    update shipment_packages set article_lot_id = null, code_qr = null where id = p_package_id;
    return;
  end if;
  v_lot := find_article_lot(p_lot_code);
  select exists (
    select 1 from shipment_lines sl
    where sl.shipment_id = v_pkg.shipment_id
      and (sl.production_order_line_id = v_lot.production_order_line_id
           or (v_lot.production_order_line_id is null
               and v_lot.production_order_id = (select production_order_id from production_order_lines where id = sl.production_order_line_id)))
  ) into v_ok;
  if not v_ok then
    raise exception 'le lot % ne correspond à aucun article de cette expédition', v_lot.code;
  end if;

  update shipment_packages set article_lot_id = v_lot.id, code_qr = v_lot.code where id = p_package_id;
  update article_lots set statut = 'expedie' where id = v_lot.id and statut in ('en_cours', 'termine');
  insert into article_lot_events (article_lot_id, type, shipment_id, detail, created_by)
  values (v_lot.id, 'mise_en_colis', v_pkg.shipment_id, jsonb_build_object('colis', v_pkg.numero), auth.uid());
end;
$function$;

-- create_shipment_confirmation
CREATE OR REPLACE FUNCTION public.create_shipment_confirmation(p_shipment_id uuid, p_jours integer DEFAULT 30)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_s shipments;
  v_token text;
begin
  select * into v_s from shipments where id = p_shipment_id;
  if not found then
    raise exception 'expédition introuvable';
  end if;
  if not (has_permission('livraisons', 'modify') or (is_livreur() and v_s.livreur_id = auth.uid())) then
    raise exception 'accès refusé';
  end if;
  if v_s.statut not in ('livree', 'enlevee') then
    raise exception 'la confirmation de réception se demande une fois l''expédition livrée ou enlevée';
  end if;
  v_token := encode(gen_random_bytes(24), 'hex');
  insert into shipment_confirmations (shipment_id, token_hash, expires_at, created_by)
  values (p_shipment_id, encode(digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => greatest(p_jours, 1)), auth.uid());
  return v_token;
end;
$function$;

-- record_delivery_place_position
CREATE OR REPLACE FUNCTION public.record_delivery_place_position(p_place_id uuid, p_latitude numeric, p_longitude numeric, p_source text DEFAULT 'gps_terrain'::text, p_confirmee boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (has_permission('lieux_livraison', 'modify') or (is_livreur() and livreur_voit_lieu(p_place_id))) then
    raise exception 'accès refusé : ce lieu ne fait pas partie de vos livraisons';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'coordonnées invalides';
  end if;
  if p_source not in ('gps_terrain', 'carte', 'approximative') then
    raise exception 'origine de position invalide : %', p_source;
  end if;
  if is_livreur() and p_source <> 'gps_terrain' then
    raise exception 'le livreur enregistre uniquement une position GPS prise sur place';
  end if;

  update delivery_places
  set latitude = round(p_latitude, 6),
      longitude = round(p_longitude, 6),
      position_source = p_source,
      position_confirmee_at = case when p_confirmee then now() else null end,
      position_confirmee_by = case when p_confirmee then auth.uid() else null end
  where id = p_place_id;
  if not found then
    raise exception 'lieu de livraison introuvable';
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'record_delivery_place_position', 'delivery_place', p_place_id,
          jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude, 'source', p_source));
end;
$function$;

-- record_shipment_document
CREATE OR REPLACE FUNCTION public.record_shipment_document(p_shipment_id uuid, p_type text, p_path text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not (has_permission('livraisons', 'modify') or livreur_voit_expedition(p_shipment_id)) then
    raise exception 'accès refusé : cette livraison ne vous est pas confiée';
  end if;
  if p_type not in ('decharge_bl', 'photo', 'autre') then
    raise exception 'type de document invalide';
  end if;
  if p_path is null or p_path not like 'expeditions/' || p_shipment_id::text || '/%' then
    raise exception 'chemin de fichier invalide';
  end if;
  insert into shipment_documents (shipment_id, type, path, latitude, longitude, created_by)
  values (p_shipment_id, p_type, p_path, p_latitude, p_longitude, auth.uid())
  returning id into v_id;
  perform log_shipment_event(p_shipment_id, (select statut from shipments where id = p_shipment_id),
    case p_type when 'decharge_bl' then 'Photo du BL signé déposée' when 'photo' then 'Photo déposée' else 'Document déposé' end,
    case when is_livreur() then 'livreur' else 'app' end, p_latitude, p_longitude);
  return v_id;
end;
$function$;

-- set_default_delivery_place
CREATE OR REPLACE FUNCTION public.set_default_delivery_place(p_place_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
begin
  if not has_permission('lieux_livraison', 'modify') then
    raise exception 'accès refusé : votre rôle ne permet pas de modifier les lieux de livraison';
  end if;
  select company_id into v_company from delivery_places where id = p_place_id and actif;
  if v_company is null then
    raise exception 'lieu de livraison introuvable ou inactif';
  end if;
  update delivery_places set par_defaut = false where company_id = v_company and id <> p_place_id and par_defaut;
  update delivery_places set par_defaut = true where id = p_place_id;
end;
$function$;

-- set_shipment_status
CREATE OR REPLACE FUNCTION public.set_shipment_status(p_shipment_id uuid, p_statut text, p_commentaire text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric, p_receptionnaire text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s shipments;
  v_livreur boolean;
  v_source text;
begin
  select * into v_s from shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'expédition introuvable';
  end if;
  v_livreur := is_livreur() and v_s.livreur_id = auth.uid();
  if not (has_permission('livraisons', 'modify') or v_livreur) then
    raise exception 'accès refusé : cette livraison ne vous est pas confiée';
  end if;
  v_source := case when v_livreur then 'livreur' else 'app' end;

  if p_statut = 'en_route' and v_s.statut = 'planifiee' then
    null;
  elsif p_statut in ('livree', 'echec') and v_s.statut = 'en_route' then
    if p_statut = 'echec' and nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif de l''échec obligatoire';
    end if;
    if p_statut = 'livree' and not exists (
      select 1 from shipment_documents where shipment_id = p_shipment_id and type = 'decharge_bl'
    ) then
      raise exception 'photo du BL signé obligatoire pour passer en « livrée »';
    end if;
  elsif p_statut = 'enlevee' and v_s.statut = 'prete_a_enlever' and not v_livreur then
    if nullif(btrim(coalesce(p_receptionnaire, '')), '') is null then
      raise exception 'nom de la personne qui enlève obligatoire (elle signe le BL)';
    end if;
  elsif p_statut = 'litige' and v_s.statut in ('livree', 'enlevee', 'reception_confirmee') and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'décrivez le litige';
    end if;
  elsif p_statut = 'annulee' and v_s.statut in ('a_preparer', 'preparee', 'validee_compta', 'planifiee', 'prete_a_enlever', 'echec')
        and not v_livreur then
    if nullif(btrim(coalesce(p_commentaire, '')), '') is null then
      raise exception 'motif d''annulation obligatoire';
    end if;
  else
    raise exception 'passage de « % » à « % » impossible', v_s.statut, p_statut;
  end if;

  update shipments set
    statut = p_statut,
    livree_at = case when p_statut in ('livree', 'enlevee') then now() else livree_at end,
    receptionnaire_nom = case when p_statut in ('livree', 'enlevee') then coalesce(nullif(btrim(p_receptionnaire), ''), receptionnaire_nom) else receptionnaire_nom end,
    motif_echec = case when p_statut = 'echec' then btrim(p_commentaire) else motif_echec end
  where id = p_shipment_id;

  if p_statut in ('livree', 'enlevee') then
    update shipment_lines set quantite_livree = coalesce(quantite_livree, quantite) where shipment_id = p_shipment_id;
    perform on_shipment_delivered(p_shipment_id);
  end if;

  -- Une expédition annulée ou en échec quitte sa tournée.
  if p_statut in ('annulee', 'echec') then
    delete from delivery_round_stops where shipment_id = p_shipment_id;
  end if;

  perform log_shipment_event(p_shipment_id, p_statut, p_commentaire, v_source, p_latitude, p_longitude);
end;
$function$;

