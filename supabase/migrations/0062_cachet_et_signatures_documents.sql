-- ============================================================================
-- 0062 — Cachet de la société et signatures des validateurs de documents
-- ============================================================================
--
-- Paramètres > Informations société gère désormais :
--
--   - le cachet de la société (une seule image) ;
--   - les signatures des personnes aptes à valider les documents de vente,
--     chacune AFFILIÉE À UN COMPTE UTILISATEUR (clé = app_users.id).
--
-- Règle d'usage (code, pas SQL) : la signature d'un compte, accompagnée du
-- cachet, n'est apposée que sur les documents ÉTABLIS PAR CE COMPTE
-- (quotes.created_by). Rien n'est signé « au nom de » quelqu'un d'autre ; un
-- document établi par un compte sans signature garde sa case vide, à signer à
-- la main. C'est le pendant, pour la signature, du principe « aucune sortie
-- engageante sans validation humaine ».
--
-- Stockage : PNG encodé en base64 (texte) directement en base, plafonné à
-- ~330 Ko d'image. Volontairement PAS sur le NAS / la médiathèque : une
-- signature n'a pas à être listée, partagée ni exposée par un lien.
--
-- Accès : réservé à l'administrateur de plateforme (is_platform_admin), en
-- lecture comme en écriture. Un client qui télécharge SA proforma ne lit donc
-- jamais ces tables : le PDF est assemblé côté serveur, après le contrôle
-- d'accès sur le devis, par le client d'administration.
-- ============================================================================

create table if not exists company_stamp (
  id uuid primary key default gen_random_uuid(),
  image_png text not null check (length(image_png) <= 450000),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

-- Un seul cachet à la fois.
create unique index if not exists company_stamp_single on company_stamp ((true));

comment on table company_stamp is
  'Cachet de la société (PNG base64), apposé avec la signature sur les documents de vente. Une seule ligne.';

create table if not exists document_signatories (
  user_id uuid primary key references app_users(id) on delete cascade,
  fonction text,
  signature_png text not null check (length(signature_png) <= 450000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_users(id)
);

comment on table document_signatories is
  'Signatures des personnes aptes à valider les documents de vente, une par compte utilisateur. La signature n''est apposée que sur les documents établis par ce compte.';
comment on column document_signatories.fonction is
  'Fonction imprimée sous la signature (ex. Directeur général).';
comment on column document_signatories.active is
  'Une signature désactivée n''est plus apposée sur les nouveaux PDF (le compte et l''image sont conservés).';

alter table company_stamp enable row level security;
alter table document_signatories enable row level security;

create policy company_stamp_all on company_stamp for all
  using (is_platform_admin()) with check (is_platform_admin());
create policy document_signatories_all on document_signatories for all
  using (is_platform_admin()) with check (is_platform_admin());

revoke all on company_stamp, document_signatories from public, anon;
grant select, insert, update, delete on company_stamp, document_signatories to authenticated;
