-- ============================================================================
-- Seritex — Clients : Sage devient la source de vérité de l'identité client
-- ============================================================================
--
-- Contexte : le module Clients (commercial/clients) lit `companies`, alors que
-- la synchronisation Sage (pont Sage → NAS → Supabase) écrit dans
-- `sage_customers_view`, table miroir jamais reliée à `companies` — d'où une
-- liste limitée aux fiches créées à la main. Cette migration relie les deux :
--
--   Sage → NAS → sync.js → sage_customers_view (staging, inchangé)
--                                 │ sync_companies_from_sage()
--                                 ▼
--                           companies (+ sage_code)
--
-- `companies` reste LA fiche client de l'application (devis, ODF, contacts,
-- comptes portail et médiathèque pointent tous sur companies.id) : on ne la
-- remplace pas, on la fait alimenter par Sage.
--
-- Propriété des champs :
--   - Sage (lecture seule dans Seritex, protégés par trigger) : raison
--     sociale, SIRET, adresse, ville, CP, pays, téléphone, e-mail, site, TVA,
--     APE, classification Sage, statut actif/prospect.
--   - Seritex : contacts (table `contacts`), notes, comptes portail,
--     médiathèque — jamais touchés par la synchronisation.
--
-- Règles de sécurité de la synchronisation :
--   - une fiche n'est JAMAIS supprimée quand un client disparaît de Sage
--     (des devis / ODF peuvent s'y rattacher) : elle est archivée
--     (`sage_archived_at`) ;
--   - garde-fou : si `sage_customers_view` est vide (synchro en échec ou base
--     Sage indisponible), rien n'est archivé — la fonction s'arrête en erreur ;
--   - les fiches créées à la main (prospects, futurs clients du portail) ont
--     `origin <> 'sage'` et `sage_code` NULL ; la synchro ne les modifie pas.
--
-- Cette migration ne supprime aucune donnée. Le nettoyage des données de test
-- est traité à part (script séparé, à valider avant exécution).

-- ----------------------------------------------------------------------------
-- 1. Table miroir : champs structurés supplémentaires issus de F_COMPTET
-- ----------------------------------------------------------------------------

alter table sage_customers_view
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists website text,
  add column if not exists vat_number text,
  add column if not exists ape_code text,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_prospect boolean not null default false,
  add column if not exists famille text,
  add column if not exists sous_famille text,
  add column if not exists categorie text,
  add column if not exists typologie text,
  add column if not exists representant_no int,
  add column if not exists sage_created_at timestamptz;

comment on column sage_customers_view.address is
  'Rue + complément d''adresse uniquement (depuis la migration 0059) — code postal, ville et pays sont dans leurs propres colonnes pour permettre le filtrage.';
comment on column sage_customers_view.is_active is
  'false si le client est en sommeil côté Sage (CT_Sommeil <> 0).';
comment on column sage_customers_view.famille is 'F_COMPTET.FAMILLE (champ libre Sage).';
comment on column sage_customers_view.sous_famille is 'F_COMPTET."S/FAMILLE" (champ libre Sage).';
comment on column sage_customers_view.categorie is 'F_COMPTET.CATEGORIE (champ libre Sage).';
comment on column sage_customers_view.typologie is 'F_COMPTET."Typologie client" (champ libre Sage).';
comment on column sage_customers_view.representant_no is 'F_COMPTET.CO_No — numéro du collaborateur/commercial Sage (nom à résoudre dans un lot ultérieur).';

-- ----------------------------------------------------------------------------
-- 2. companies : lien Sage + champs structurés
-- ----------------------------------------------------------------------------

alter table companies
  add column sage_code text,
  add column origin text not null default 'manuel' check (origin in ('sage', 'manuel')),
  add column postal_code text,
  add column city text,
  add column country text,
  add column website text,
  add column vat_number text,
  add column ape_code text,
  add column sage_active boolean not null default true,
  add column sage_is_prospect boolean not null default false,
  add column sage_famille text,
  add column sage_sous_famille text,
  add column sage_categorie text,
  add column sage_typologie text,
  add column sage_representant_no int,
  add column sage_created_at timestamptz,
  add column sage_archived_at timestamptz;

-- Une fiche Seritex par client Sage ; NULL autorisé (prospect / hors Sage).
create unique index idx_companies_sage_code on companies (sage_code) where sage_code is not null;
create index idx_companies_origin on companies (origin);

comment on column companies.sage_code is
  'F_COMPTET.CT_Num — NULL pour une fiche créée dans Seritex (prospect, futur client portail).';
comment on column companies.origin is
  '''sage'' : fiche alimentée par la synchronisation Sage (champs Sage en lecture seule) ; ''manuel'' : créée dans Seritex.';
comment on column companies.sage_active is
  'false si le client est en sommeil côté Sage.';
comment on column companies.sage_archived_at is
  'Date à laquelle le client a disparu de Sage — la fiche est conservée (historique devis / ODF).';

-- ----------------------------------------------------------------------------
-- 3. Protection des champs Sage (défense en profondeur, en plus de l'UI)
-- ----------------------------------------------------------------------------
-- Seule la fonction de synchronisation (qui pose le drapeau de session
-- `seritex.sage_sync`) peut créer / modifier ces champs. Toute autre
-- écriture — y compris depuis un client SQL avec un compte admin — est refusée.

create or replace function protect_sage_company_fields() returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('seritex.sage_sync', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.sage_code is not null or new.origin <> 'manuel' then
      raise exception 'Une fiche liée à Sage ne peut être créée que par la synchronisation Sage.';
    end if;
    return new;
  end if;

  if new.sage_code is distinct from old.sage_code or new.origin is distinct from old.origin then
    raise exception 'Le lien avec Sage (sage_code / origin) ne peut être modifié que par la synchronisation Sage.';
  end if;

  if old.sage_code is not null and (
    new.name, new.siret, new.address, new.postal_code, new.city, new.country,
    new.phone, new.email, new.website, new.vat_number, new.ape_code,
    new.sage_active, new.sage_is_prospect, new.sage_famille, new.sage_sous_famille,
    new.sage_categorie, new.sage_typologie, new.sage_representant_no,
    new.sage_created_at, new.sage_archived_at
  ) is distinct from (
    old.name, old.siret, old.address, old.postal_code, old.city, old.country,
    old.phone, old.email, old.website, old.vat_number, old.ape_code,
    old.sage_active, old.sage_is_prospect, old.sage_famille, old.sage_sous_famille,
    old.sage_categorie, old.sage_typologie, old.sage_representant_no,
    old.sage_created_at, old.sage_archived_at
  ) then
    raise exception 'Fiche issue de Sage : ces champs sont en lecture seule dans Seritex, à corriger dans Sage.';
  end if;

  return new;
end;
$$;

create trigger trg_protect_sage_company_fields
  before insert or update on companies
  for each row execute function protect_sage_company_fields();

-- ----------------------------------------------------------------------------
-- 4. Fonction de rattachement sage_customers_view → companies
-- ----------------------------------------------------------------------------
-- Appelée par sync.js (service_role) à la fin de chaque synchronisation des
-- clients. Retourne un résumé JSON (adoptées / créées / mises à jour /
-- archivées) affiché dans les logs du job.

create or replace function sync_companies_from_sage() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
  v_adopted int;
  v_updated int;
  v_created int;
  v_archived int;
begin
  select count(*) into v_total from sage_customers_view;
  if v_total = 0 then
    raise exception 'sage_customers_view est vide : rattachement des fiches clients annulé (garde-fou anti-archivage massif).';
  end if;

  perform set_config('seritex.sage_sync', 'on', true);

  -- 0. Reprise des rapprochements manuels existants (linked_company_id) : la
  --    fiche Seritex déjà liée à un client Sage reçoit son sage_code au lieu
  --    d'être dupliquée.
  update companies c
     set sage_code = v.sage_code,
         origin = 'sage'
    from sage_customers_view v
   where v.linked_company_id = c.id
     and c.sage_code is null
     and v.sage_code = (
       select min(v2.sage_code) from sage_customers_view v2 where v2.linked_company_id = c.id
     )
     and not exists (select 1 from companies o where o.sage_code = v.sage_code);
  get diagnostics v_adopted = row_count;

  -- 1. Mise à jour des fiches existantes (uniquement si une valeur a changé,
  --    pour ne pas toucher updated_at à chaque passage).
  update companies c
     set name = v.name,
         siret = v.siret,
         address = v.address,
         postal_code = v.postal_code,
         city = v.city,
         country = v.country,
         phone = v.phone,
         email = v.email,
         website = v.website,
         vat_number = v.vat_number,
         ape_code = v.ape_code,
         sage_active = v.is_active,
         sage_is_prospect = v.is_prospect,
         sage_famille = v.famille,
         sage_sous_famille = v.sous_famille,
         sage_categorie = v.categorie,
         sage_typologie = v.typologie,
         sage_representant_no = v.representant_no,
         sage_created_at = v.sage_created_at,
         sage_archived_at = null
    from sage_customers_view v
   where c.sage_code = v.sage_code
     and (
       c.name, c.siret, c.address, c.postal_code, c.city, c.country,
       c.phone, c.email, c.website, c.vat_number, c.ape_code,
       c.sage_active, c.sage_is_prospect, c.sage_famille, c.sage_sous_famille,
       c.sage_categorie, c.sage_typologie, c.sage_representant_no,
       c.sage_created_at, c.sage_archived_at
     ) is distinct from (
       v.name, v.siret, v.address, v.postal_code, v.city, v.country,
       v.phone, v.email, v.website, v.vat_number, v.ape_code,
       v.is_active, v.is_prospect, v.famille, v.sous_famille,
       v.categorie, v.typologie, v.representant_no,
       v.sage_created_at, null::timestamptz
     );
  get diagnostics v_updated = row_count;

  -- 2. Création des fiches des nouveaux clients Sage.
  insert into companies (
    sage_code, origin, name, siret, address, postal_code, city, country,
    phone, email, website, vat_number, ape_code, sage_active, sage_is_prospect,
    sage_famille, sage_sous_famille, sage_categorie, sage_typologie,
    sage_representant_no, sage_created_at
  )
  select
    v.sage_code, 'sage', v.name, v.siret, v.address, v.postal_code, v.city, v.country,
    v.phone, v.email, v.website, v.vat_number, v.ape_code, v.is_active, v.is_prospect,
    v.famille, v.sous_famille, v.categorie, v.typologie,
    v.representant_no, v.sage_created_at
  from sage_customers_view v
  where not exists (select 1 from companies c where c.sage_code = v.sage_code);
  get diagnostics v_created = row_count;

  -- 3. Archivage (jamais de suppression) des clients disparus de Sage.
  update companies c
     set sage_archived_at = now()
   where c.origin = 'sage'
     and c.sage_archived_at is null
     and not exists (select 1 from sage_customers_view v where v.sage_code = c.sage_code);
  get diagnostics v_archived = row_count;

  return jsonb_build_object(
    'reprises', v_adopted,
    'creees', v_created,
    'mises_a_jour', v_updated,
    'archivees', v_archived
  );
end;
$$;

-- Exécutable uniquement par le job de synchronisation (service_role) :
-- jamais depuis une session utilisateur, même administrateur.
revoke execute on function sync_companies_from_sage() from public, anon, authenticated;
grant execute on function sync_companies_from_sage() to service_role;
