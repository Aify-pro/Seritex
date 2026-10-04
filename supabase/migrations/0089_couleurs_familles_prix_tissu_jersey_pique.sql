-- ============================================================================
-- Seritex — Couleurs, familles de couleur et prix tissu de la grille Jersey / Piqué
-- ============================================================================
--
-- Source : Grille_Prix_Tshirts_Multicolores_Seritex_V7.xlsx (feuilles « Base
-- Jersey » et « Base Piqué »). Chargement de données pendant le chantier : la
-- structure est volontairement minimale et sera reprise ensuite.
--
-- 1. Couleurs : `code` = référence Pantone TCX de la grille (pas le HEX), `name`
--    = nom français. La grille ne donne aucun nom sauf WHITE (= « Blanc »,
--    déjà présent, code 11-4001 TCX) et BLACK C (= « Noir ») : les autres noms
--    sont descriptifs, déduits de la teinte, à ajuster dans Paramètres >
--    Couleurs et tailles. La famille est la même pour le Jersey et le Piqué.
--    Deux couleurs sont « À confirmer » dans la grille : famille laissée vide.
-- 2. Familles : blanc / clair / moyen / foncé (White / Light / Medium / Dark).
--    Le fournisseur facture selon la famille, pas selon l'article.
-- 3. Prix du tissu au kg par textile ET par famille. Jersey 160 GSM : prix CNF,
--    douane 19 % à ajouter (Calcul Jersey). Piqué 260 GSM : douane 0 %.
--    Table réservée à Direction + administrateur, comme textile_prices.
--    Les prix de col de la grille ne sont pas repris (Jersey = mêmes montants
--    que le tissu ; Piqué : non renseignés dans la grille).
-- textile_prices (un prix par textile, utilisé par le prix de revient réel) n'est
-- pas modifié.
-- ============================================================================

-- 1. Famille de couleur ------------------------------------------------------

alter table colors
  add column if not exists famille text
  check (famille is null or famille in ('blanc', 'clair', 'moyen', 'fonce'));

comment on column colors.famille is
  'Famille de couleur du fournisseur (blanc/clair/moyen/foncé) : le prix du tissu en dépend (textile_family_prices). Vide = à confirmer.';

-- 2. Prix du tissu par textile et par famille ---------------------------------

create table if not exists textile_family_prices (
  textile_id uuid not null references textiles(id) on delete cascade,
  famille text not null check (famille in ('blanc', 'clair', 'moyen', 'fonce')),
  prix_kg numeric(12, 2) not null check (prix_kg > 0),
  -- Douane à ajouter au prix de la grille pour obtenir le prix rendu.
  douane_pct numeric(5, 2) not null default 0 check (douane_pct >= 0),
  updated_at timestamptz not null default now(),
  primary key (textile_id, famille)
);

comment on table textile_family_prices is
  'Prix du tissu au kg par textile et par famille de couleur (grille Excel V7). prix_kg = prix de la grille (CNF) ; prix rendu = prix_kg × (1 + douane_pct/100).';

alter table textile_family_prices enable row level security;
create policy textile_family_prices_select on textile_family_prices for select using (is_admin());
create policy textile_family_prices_insert on textile_family_prices for insert with check (is_admin());
create policy textile_family_prices_update on textile_family_prices for update using (is_admin()) with check (is_admin());
create policy textile_family_prices_delete on textile_family_prices for delete using (is_admin());
revoke all on textile_family_prices from public, anon;
grant select, insert, update, delete on textile_family_prices to authenticated;

-- 3. Données -------------------------------------------------------------------

-- Le blanc de la grille (WHITE) est le « Blanc » existant.
update colors set famille = 'blanc' where name = 'Blanc' and famille is null;

insert into colors (name, code, famille) values
  ('Jaune vif', '12-0643 TCX', 'fonce'),
  ('Jaune pâle', '12-0815 TCX', 'clair'),
  ('Jaune d''or', '13-0759 TCX', 'fonce'),
  ('Jaune citron', '14-0756 TCX', null),
  ('Jaune soleil', '14-0760 TCX', 'fonce'),
  ('Rose pâle', '14-2311 TCX', 'moyen'),
  ('Orange doré', '15-1062 TCX', 'fonce'),
  ('Beige', '15-1114 TCX', 'moyen'),
  ('Gris clair', '15-4304 TCX', 'moyen'),
  ('Bleu ciel', '15-4323 TCX', 'moyen'),
  ('Orange', '16-1358 TCX', 'fonce'),
  ('Bleu turquoise', '16-4529 TCX', 'moyen'),
  ('Vert turquoise', '16-5123 TCX', 'moyen'),
  ('Bleu azur', '17-4540 TCX', 'fonce'),
  ('Gris anthracite', '18-4006 TCX', 'fonce'),
  ('Bleu électrique', '18-4148 TCX', null),
  ('Vert sapin', '18-5025 TCX', 'fonce'),
  ('Vert émeraude', '18-6030 TCX', 'fonce'),
  ('Marron', '19-1431 TCX', 'fonce'),
  ('Rouge carmin', '19-1650 TCX', 'fonce'),
  ('Rouge vif', '19-1763 TCX', 'fonce'),
  ('Framboise', '19-1955 TCX', 'fonce'),
  ('Violet', '19-3336 TCX', 'fonce'),
  ('Bleu marine', '19-3932 TCX', 'fonce'),
  ('Bleu nuit', '19-3952 TCX', 'fonce'),
  ('Bleu roi', '19-4150 TCX', 'fonce'),
  ('Bleu pétrole', '19-4241 TCX', 'fonce'),
  ('Vert canard', '19-5230 TCX', 'fonce'),
  ('Vert', '19-6050 TCX', 'fonce'),
  ('Noir', 'BLACK C', 'fonce')
on conflict (name) do nothing;

insert into textiles (nom, grammage) values
  ('Jersey 160', 160),
  ('Piqué 260', 260)
on conflict (nom) do nothing;

insert into textile_family_prices (textile_id, famille, prix_kg, douane_pct)
select t.id, p.famille, p.prix_kg, p.douane_pct
from (values
  ('Jersey 160', 'blanc', 3217, 19), ('Jersey 160', 'clair', 3374, 19),
  ('Jersey 160', 'moyen', 3548, 19), ('Jersey 160', 'fonce', 3755, 19),
  ('Piqué 260',  'blanc', 3738, 0),  ('Piqué 260',  'clair', 3895, 0),
  ('Piqué 260',  'moyen', 4040, 0),  ('Piqué 260',  'fonce', 4208, 0)
) as p(nom, famille, prix_kg, douane_pct)
join textiles t on t.nom = p.nom
on conflict (textile_id, famille) do nothing;
