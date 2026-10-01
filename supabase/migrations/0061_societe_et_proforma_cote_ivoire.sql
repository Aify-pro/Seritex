-- ============================================================================
-- 0061 — Informations société + devis / facture proforma conforme (Côte d'Ivoire)
-- ============================================================================
--
-- Deux besoins liés :
--
--   1. Paramètres > Informations société : une fiche unique de l'émetteur
--      (Seritex) — identité légale OHADA / DGI, coordonnées, banque, valeurs
--      par défaut commerciales — relue par tous les documents commerciaux et
--      administratifs (PDF proforma aujourd'hui, factures / bons demain).
--      Même pattern que fabrication_settings (0045) : table à une seule
--      ligne, lecture pour tout utilisateur connecté (ces informations sont
--      imprimées sur les documents remis aux clients, donc le portail client
--      doit pouvoir les lire pour générer le PDF), écriture réservée à
--      l'administrateur de plateforme (is_platform_admin).
--
--   2. Devis enrichi des mentions utiles à une proforma ivoirienne :
--      numérotation continue par année, TVA (18 % par défaut) avec totaux
--      HT / TVA / TTC, remise, conditions et mode de règlement, acompte,
--      délai de livraison, référence de bon de commande client, et
--      identifiants légaux du client (NCC, RCCM) sur la fiche entreprise,
--      remise par ligne d'article, délai de livraison normalisé (valeur +
--      unité + point de départ) OU date ferme, conditions de paiement
--      choisies dans une liste gérée dans Informations société, et devise
--      étrangère (taux de change figé sur le devis) pour préparer la vente
--      en ligne.
--
-- Rétrocompatibilité : les devis existants gardent leur total tel quel
-- (tva_rate = 0 → HT = TTC = total_amount). `total_amount` reste le montant
-- à payer par le client (TTC) : les listes, notifications et l'écran client
-- n'ont donc rien à changer. `quote_lines.line_total` (colonne générée,
-- utilisée par une vue de 0002) n'est pas touchée : la remise est portée au
-- niveau du devis, pas de la ligne.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COMPANY_SETTINGS — fiche société (une seule ligne)
-- ----------------------------------------------------------------------------

create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),

  -- Identité légale
  raison_sociale text not null default 'SERITEX',
  nom_commercial text,
  forme_juridique text,                 -- SARL, SA, SAS, entreprise individuelle…
  capital_social numeric(14,0),         -- en F CFA
  rccm text,                            -- Registre du Commerce et du Crédit Mobilier
  ncc text,                             -- Numéro de Compte Contribuable (DGI)
  regime_imposition text,               -- Réel normal, réel simplifié, TEE…
  centre_impots text,                   -- Centre des impôts de rattachement
  numero_cnps text,                     -- Employeur CNPS (documents administratifs)
  assujetti_tva boolean not null default true,

  -- Coordonnées
  adresse text,
  boite_postale text,
  ville text,
  pays text not null default 'Côte d''Ivoire',
  telephone text,
  email text,
  site_web text,

  -- Règlement
  banque_nom text,
  banque_compte text,                   -- RIB ou IBAN
  banque_swift text,
  mobile_money text,                    -- ex. « Orange Money 07 00 00 00 00 »

  -- Signataire des documents
  signataire_nom text,
  signataire_fonction text,

  -- Valeurs par défaut des devis
  tva_taux_defaut numeric(5,2) not null default 18.00
    constraint company_settings_tva_range check (tva_taux_defaut >= 0 and tva_taux_defaut <= 100),
  validite_devis_jours int not null default 30
    constraint company_settings_validite_range check (validite_devis_jours between 1 and 365),
  acompte_pct_defaut numeric(5,2) not null default 0
    constraint company_settings_acompte_range check (acompte_pct_defaut >= 0 and acompte_pct_defaut <= 100),
  mentions_devis text,                  -- pied de page libre (pénalités, réserve de propriété…)

  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table company_settings is
  'Fiche société de l''émetteur (Paramètres > Informations société). Une seule ligne. Source unique des mentions légales et coordonnées imprimées sur les documents commerciaux et administratifs (proforma, puis factures / bons).';
comment on column company_settings.ncc is
  'Numéro de Compte Contribuable (DGI Côte d''Ivoire) — mention obligatoire sur les documents fiscaux.';
comment on column company_settings.rccm is
  'Numéro RCCM (OHADA) — mention obligatoire sur les documents commerciaux d''une société.';

