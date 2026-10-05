-- ============================================================================
-- 0094 — Demandes de devis venues du site www.seritex.ci
-- ============================================================================
--
-- Le formulaire du site public crée une DEMANDE dans la plateforme
-- (`requests`, source = 'site'), visible des commerciaux dans « Demandes ».
--
--   - Client déjà connu (e-mail d'un contact Seritex, ou e-mail d'une fiche
--     client, rattachés à UNE seule entreprise) : la demande est créée
--     directement sur ce client, comme une demande normale.
--   - Client inconnu : la demande est créée SANS client, avec les
--     coordonnées du prospect dans `requests.prospect`. Le commercial crée le
--     client dans Sage ; une fois la fiche synchronisée, il rattache la
--     demande à ce client depuis la fiche de la demande, puis fait le devis.
--
-- Pourquoi ne pas créer une fiche « prospect » dans `companies` ? La
-- synchronisation Sage crée elle-même la fiche du nouveau client : on aurait
-- deux fiches à fusionner. Ici, rien n'est dupliqué.
--
-- Depuis 0081, « company_id null » voulait dire « demande pour le stock ».
-- Une demande du site sans client a `prospect` renseigné : les politiques
-- « stock » l'excluent désormais explicitement.
-- ============================================================================

alter table requests add column if not exists prospect jsonb;

comment on column requests.prospect is
  'Demande du site web sans client rattaché : {"nom", "entreprise", "email", "telephone", "produit", "technique", "quantite", "date_souhaitee"}. '
  'Null pour toutes les autres demandes. Conservé après rattachement (historique).';

alter table requests drop constraint if exists requests_prospect_site;
alter table requests add constraint requests_prospect_site
  check (prospect is null or source = 'site');

create index if not exists idx_requests_site_sans_client
  on requests (created_at desc) where company_id is null and prospect is not null;

-- ----------------------------------------------------------------------------
-- 1. Visibilité : les demandes « stock » ne recouvrent plus les demandes du site
-- ----------------------------------------------------------------------------

drop policy if exists requests_select_stock on requests;
drop policy if exists requests_insert_stock on requests;
drop policy if exists requests_update_stock on requests;

create policy requests_select_stock on requests for select
  using (company_id is null and prospect is null and is_staff());
create policy requests_insert_stock on requests for insert
  with check (company_id is null and prospect is null and (is_commercial_or_above() or is_production_manager()));
create policy requests_update_stock on requests for update
  using (company_id is null and prospect is null and (is_commercial_or_above() or is_production_manager()))
  with check (company_id is null and prospect is null and (is_commercial_or_above() or is_production_manager()));

-- Demande du site pas encore rattachée : commerciaux et Direction seulement
-- (elle contient des données personnelles du prospect). Le rattachement à un
-- client passe par la politique requests_update existante (is_commercial_or_above).
create policy requests_select_site on requests for select
  using (company_id is null and prospect is not null and is_commercial_or_above());

-- ----------------------------------------------------------------------------
-- 2. Création depuis le site (clé service_role du site uniquement)
-- ----------------------------------------------------------------------------

create or replace function create_site_request(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p ->> 'email'));
  v_nom text := trim(p ->> 'nom');
  v_company uuid;
  v_contact uuid;
  v_ref text;
  v_id uuid;
  v_desc text;
  v_matches int;
begin
  if coalesce(v_nom, '') = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'demande du site incomplète (nom et e-mail obligatoires)';
  end if;

  -- Anti-abus : pas plus de 5 demandes par e-mail et par heure.
  if (select count(*) from requests
       where source = 'site' and created_at > now() - interval '1 hour'
         and lower(coalesce(prospect ->> 'email', '')) = v_email) >= 5 then
    raise exception 'trop de demandes envoyées avec cette adresse, réessayez plus tard';
  end if;

  -- Client connu ? D'abord par les contacts, sinon par l'e-mail de la fiche.
  -- On ne rattache que si une seule entreprise correspond (sinon : le
  -- commercial tranche à la main).
  select count(distinct ct.company_id), min(ct.company_id::text)::uuid
    into v_matches, v_company
    from contacts ct join companies co on co.id = ct.company_id
   where lower(ct.email) = v_email and co.sage_archived_at is null;
  if v_matches = 1 then
    select id into v_contact from contacts
     where company_id = v_company and lower(email) = v_email
     order by created_at limit 1;
  else
    v_company := null;
    select count(*), min(id::text)::uuid into v_matches, v_company
      from companies where lower(email) = v_email and sage_archived_at is null;
    if v_matches <> 1 then
      v_company := null;
    end if;
  end if;

  v_desc := concat_ws(E'\n',
    'Demande reçue depuis le site web.',
    'Produit : ' || nullif(p ->> 'produit_libelle', ''),
    'Quantité : ' || nullif(p ->> 'quantite', ''),
    'Technique souhaitée : ' || nullif(p ->> 'technique_libelle', ''),
    'Date souhaitée : ' || nullif(p ->> 'date_souhaitee', ''),
    case when v_company is null then
      'Prospect : ' || v_nom || coalesce(' — ' || nullif(p ->> 'entreprise', ''), '')
        || ' · ' || v_email || coalesce(' · ' || nullif(p ->> 'telephone', ''), '')
    end,
    nullif(E'\n' || coalesce(p ->> 'message', ''), E'\n')
  );

  v_ref := next_internal_number('WEB');

  insert into requests (reference, company_id, contact_id, status, source, description, needs_graphics, prospect)
  values (
    v_ref, v_company, v_contact, 'nouvelle', 'site', left(v_desc, 4000), false,
    jsonb_build_object(
      'nom', v_nom,
      'entreprise', nullif(trim(p ->> 'entreprise'), ''),
      'email', v_email,
      'telephone', nullif(trim(p ->> 'telephone'), ''),
      'produit', nullif(p ->> 'produit_libelle', ''),
      'technique', nullif(p ->> 'technique_libelle', ''),
      'quantite', nullif(p ->> 'quantite', ''),
      'date_souhaitee', nullif(p ->> 'date_souhaitee', '')
    )
  )
  returning id into v_id;

  insert into audit_log (user_id, action, entity_type, entity_id, metadata)
  values (null, 'create_site_request', 'request', v_id,
          jsonb_build_object('reference', v_ref, 'client_reconnu', v_company is not null));

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'client_reconnu', v_company is not null);
end;
$$;

revoke all on function create_site_request(jsonb) from public, anon, authenticated;
grant execute on function create_site_request(jsonb) to service_role;
