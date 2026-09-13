-- ============================================================================
-- Seritex — Peuplement du référentiel de tailles (migration 0029)
-- ============================================================================
--
-- La migration 0029 a créé la table `sizes` mais l'a laissée vide : chaque
-- taille devait jusqu'ici être saisie une à une depuis Paramètres > Couleurs
-- et tailles. Ce lot y insère la grille de tailles actuellement utilisée par
-- l'entreprise, en reprenant l'ordre métier (jamais alphabétique ni
-- numérique : XS < S < M < L < XL) via `display_order`, remis à 1 à chaque
-- groupe puisque l'ordre n'est comparé qu'au sein d'un même groupe (tri
-- `.order("groupe").order("display_order")` de l'écran Couleurs et tailles).
--
-- `on conflict (groupe, libelle) do nothing` : rejouable sans erreur si une
-- de ces tailles a déjà été saisie manuellement entre-temps.
insert into sizes (groupe, libelle, display_order) values
  -- Homme
  ('Homme', 'XS', 1),
  ('Homme', 'S', 2),
  ('Homme', 'M', 3),
  ('Homme', 'L', 4),
  ('Homme', 'XL', 5),
  ('Homme', 'XXL', 6),
  ('Homme', '3XL', 7),
  ('Homme', '4XL', 8),
  ('Homme', '5XL', 9),
  ('Homme', '6XL', 10),
  ('Homme', '7XL', 11),
  -- Femme
  ('Femme', 'XXS', 1),
  ('Femme', 'XS', 2),
  ('Femme', 'S', 3),
  ('Femme', 'M', 4),
  ('Femme', 'L', 5),
  ('Femme', 'XL', 6),
  ('Femme', 'XXL', 7),
  ('Femme', '3XL', 8),
  ('Femme', '4XL', 9),
  -- Enfant
  ('Enfant', '2 ans', 1),
  ('Enfant', '3 ans', 2),
  ('Enfant', '4 ans', 3),
  ('Enfant', '5 ans', 4),
  ('Enfant', '6 ans', 5),
  ('Enfant', '7 ans', 6),
  ('Enfant', '8 ans', 7),
  ('Enfant', '9 ans', 8),
  ('Enfant', '10 ans', 9),
  ('Enfant', '11 ans', 10),
  ('Enfant', '12 ans', 11),
  ('Enfant', '13 ans', 12),
  ('Enfant', '14 ans', 13),
  ('Enfant', '15 ans', 14),
  ('Enfant', '16 ans', 15),
  -- Bébé
  ('Bébé', '0-3M', 1),
  ('Bébé', '3-6M', 2),
  ('Bébé', '6-9M', 3),
  ('Bébé', '9-12M', 4),
  ('Bébé', '12-18M', 5),
  ('Bébé', '18-24M', 6)
on conflict (groupe, libelle) do nothing;