insert into company_settings (raison_sociale)
select 'SERITEX'
where not exists (select 1 from company_settings);

alter table company_settings enable row level security;

create policy company_settings_select on company_settings for select
  using (auth.uid() is not null);
create policy company_settings_update on company_settings for update
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on company_settings from public, anon;
grant select, update on company_settings to authenticated;

-- ----------------------------------------------------------------------------
-- 1b. CONDITIONS DE PAIEMENT (liste gérée dans Informations société)
-- ----------------------------------------------------------------------------
-- Quatre conditions de base (système : désactivables mais non supprimables),
-- l'administrateur peut en ajouter. Le devis conserve le LIBELLÉ choisi (copie
-- figée) : renommer ou supprimer une condition ne modifie jamais un devis émis.

create table if not exists payment_terms (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  is_system boolean not null default false,
  is_default boolean not null default false,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_terms_single_default on payment_terms ((true)) where is_default;

insert into payment_terms (label, is_system, is_default, display_order) values
  ('Solde à la livraison', true, true, 10),
  ('30 jours', true, false, 20),
  ('60 jours', true, false, 30),
  ('90 jours', true, false, 40)
on conflict (label) do nothing;

alter table payment_terms enable row level security;
create policy payment_terms_select on payment_terms for select using (auth.uid() is not null);
create policy payment_terms_write on payment_terms for insert with check (is_platform_admin());
create policy payment_terms_update on payment_terms for update using (is_platform_admin()) with check (is_platform_admin());
create policy payment_terms_delete on payment_terms for delete using (is_platform_admin() and not is_system);
revoke all on payment_terms from public, anon;
grant select, insert, update, delete on payment_terms to authenticated;

-- ----------------------------------------------------------------------------
-- 1c. DEVISES (taux indicatif contre le franc CFA)
-- ----------------------------------------------------------------------------
-- rate_xof = nombre de F CFA pour 1 unité de la devise. Pré-remplit le taux du
-- devis, qui reste modifiable devis par devis puis figé. L'euro est à parité
-- fixe (655,957) ; les autres devises sont à activer avec un taux saisi.

create table if not exists currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  label text not null,
  rate_xof numeric(14,6) check (rate_xof is null or rate_xof > 0),
  is_base boolean not null default false,
  active boolean not null default false,
  display_order int not null default 0,
  updated_at timestamptz not null default now()
);

insert into currencies (code, label, rate_xof, is_base, active, display_order) values
  ('XOF', 'Franc CFA (BCEAO)', 1, true, true, 10),
  ('EUR', 'Euro', 655.957, false, true, 20),
  ('USD', 'Dollar américain', null, false, false, 30),
  ('GBP', 'Livre sterling', null, false, false, 40)
on conflict (code) do nothing;

alter table currencies enable row level security;
create policy currencies_select on currencies for select using (auth.uid() is not null);
create policy currencies_write on currencies for insert with check (is_platform_admin());
create policy currencies_update on currencies for update using (is_platform_admin()) with check (is_platform_admin());
revoke all on currencies from public, anon;
grant select, insert, update on currencies to authenticated;

-- Module « societe » : pilote la VISIBILITÉ du menu (comme « fabrication »),
-- la page reste verrouillée à requirePlatformAdmin().
insert into modules (key, label, description, display_order)
values ('societe', 'Informations société',
        'Identité légale, coordonnées et valeurs par défaut de l''émetteur des documents commerciaux', 146)
on conflict (key) do nothing;

