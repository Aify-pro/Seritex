-- ============================================================================
-- Seritex — Module Production, lot 8 : rendement matière
-- Réf. : claude_cahier-des-charges-technique-production.md (lot 8)
-- ============================================================================
--
-- Dépend des lots 4 et 7. Purement des vues calculées, comme prescrit par le
-- cahier des charges (« rendement_par_trace et rendement_par_odf ») — aucune
-- nouvelle table, aucune nouvelle colonne.
--
-- Origine des deux valeurs qui portent le théorique (longueur_matelas_m,
-- nb_plis, sur traces_placement) : calculées par Diamino côté PAO, puis
-- reportées manuellement dans la fiche de placement aujourd'hui. Le moteur
-- de reconnaissance DXF déjà en place pour les patrons (analyses_trace,
-- migration 0007) est prévu pour automatiser cette saisie plus tard
-- directement depuis le tracé — cette vue lit ces deux colonnes telles
-- qu'elles sont posées sur traces_placement, sans se soucier de leur mode de
-- saisie : le jour où elles deviennent automatiques, rendement_par_trace
-- n'a rien à changer.
--
-- Décisions actées ici (le cahier qualifie lui-même ce schéma de « à affiner
-- avec Claude Code au moment de l'implémentation, pas des migrations
-- figées ») :
--
--   - rendement_par_trace ne couvre que les matelas déjà clôturés (lot 4,
--     work_order_events.event_type = 'matelas_cloture') : tant qu'un matelas
--     n'est pas clôturé, il n'y a ni pièces obtenues ni déchet mesuré, donc
--     aucun rendement calculable — la ligne n'existe simplement pas encore
--     dans la vue, plutôt que d'y figurer à moitié remplie.
--
--   - Deux qualités de « réel » bien distinctes, jamais mélangées dans une
--     même colonne ni dans un même nom de champ :
--       * Au grain du tracé (rendement_par_trace), le seul déchet TOUJOURS
--         disponible est work_order_events.poids_dechet_kg (lot 4,
--         obligatoire à chaque clôture, cf. 0014). Le circuit plus précis du
--         lot 7 (sacs_dechets_pesees.trace_id) est volontairement laissé de
--         côté ici : ce lien est facultatif et un sac peut mélanger
--         plusieurs productions/tracés (cf. commentaire de 0017) — s'y fier
--         au grain du tracé sous-estimerait le déchet des matelas dont le
--         sac n'a pas été rattaché, et améliorerait leur rendement à tort.
--         Le champ est donc nommé poids_tissu_reel_estime_kg : une
--         ESTIMATION dérivée (théorique − déchet du matelas), pas une pesée
--         indépendante.
--       * Au grain de l'ODF (rendement_par_odf), le lot 7 donne au contraire
--         une vraie mesure indépendante et complète : réception tissu moins
--         retour stock, sur la table pesees (même principe que
--         get_production_order_reconciliation(), migration 0017, recalculé
--         ici directement plutôt qu'appelé — cette fonction lève une
--         exception pour le rôle client, ce qui casserait une vue agrégeant
--         plusieurs ODF d'un coup ; la RLS de pesees suffit déjà à ne rien
--         exposer à ce rôle). Le champ est donc nommé
--         poids_tissu_reel_mesure_kg : une PESÉE, pas une estimation.
--     rendement_par_odf n'est donc pas une simple somme de
--     rendement_par_trace : les deux vues utilisent volontairement deux
--     sources de vérité différentes pour le « réel », chacune la meilleure
--     disponible à son grain.
--
--   - Vues security_invoker (même pattern que client_production_status,
--     migration 0009) : aucune policy RLS nouvelle, le résultat hérite de
--     celles déjà posées sur traces_placement / fiches_placement /
--     work_order_events / work_orders / pesees. En particulier,
--     work_order_events_select (migration 0002) limite déjà la lecture des
--     clôtures de matelas à responsable_production/administrateur ou au
--     chef de la section Coupe — cohérent avec le périmètre « Coupe
--     uniquement » du lot 7, sans rien ajouter ici. Un client (RLS
--     production_orders : lecture de ses propres ODF) ne verra donc aucune
--     ligne : le rendement matière est un indicateur interne à l'atelier.
--
--   - Pas de garde-fou « donnée manquante → 0 » : une dimension de matelas
--     ou un grammage non saisi rend le théorique NULL plutôt que 0, pour ne
--     jamais afficher un rendement infini ou trompeur. De même, un
--     dénominateur nul ou négatif (poids réel estimé qui tomberait à zéro
--     ou en dessous — signe d'un déchet mal saisi plutôt que d'un vrai 0)
--     rend le rendement NULL plutôt que de faire planter la division —
--     philosophie « un écart doit rester visible », déjà suivie au lot 5,
--     plutôt que masqué par une valeur par défaut.

