-- ============================================================================
-- 0167 — L'administrateur modifie une proforma acceptée, jusqu'à l'ODF
-- ============================================================================
--
-- Décision du 2026-11-10 : l'administrateur peut modifier une proforma déjà
-- acceptée, à condition que l'ODF né de son acceptation soit encore en
-- brouillon ; la modification est reportée sur l'ODF. Le motif est
-- obligatoire et tracé.
--
-- Déroulé (une seule action côté application) :
--   1. ouvrir_modification_devis(devis, motif) : contrôle (administrateur,
--      devis accepté, ODF en brouillon) et ouvre la modification ;
--   2. l'application réécrit les lignes avec le formulaire de correction
--      existant — les verrous « devis envoyé » (impressions, prix par taille,
--      répartition) laissent passer l'administrateur tant que la modification
--      est ouverte ; une ligne retirée passe par retirer_ligne_devis_modifie()
--      qui retire aussi l'article d'ODF correspondant ;
--   3. appliquer_modification_devis(devis) : contrôle de configuration
--      (0166) et de répartition, report sur l'ODF (modèle, désignation,
--      quantité, couleurs, impressions, tailles ; nouveaux articles ajoutés),
--      quantité totale de l'ODF, puis fermeture et trace.
-- Tant que la modification est ouverte, l'ODF ne peut pas être soumis.
--
-- Rien ne change pour Sage : le devis Sage d'origine (miroir en lecture) n'est
-- pas touché.
-- ============================================================================

alter table quotes
  add column if not exists modification_ouverte_le timestamptz,
  add column if not exists modification_ouverte_par uuid references app_users(id),
  add column if not exists modification_motif text,
  add column if not exists modifie_apres_acceptation_le timestamptz,
  add column if not exists modifie_apres_acceptation_par uuid references app_users(id),
  add column if not exists modifie_apres_acceptation_motif text;

comment on column quotes.modification_ouverte_le is
  'Modification d''une proforma acceptée en cours (0167) : renseignée entre ouvrir_modification_devis et appliquer_modification_devis.';
comment on column quotes.modifie_apres_acceptation_motif is
  'Motif de la dernière modification après acceptation (0167), affiché sur le devis.';

create or replace function devis_en_modification(p_quote_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from quotes where id = p_quote_id and status = 'accepte' and modification_ouverte_le is not null);
$$;