insert into role_permissions (role_id, module_id, can_view, can_create, can_modify, can_archive, can_delete, can_validate, can_unlock)
select r.id, m.id, (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'),
       (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur'), (r.key = 'administrateur')
from roles r, modules m
where m.key = 'societe'
  and not exists (
    select 1 from role_permissions rp where rp.role_id = r.id and rp.module_id = m.id
  );

-- ----------------------------------------------------------------------------
-- 2. IDENTIFIANTS LÉGAUX DU CLIENT (fiche entreprise)
-- ----------------------------------------------------------------------------
-- Nouvelles colonnes, hors du périmètre protégé Sage (0059) : modifiables
-- depuis la fiche client, y compris pour un client importé de Sage.

alter table companies
  add column if not exists ncc text,
  add column if not exists rccm text;

comment on column companies.ncc is
  'Numéro de Compte Contribuable du client — imprimé sur la proforma pour un client assujetti.';
comment on column companies.rccm is
  'Numéro RCCM du client.';

-- ----------------------------------------------------------------------------
-- 3. DEVIS : MENTIONS DE LA PROFORMA
-- ----------------------------------------------------------------------------

alter table quotes
  add column if not exists objet text,
  add column if not exists reference_client text,        -- n° de bon de commande / consultation du client
  add column if not exists remise_pct numeric(5,2) not null default 0
    constraint quotes_remise_range check (remise_pct >= 0 and remise_pct <= 100),
  add column if not exists tva_rate numeric(5,2) not null default 0
    constraint quotes_tva_range check (tva_rate >= 0 and tva_rate <= 100),
  add column if not exists tva_exoneration_motif text,   -- renseigné si exonéré (export, zone franche…)
  add column if not exists devise text not null default 'XOF' references currencies(code),
  add column if not exists taux_change numeric(14,6) not null default 1 check (taux_change > 0),
  add column if not exists total_ht numeric(14,2),
  add column if not exists total_tva numeric(14,2),
  add column if not exists mode_reglement text,
  add column if not exists conditions_paiement text,
  add column if not exists acompte_pct numeric(5,2) not null default 0
    constraint quotes_acompte_range check (acompte_pct >= 0 and acompte_pct <= 100),
  -- Délai de livraison normalisé : valeur + unité + point de départ. Exclusif
  -- avec date_livraison_prevue (date ferme, 0048) : l'un OU l'autre.
  add column if not exists delai_valeur int check (delai_valeur is null or delai_valeur > 0),
  add column if not exists delai_unite text check (delai_unite in ('jours', 'jours_ouvres', 'semaines', 'mois')),
  add column if not exists delai_depart text check (delai_depart in ('commande', 'acompte', 'validation_echantillon')),
  add column if not exists notes text;

comment on column quotes.total_amount is
  'Montant TTC à payer par le client, dans la devise du devis (quotes.devise ; F CFA par défaut). Pour un devis antérieur à 0061 : total sans TVA (tva_rate = 0, donc HT = TTC).';
comment on column quotes.taux_change is
  'Nombre de F CFA pour 1 unité de la devise du devis, figé à l''émission (1 si devise = XOF).';
comment on column quotes.total_ht is
  'Total HT net de remises, dans la devise du devis. Null pour un devis antérieur à 0061 : le total_amount fait foi.';
comment on column quotes.remise_pct is
  'Remise commerciale globale (%) appliquée à la somme des lignes (après remises de ligne), avant TVA.';

alter table quote_lines
  add column if not exists remise_pct numeric(5,2) not null default 0
    constraint quote_lines_remise_range check (remise_pct >= 0 and remise_pct <= 100);

comment on column quote_lines.remise_pct is
  'Remise (%) propre à la ligne. line_total (colonne générée, utilisée par une vue de 0002) reste le brut quantité × PU : le net se calcule côté application.';

-- ----------------------------------------------------------------------------
-- 4. NUMÉROTATION CONTINUE DES DEVIS (DEV-AAAA-NNNN)
-- ----------------------------------------------------------------------------
-- Une numérotation chronologique sans trou est attendue sur les documents
-- commerciaux ; l'ancienne référence « DEV-<horodatage base 36> » n'offrait
-- ni l'un ni l'autre. Les devis existants gardent leur référence.

create table if not exists document_counters (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

alter table document_counters enable row level security;
revoke all on document_counters from public, anon, authenticated;

create or replace function next_document_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now() at time zone 'Africa/Abidjan')::int;
  v_next int;
begin
  if not is_commercial_or_above() then
    raise exception 'Numérotation réservée au commercial ou à l''administration.';
  end if;

  insert into document_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = document_counters.last_value + 1
  returning last_value into v_next;

  return p_prefix || '-' || v_year || '-' || lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function next_document_number(text) from public, anon;
grant execute on function next_document_number(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. E-MAIL « DEVIS ENVOYÉ » : MONTANT AVEC SA DEVISE
-- ----------------------------------------------------------------------------
-- Le modèle d'origine (0046) imprimait « MAD » en dur après le montant. Le
-- montant est désormais fourni déjà formaté avec sa devise ; on ne retouche
-- que les modèles restés tels que livrés.

update notification_events
   set body_template = replace(body_template, '{{montant_total}} MAD', '{{montant_total}}')
 where event_key = 'devis_envoye'
   and body_template like '%{{montant_total}} MAD%';