-- ============================================================================
-- 1. RENDEMENT PAR TRACÉ (grain matelas)
-- ============================================================================

create view rendement_par_trace as
with base as (
  select
    t.id as trace_id,
    t.fiche_id,
    wo.production_order_id as odf_id,
    f.numero_ot,
    t.reference,
    woe.id as work_order_event_id,
    woe.occurred_at as cloture_le,
    t.longueur_matelas_m,
    t.largeur_matelas_cm,
    t.nb_plis,
    f.grammage,
    case
      when t.longueur_matelas_m is null or t.largeur_matelas_cm is null
        or t.nb_plis is null or f.grammage is null then null
      else round(
        t.longueur_matelas_m * (t.largeur_matelas_cm / 100.0) * t.nb_plis * f.grammage / 1000.0,
        3
      )
    end as poids_tissu_theorique_kg,
    woe.poids_dechet_kg,
    woe.quantity as pieces_obtenues
  from traces_placement t
  join fiches_placement f on f.id = t.fiche_id
  join work_order_events woe on woe.trace_id = t.id and woe.event_type = 'matelas_cloture'
  join work_orders wo on wo.id = woe.work_order_id
)
select
  base.*,
  case
    when poids_tissu_theorique_kg is null then null
    else round(poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0), 3)
  end as poids_tissu_reel_estime_kg,
  case
    when poids_tissu_theorique_kg is null or poids_tissu_theorique_kg <= 0 then null
    else round(pieces_obtenues / poids_tissu_theorique_kg, 3)
  end as rendement_theorique_pieces_par_kg,
  case
    when poids_tissu_theorique_kg is null then null
    when (poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0)) <= 0 then null
    else round(pieces_obtenues / (poids_tissu_theorique_kg - coalesce(poids_dechet_kg, 0)), 3)
  end as rendement_estime_pieces_par_kg
from base;

alter view rendement_par_trace set (security_invoker = on);

-- ============================================================================
-- 2. RENDEMENT PAR ODF (grain ordre de fabrication)
-- ============================================================================

create view rendement_par_odf as
with par_trace as (
  select odf_id, pieces_obtenues, poids_tissu_theorique_kg
  from rendement_par_trace
),
theorique as (
  select
    odf_id,
    sum(pieces_obtenues) as pieces_obtenues,
    -- Somme uniquement sur les tracés dont le théorique est connu : un
    -- matelas à dimension/grammage manquant est exclu du dénominateur
    -- plutôt que traité comme 0 kg engagé (cf. note en tête de fichier).
    sum(poids_tissu_theorique_kg) filter (where poids_tissu_theorique_kg is not null) as poids_tissu_theorique_kg,
    bool_and(poids_tissu_theorique_kg is not null) as theorique_complet
  from par_trace
  group by odf_id
),
mesure as (
  select
    production_order_id as odf_id,
    sum(poids_kg) filter (where type = 'reception_tissu') as poids_entrant_kg,
    sum(poids_kg) filter (where type = 'retour_stock') as poids_retour_kg
  from pesees
  group by production_order_id
)
select
  theorique.odf_id,
  theorique.pieces_obtenues,
  theorique.poids_tissu_theorique_kg,
  -- NULL tant qu'aucun matelas de cet ODF n'a de théorique complet, plutôt
  -- qu'un 0/false trompeur — même logique que rendement_par_trace.
  theorique.theorique_complet,
  coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0) as poids_tissu_reel_mesure_kg,
  case
    when not theorique.theorique_complet or theorique.poids_tissu_theorique_kg <= 0 then null
    else round(theorique.pieces_obtenues / theorique.poids_tissu_theorique_kg, 3)
  end as rendement_theorique_pieces_par_kg,
  case
    when mesure.odf_id is null
      or (coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0)) <= 0
    then null
    else round(
      theorique.pieces_obtenues / (coalesce(mesure.poids_entrant_kg, 0) - coalesce(mesure.poids_retour_kg, 0)),
      3
    )
  end as rendement_mesure_pieces_par_kg
from theorique
left join mesure on mesure.odf_id = theorique.odf_id;

alter view rendement_par_odf set (security_invoker = on);