revoke all on function devis_en_modification(uuid) from public, anon, authenticated;
grant execute on function devis_en_modification(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 1. VERROUS « DEVIS ENVOYÉ » : l'administrateur passe pendant la modification
-- ----------------------------------------------------------------------------

create or replace function guard_quote_line_printable_zones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line_id uuid := coalesce(new.quote_line_id, old.quote_line_id);
  v_model uuid;
  v_status quote_status;
  v_quote uuid;
begin
  -- Pas de session utilisateur (migration, service_role, seed) : non soumis.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select ql.product_model_id, q.status, q.id into v_model, v_status, v_quote
  from quote_lines ql join quotes q on q.id = ql.quote_id
  where ql.id = v_line_id;

  -- Ligne déjà supprimée : suppression en cascade, rien à protéger.
  if not found then
    return coalesce(new, old);
  end if;

  if v_status not in ('brouillon', 'en_validation_interne')
     and not (devis_en_modification(v_quote) and is_admin()) then
    raise exception 'Les impressions d''un devis envoyé au client ne se modifient plus (statut : %).', v_status;
  end if;

  if tg_op <> 'DELETE' and not exists (
    select 1 from product_printable_zones pz
    where pz.id = new.printable_zone_id and pz.product_model_id = v_model
  ) then
    raise exception 'Cet emplacement d''impression n''appartient pas au modèle de produit de la ligne.';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function guard_quote_line_size_prices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status quote_status;
  v_quote uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select q.status, q.id into v_status, v_quote
  from quote_lines ql join quotes q on q.id = ql.quote_id
  where ql.id = coalesce(new.quote_line_id, old.quote_line_id);
  if not found then
    return coalesce(new, old); -- suppression en cascade
  end if;
  if v_status not in ('brouillon', 'en_validation_interne')
     and not (devis_en_modification(v_quote) and is_admin()) then
    raise exception 'Les prix d''un devis envoyé au client ne se modifient plus (statut : %).', v_status;
  end if;
  return coalesce(new, old);
end;
$$;

-- set_quote_line_sizes : reprise de 0109 à l'identique, plus la branche
-- « proforma acceptée en modification » réservée à l'administrateur.
CREATE OR REPLACE FUNCTION public.set_quote_line_sizes(p_quote_line_id uuid, p_sizes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line quote_lines;
  v_quote quotes;
  v_entry record;
  v_qty int;
  v_total int := 0;
  v_restricted boolean;
  v_priced boolean;
begin
  select * into v_line from quote_lines where id = p_quote_line_id for update;
  if not found then
    raise exception 'ligne de devis introuvable';
  end if;
  select * into v_quote from quotes where id = v_line.quote_id;

  if v_quote.status in ('brouillon', 'en_validation_interne') then
    if not has_permission('devis', 'modify') then
      raise exception 'accès refusé';
    end if;
  elsif v_quote.status = 'envoye' then
    if not (has_permission('devis', 'modify') or is_client_of(v_quote.company_id)) then
      raise exception 'accès refusé : ce devis ne vous appartient pas';
    end if;
  elsif devis_en_modification(v_quote.id) then
    -- 0167 : proforma acceptée rouverte par l'administrateur.
    if not is_admin() then
      raise exception 'accès refusé : seul l''administrateur modifie une proforma acceptée';
    end if;
  else
    raise exception 'la répartition d''un devis % ne se modifie plus', v_quote.status;
  end if;

  if p_sizes is null or jsonb_typeof(p_sizes) <> 'object' then
    raise exception 'répartition invalide';
  end if;

  select exists (select 1 from product_model_sizes where product_model_id = v_line.product_model_id)
  into v_restricted;
  select exists (select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id)
  into v_priced;

  for v_entry in select key, value from jsonb_each(p_sizes)
  loop
    if jsonb_typeof(v_entry.value) <> 'number' then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    v_qty := (v_entry.value #>> '{}')::numeric;
    if v_qty::numeric <> (v_entry.value #>> '{}')::numeric or v_qty < 0 then
      raise exception 'quantité invalide pour la taille %', v_entry.key;
    end if;
    if v_qty = 0 then
      continue;
    end if;
    if not exists (select 1 from sizes s where s.cle = v_entry.key and s.active) then
      raise exception 'taille inconnue ou désactivée : %', v_entry.key;
    end if;
    if v_restricted and not exists (
      select 1 from product_model_sizes pms join sizes s on s.id = pms.size_id
      where pms.product_model_id = v_line.product_model_id and s.cle = v_entry.key
    ) then
      raise exception 'la taille % n''existe pas pour ce modèle', v_entry.key;
    end if;
    if v_priced and not exists (
      select 1 from quote_line_size_prices where quote_line_id = p_quote_line_id and taille = v_entry.key
    ) then
      raise exception 'article « % » : aucun prix n''est prévu pour la taille %', v_line.description, v_entry.key;
    end if;
    v_total := v_total + v_qty;
  end loop;

  if v_total > v_line.quantity then
    raise exception 'article « % » : la répartition totalise % pièces pour % commandées', v_line.description, v_total, v_line.quantity;
  end if;
  if v_quote.status = 'envoye' and v_total <> v_line.quantity then
    raise exception 'article « % » : la répartition doit totaliser % pièces (actuellement %)', v_line.description, v_line.quantity, v_total;
  end if;

  delete from quote_line_sizes where quote_line_id = p_quote_line_id;
  insert into quote_line_sizes (quote_line_id, taille, quantite)
  select p_quote_line_id, e.key, (e.value #>> '{}')::int
  from jsonb_each(p_sizes) e
  where (e.value #>> '{}')::int > 0;

  -- PU moyen de la ligne chiffrée par taille (lu par line_total et les écrans).
  if v_priced and v_total > 0 then
    update quote_lines ql
    set unit_price = round((
      select sum(qls.quantite * qsp.prix)
      from quote_line_sizes qls
      join quote_line_size_prices qsp on qsp.quote_line_id = qls.quote_line_id and qsp.taille = qls.taille
      where qls.quote_line_id = p_quote_line_id
    ) / v_total, 2)
    where ql.id = p_quote_line_id;
  end if;

  if v_quote.status = 'envoye' then
    insert into audit_log (user_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'set_quote_line_sizes', 'quote', v_quote.id,
            jsonb_build_object('quote_line_id', p_quote_line_id, 'repartition', p_sizes));
  end if;
end;
$function$;
-- ----------------------------------------------------------------------------
-- 2. OUVRIR LA MODIFICATION
-- ----------------------------------------------------------------------------

create or replace function ouvrir_modification_devis(p_quote_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_po production_orders;
begin
  if not is_admin() then
    raise exception 'accès refusé : seul l''administrateur modifie une proforma acceptée';
  end if;
  if nullif(btrim(coalesce(p_motif, '')), '') is null then
    raise exception 'le motif de la modification est obligatoire';
  end if;
  select * into v_quote from quotes where id = p_quote_id for update;
  if not found then
    raise exception 'devis introuvable';
  end if;
  if v_quote.status <> 'accepte' then
    raise exception 'seule une proforma acceptée se modifie ainsi (statut actuel : %)', v_quote.status;
  end if;
  select * into v_po from production_orders where quote_id = p_quote_id order by created_at desc limit 1 for update;
  if found and v_po.status <> 'brouillon' then
    raise exception 'l''ODF % n''est plus en brouillon : la proforma ne peut plus être modifiée', v_po.reference;
  end if;

  update quotes
  set modification_ouverte_le = coalesce(modification_ouverte_le, now()),
      modification_ouverte_par = auth.uid(),
      modification_motif = btrim(p_motif)
  where id = p_quote_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ouvrir_modification_devis', 'quote', p_quote_id, jsonb_build_object('motif', btrim(p_motif)));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. RETIRER UNE LIGNE (et l'article d'ODF qui en est né)
-- ----------------------------------------------------------------------------

create or replace function retirer_ligne_devis_modifie(p_quote_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line quote_lines;
begin
  if not is_admin() then
    raise exception 'accès refusé : seul l''administrateur modifie une proforma acceptée';
  end if;
  select * into v_line from quote_lines where id = p_quote_line_id;
  if not found then
    return;
  end if;
  if not devis_en_modification(v_line.quote_id) then
    raise exception 'aucune modification ouverte sur ce devis';
  end if;
  begin
    delete from production_order_lines pol
    using production_orders po
    where pol.quote_line_id = p_quote_line_id and po.id = pol.production_order_id and po.status = 'brouillon';
    delete from quote_lines where id = p_quote_line_id;
  exception when foreign_key_violation then
    raise exception 'l''article « % » est déjà utilisé (fiche de placement, échantillon…) : retirez ce lien avant de supprimer la ligne', v_line.description;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. APPLIQUER : contrôle, report sur l'ODF, fermeture
-- ----------------------------------------------------------------------------

create or replace function appliquer_modification_devis(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote quotes;
  v_po production_orders;
  v_line quote_lines;
  v_pol_id uuid;
  v_msg text;
begin
  if not is_admin() then
    raise exception 'accès refusé : seul l''administrateur modifie une proforma acceptée';
  end if;
  select * into v_quote from quotes where id = p_quote_id for update;
  if not found or v_quote.status <> 'accepte' or v_quote.modification_ouverte_le is null then
    raise exception 'aucune modification ouverte sur ce devis';
  end if;
  select * into v_po from production_orders where quote_id = p_quote_id order by created_at desc limit 1 for update;
  if found and v_po.status <> 'brouillon' then
    raise exception 'l''ODF % n''est plus en brouillon : la modification ne peut plus y être reportée', v_po.reference;
  end if;

  perform assert_quote_dispatch_complete(p_quote_id);
  select string_agg(x.article || ' : ' || x.a, ' ; ')
  into v_msg
  from (select ql.description as article, a
        from quote_lines ql
        cross join lateral anomalies_configuration_ligne_devis(ql.id) a
        where ql.quote_id = p_quote_id
        order by ql.description, a
        limit 5) x;
  if v_msg is not null then
    raise exception 'Configuration incomplète, la modification ne peut pas être enregistrée — %', v_msg;
  end if;

  if v_po.id is not null then
    for v_line in select * from quote_lines where quote_id = p_quote_id
    loop
      select id into v_pol_id from production_order_lines
      where production_order_id = v_po.id and quote_line_id = v_line.id;

      if v_pol_id is null then
        insert into production_order_lines (
          production_order_id, quote_line_id, product_model_id, description, quantity, couleur_unique_id, textile_id
        ) values (
          v_po.id, v_line.id, v_line.product_model_id, v_line.description, v_line.quantity, v_line.couleur_unique_id, v_line.textile_id
        ) returning id into v_pol_id;
      else
        update production_order_lines
        set product_model_id = v_line.product_model_id,
            description = v_line.description,
            quantity = v_line.quantity,
            couleur_unique_id = v_line.couleur_unique_id,
            textile_id = v_line.textile_id
        where id = v_pol_id;
        delete from production_order_line_zone_colors where production_order_line_id = v_pol_id;
        delete from production_order_line_printable_zones where production_order_line_id = v_pol_id;
        delete from production_order_sizes where production_order_line_id = v_pol_id;
      end if;

      insert into production_order_line_zone_colors (production_order_line_id, zone_key, color_id)
      select v_pol_id, c.zone_key, c.color_id from quote_line_zone_colors c where c.quote_line_id = v_line.id;

      insert into production_order_line_printable_zones (production_order_line_id, printable_zone_id, nb_couleurs)
      select v_pol_id, z.printable_zone_id, z.nb_couleurs from quote_line_printable_zones z where z.quote_line_id = v_line.id;

      insert into production_order_sizes (production_order_line_id, taille, quantite_demandee)
      select v_pol_id, s.taille, s.quantite from quote_line_sizes s where s.quote_line_id = v_line.id;
    end loop;

    -- Même convention qu'accept_quote : modèle de l'ODF seulement s'il est unique.
    update production_orders
    set total_quantity = (select coalesce(sum(quantity), 0) from quote_lines where quote_id = p_quote_id),
        product_model_id = (select min(product_model_id::text)::uuid from quote_lines
                            where quote_id = p_quote_id and product_model_id is not null
                            having count(distinct product_model_id) = 1)
    where id = v_po.id;
  end if;

  update quotes
  set modifie_apres_acceptation_le = now(),
      modifie_apres_acceptation_par = auth.uid(),
      modifie_apres_acceptation_motif = modification_motif,
      modification_ouverte_le = null,
      modification_ouverte_par = null,
      modification_motif = null
  where id = p_quote_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'modifier_devis_accepte', 'quote', p_quote_id,
          jsonb_build_object('motif', v_quote.modification_motif, 'production_order_id', v_po.id));

  return v_po.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. PAS DE SOUMISSION D'ODF PENDANT UNE MODIFICATION DE SA PROFORMA
-- ----------------------------------------------------------------------------

create or replace function guard_odf_devis_en_modification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.status = 'en_attente_validation'
     and new.quote_id is not null and devis_en_modification(new.quote_id) then
    raise exception 'la proforma de cet ODF est en cours de modification : terminez-la avant de soumettre l''ODF';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_odf_devis_en_modification on production_orders;
create trigger trg_guard_odf_devis_en_modification
  before update of status on production_orders
  for each row execute function guard_odf_devis_en_modification();

revoke all on function ouvrir_modification_devis(uuid, text) from public, anon, authenticated;
revoke all on function retirer_ligne_devis_modifie(uuid) from public, anon, authenticated;
revoke all on function appliquer_modification_devis(uuid) from public, anon, authenticated;
revoke all on function guard_odf_devis_en_modification() from public, anon, authenticated;
grant execute on function ouvrir_modification_devis(uuid, text) to authenticated;
grant execute on function retirer_ligne_devis_modifie(uuid) to authenticated;
grant execute on function appliquer_modification_devis(uuid) to authenticated;
