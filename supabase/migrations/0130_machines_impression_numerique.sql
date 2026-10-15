-- ============================================================================
-- 0130 — Machines d'impression polyvalentes : sérigraphie ET numérique
-- ============================================================================
-- La table `machines` (0119) ne connaissait que la sérigraphie. Elle accueille
-- maintenant l'impression numérique (DTF, DTF UV, DTG, roll to roll,
-- sublimation, UV à plat, éco-solvant) avec leurs caractéristiques propres :
--
--   * famille : serigraphie | numerique (déduite du type, vérifiée par un check) ;
--   * types numériques ajoutés aux 4 types de sérigraphie existants ;
--   * séchage : ajout de four (DTF, poudre), LED UV, intégré à la machine ;
--   * fiche technique numérique : marque/modèle, technologie d'encre, canaux
--     d'encre, encre blanche, têtes d'impression (modèle), résolution (dpi),
--     vitesse (m²/h), consommation d'encre (ml/m²), RIP/logiciel.
--
-- Rien n'est supprimé ni renommé : les machines existantes restent des
-- machines de sérigraphie, les droits du module `machines_ecrans` ne changent
-- pas. Les écrans (cadres) restent propres à la sérigraphie.
-- ============================================================================

alter table machines add column if not exists famille text not null default 'serigraphie';
alter table machines add column if not exists marque_modele text;
alter table machines add column if not exists technologie_encre text;
alter table machines add column if not exists nb_canaux_encre int;
alter table machines add column if not exists encre_blanche boolean not null default false;
alter table machines add column if not exists modele_tetes text;
alter table machines add column if not exists resolution_dpi int;
alter table machines add column if not exists vitesse_m2_h numeric(7, 2);
alter table machines add column if not exists conso_encre_ml_m2 numeric(7, 2);
alter table machines add column if not exists rip_logiciel text;

alter table machines drop constraint if exists machines_type_check;
alter table machines drop constraint if exists machines_sechage_check;
alter table machines drop constraint if exists machines_famille_type_check;

alter table machines add constraint machines_famille_type_check check (
  (famille = 'serigraphie' and type in ('carrousel_manuel', 'carrousel_auto', 'ovale', 'table'))
  or (famille = 'numerique' and type in ('dtf', 'dtf_uv', 'dtg', 'roll_to_roll', 'sublimation', 'uv_plat', 'ecosolvant'))
);
alter table machines add constraint machines_sechage_check
  check (sechage in ('flash', 'tunnel', 'aucun', 'four', 'led_uv', 'integre'));
alter table machines add constraint machines_fiche_numerique_check check (
  (marque_modele is null or length(marque_modele) <= 80)
  and (technologie_encre is null or length(technologie_encre) <= 60)
  and (modele_tetes is null or length(modele_tetes) <= 80)
  and (rip_logiciel is null or length(rip_logiciel) <= 80)
  and (nb_canaux_encre is null or nb_canaux_encre between 1 and 16)
  and (resolution_dpi is null or resolution_dpi between 72 and 5760)
  and (vitesse_m2_h is null or vitesse_m2_h > 0)
  and (conso_encre_ml_m2 is null or conso_encre_ml_m2 > 0)
);

comment on column machines.famille is
  'serigraphie (carrousels, ovale, table : têtes, stations, écrans) ou numerique (DTF, DTF UV, DTG, roll to roll, sublimation, UV à plat, éco-solvant : têtes d''impression, canaux d''encre, résolution, vitesse).';
comment on column machines.nb_tetes is
  'Sérigraphie : couleurs imprimables en un passage. Numérique : têtes d''impression.';
comment on column machines.format_max_l_cm is
  'Largeur imprimable maximale. Roll to roll : largeur du rouleau ; la hauteur peut rester vide (longueur libre).';
