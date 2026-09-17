-- ============================================================================
-- Seritex — Date de livraison prévue, saisie dès le devis
-- ============================================================================
--
-- Demande Ayman (17/09) : le PDF de l'ODF doit porter la date de livraison
-- promise au client — mais rien ne la portait jusqu'ici. Elle doit se
-- décider dès le devis (avant même que l'ODF n'existe), pas être improvisée
-- à la création de l'ODF : posée ici sur `quotes`, pas `production_orders`.
--
-- Nullable et optionnelle (comme `valid_until`, déjà sur cette table) :
-- aucune contrainte de saisie côté commercial, le PDF affiche simplement
-- "-" si elle manque, comme les autres champs facultatifs du document.

alter table quotes
  add column date_livraison_prevue date;

comment on column quotes.date_livraison_prevue is
  'Date de livraison promise au client, saisie à l''établissement du devis (QuoteForm) — affichée sur le PDF de l''ODF qui en hérite via production_orders.quote_id. Nullable : aucune obligation de saisie.';
