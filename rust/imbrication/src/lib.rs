//! Moteur d'imbrication de Seritex.
//!
//! Reçoit des pièces (contours en mm), une largeur de tissu et des
//! contraintes, et renvoie la position de chaque exemplaire sur le tissu
//! (contrat `seritex.imbrication/v1`, voir `contrat.rs`). Le calcul est fait
//! par sparrow (MIT) au-dessus de jagua-rs (MPL-2.0), utilisés tels quels.
//!
//! Compilé en WebAssembly (cible `wasm32-wasip1`) pour tourner dans Seritex
//! (Node), ou en natif pour le banc d'essai.

pub mod contrat;
pub mod terminateur;

use contrat::{Arret, Entree, Erreur, Placement, Reprise, Sortie, Statut, VERSION_CONTRAT};
use jagua_rs::io::import::Importer;
use jagua_rs::probs::spp::entities::SPSolution;
use jagua_rs::probs::spp::entities::SPInstance;
use jagua_rs::probs::spp::io::ext_repr::{ExtSPInstance, ExtSPSolution};
use rand::SeedableRng;
use rand::rngs::Xoshiro256PlusPlus;
use serde_json::json;
use sparrow::EPOCH;
use sparrow::config::{DEFAULT_SPARROW_CONFIG, ShrinkDecayStrategy};
use sparrow::consts::DEFAULT_FAIL_DECAY_RATIO_CMPR;
use sparrow::optimizer::optimize;
use sparrow::util::listener::{ReportType, SolutionListener};
use std::path::PathBuf;
use std::time::Duration;
use terminateur::{PART_EXPLORATION, Terminateur};

/// Temps maximal accepté pour un calcul (secondes) : au-delà, la demande est
/// presque certainement une erreur de saisie.
pub const TEMPS_MAX_ABSOLU_S: f64 = 4.0 * 3600.0;

/// Tolérance géométrique (mm) pour les contrôles d'entrée.
const EPS: f64 = 1e-6;

/// Pièce préparée : contour ramené près de l'origine (précision des
/// flottants 32 bits du moteur) et décalage à réappliquer au retour.
struct PiecePreparee {
    contour_local: Vec<[f64; 2]>,
    decalage: [f64; 2],
    aire: f64,
}

/// Écouteur muet : sparrow peut signaler chaque solution intermédiaire, nous
/// n'en avons pas besoin ici (pas de fichiers SVG ni de journaux).
struct Silencieux;

impl SolutionListener for Silencieux {
    fn report(&mut self, _report: ReportType, _solution: &SPSolution) {}
}

pub fn imbriquer(entree: &Entree) -> Sortie {
    let graine = entree.calcul.graine;
    let largeur = entree.tissu.largeur_utile;
    match imbriquer_interne(entree) {
        Ok(sortie) => sortie,
        Err(erreur) => Sortie::echec(graine, largeur, erreur),
    }
}

fn fini(v: f64) -> bool {
    v.is_finite()
}

fn aire_signee(points: &[[f64; 2]]) -> f64 {
    let n = points.len();
    let mut s = 0.0;
    for i in 0..n {
        let [x1, y1] = points[i];
        let [x2, y2] = points[(i + 1) % n];
        s += x1 * y2 - x2 * y1;
    }
    s / 2.0
}

/// Hauteur (étendue en Y) d'un contour tourné de `angle` degrés.
fn hauteur_tournee(points: &[[f64; 2]], angle: f64) -> f64 {
    let (s, c) = angle.to_radians().sin_cos();
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &[x, y] in points {
        let ty = x * s + y * c;
        min = min.min(ty);
        max = max.max(ty);
    }
    max - min
}

/// Applique la transformation d'un placement à un point : symétrie y → -y
/// éventuelle, rotation, translation (convention du contrat).
pub fn transformer(p: [f64; 2], rotation: f64, miroir: bool, tx: f64, ty: f64) -> [f64; 2] {
    let (x, y) = (p[0], if miroir { -p[1] } else { p[1] });
    let (s, c) = rotation.to_radians().sin_cos();
    [x * c - y * s + tx, x * s + y * c + ty]
}

fn verifier_entree(entree: &Entree) -> Result<Vec<PiecePreparee>, Erreur> {
    if entree.version != VERSION_CONTRAT {
        return Err(Erreur::new(
            "version_contrat",
            format!("Version de contrat « {} » non prise en charge (attendu : {VERSION_CONTRAT}).", entree.version),
        ));
    }
    let t = &entree.tissu;
    if !fini(t.largeur_utile) || t.largeur_utile <= 0.0 {
        return Err(Erreur::new("largeur_invalide", "La largeur utile du tissu doit être un nombre positif."));
    }
    if !fini(t.marge_lisiere) || t.marge_lisiere < 0.0 || 2.0 * t.marge_lisiere >= t.largeur_utile {
        return Err(Erreur::new(
            "marge_invalide",
            "La marge de lisière doit être positive et laisser de la place au tissu (2 × marge < largeur utile).",
        ));
    }
    if let Some(l) = t.longueur_max
        && (!fini(l) || l <= 0.0)
    {
        return Err(Erreur::new("longueur_max_invalide", "La longueur maximale de table doit être positive."));
    }
    if !fini(entree.espacement) || entree.espacement < 0.0 {
        return Err(Erreur::new("espacement_invalide", "L'espacement entre pièces doit être positif ou nul."));
    }
    let c = &entree.calcul;
    if !fini(c.temps_max_s) || c.temps_max_s <= 0.0 || c.temps_max_s > TEMPS_MAX_ABSOLU_S {
        return Err(Erreur::new(
            "temps_invalide",
            format!("Le temps de calcul doit être compris entre 0 et {} secondes.", TEMPS_MAX_ABSOLU_S as u64),
        ));
    }
    if c.effort == Some(0) {
        return Err(Erreur::new("effort_invalide", "Le budget d'effort doit être d'au moins une itération."));
    }
    if entree.pieces.is_empty() {
        return Err(Erreur::new("aucune_piece", "Aucune pièce à placer."));
    }

    let hauteur_bande = t.largeur_utile - 2.0 * t.marge_lisiere;
    let mut ids = std::collections::HashSet::new();
    let mut preparees = Vec::with_capacity(entree.pieces.len());
    for p in &entree.pieces {
        if p.id.is_empty() {
            return Err(Erreur::new("piece_sans_id", "Une pièce n'a pas d'identifiant."));
        }
        if !ids.insert(p.id.as_str()) {
            return Err(Erreur::piece("piece_en_double", &p.id, format!("La pièce « {} » apparaît deux fois.", p.id)));
        }
        if p.quantite == 0 {
            return Err(Erreur::piece("quantite_nulle", &p.id, format!("La pièce « {} » a une quantité nulle.", p.id)));
        }
        if p.rotations.is_empty() || p.rotations.iter().any(|a| !fini(*a)) {
            return Err(Erreur::piece(
                "rotations_invalides",
                &p.id,
                format!("La pièce « {} » n'a aucune rotation autorisée valable.", p.id),
            ));
        }
        let mut contour: Vec<[f64; 2]> = p.contour.clone();
        if contour.len() >= 2 {
            let (a, b) = (contour[0], contour[contour.len() - 1]);
            if (a[0] - b[0]).abs() < EPS && (a[1] - b[1]).abs() < EPS {
                contour.pop();
            }
        }
        if contour.len() < 3 || contour.iter().any(|q| !fini(q[0]) || !fini(q[1])) {
            return Err(Erreur::piece(
                "contour_invalide",
                &p.id,
                format!("Le contour de la pièce « {} » est incomplet (moins de 3 points ou valeurs invalides).", p.id),
            ));
        }
        let aire = aire_signee(&contour).abs();
        if aire < EPS {
            return Err(Erreur::piece(
                "contour_invalide",
                &p.id,
                format!("Le contour de la pièce « {} » n'a pas de surface.", p.id),
            ));
        }
        // Pièce posée retournée (ex. manche droite d'une paire) : sparrow 0.3.0
        // n'essaie jamais de symétrie (vérifié dans son échantillonneur), on
        // lui donne donc directement le contour retourné.
        if p.miroir {
            contour = contour.iter().rev().map(|q| [q[0], -q[1]]).collect();
        }
        // Le moteur travaille en flottants 32 bits : on ramène le contour près
        // de l'origine pour ne pas perdre de précision sur des coordonnées DXF
        // éloignées, et on réapplique le décalage au retour.
        let min_x = contour.iter().map(|q| q[0]).fold(f64::INFINITY, f64::min);
        let min_y = contour.iter().map(|q| q[1]).fold(f64::INFINITY, f64::min);
        let local: Vec<[f64; 2]> = contour.iter().map(|q| [q[0] - min_x, q[1] - min_y]).collect();

        // Le moteur garde l'espacement aussi contre les bords du tissu
        // (constaté : première pièce à marge + espacement de la lisière).
        let hauteur_min = p.rotations.iter().map(|a| hauteur_tournee(&local, *a)).fold(f64::INFINITY, f64::min);
        if hauteur_min + 2.0 * entree.espacement > hauteur_bande + EPS {
            return Err(Erreur::piece(
                "piece_trop_large",
                &p.id,
                format!(
                    "La pièce « {} » mesure au moins {:.1} cm de large dans les sens autorisés : elle ne tient pas dans la largeur utilisable du tissu ({:.1} cm).",
                    p.id,
                    hauteur_min / 10.0,
                    hauteur_bande / 10.0
                ),
            ));
        }
        preparees.push(PiecePreparee { contour_local: local, decalage: [min_x, min_y], aire });
    }
    Ok(preparees)
}

fn imbriquer_interne(entree: &Entree) -> Result<Sortie, Erreur> {
    let debut = jagua_rs::Instant::now();
    let preparees = verifier_entree(entree)?;
    let t = &entree.tissu;
    let hauteur_bande = t.largeur_utile - 2.0 * t.marge_lisiere;

    // Instance au format jagua-rs, construite en JSON pour suivre exactement
    // le format documenté (et ses contrôles de validité).
    let items: Vec<_> = entree
        .pieces
        .iter()
        .zip(&preparees)
        .enumerate()
        .map(|(i, (p, prep))| {
            let orientation = json!({ "rotation": { "mode": "discrete", "angles": p.rotations } });
            json!({
                "id": i,
                "demand": p.quantite,
                "orientation": orientation,
                "shape": { "type": "simple_polygon", "data": prep.contour_local },
            })
        })
        .collect();
    let instance_json = json!({
        "name": "seritex",
        "min_item_separation": entree.espacement,
        "items": items,
        "strip_height": hauteur_bande,
    });
    let ext: ExtSPInstance = serde_json::from_value(instance_json)
        .map_err(|e| Erreur::new("instance_invalide", format!("Données refusées par le moteur : {e}")))?;

    let mut config = DEFAULT_SPARROW_CONFIG;
    let temps_max = Duration::from_secs_f64(entree.calcul.temps_max_s);
    // En mode temps, une petite réserve laisse la compression finir avant le garde-fou.
    let temps_phases = temps_max.mul_f64(0.97);
    config.expl_cfg.time_limit = temps_phases.mul_f64(PART_EXPLORATION);
    config.cmpr_cfg.time_limit = temps_phases.mul_f64(1.0 - PART_EXPLORATION);
    if entree.calcul.effort.is_some() {
        // La décroissance « au temps » de la compression dépend du chronomètre :
        // en mode reproductible, on la règle sur les échecs successifs.
        config.cmpr_cfg.shrink_decay = ShrinkDecayStrategy::FailureBased(DEFAULT_FAIL_DECAY_RATIO_CMPR);
    }

    let importer = Importer::new(config.cde_config, config.poly_simpl_tolerance, config.narrow_concavity_cutoff_ratio);
    let instance = jagua_rs::probs::spp::io::import_instance(&importer, &ext).map_err(|e| {
        Erreur::new(
            "contour_invalide",
            format!("Une pièce n'a pas pu être préparée par le moteur (contour croisé ou dégénéré ?) : {e}"),
        )
    })?;

    let solution_initiale = match &entree.reprise {
        None => None,
        Some(reprise) => Some(solution_de_reprise(entree, &preparees, &instance, reprise)?),
    };

    let mut terminateur = Terminateur::new(
        temps_max,
        entree.calcul.effort,
        entree.calcul.fichier_annulation.as_ref().map(PathBuf::from),
    );
    let solution = optimize(
        instance,
        Xoshiro256PlusPlus::seed_from_u64(entree.calcul.graine),
        &mut Silencieux,
        &mut terminateur,
        &config.expl_cfg,
        &config.cmpr_cfg,
        solution_initiale.as_ref(),
    )
    .map_err(|e| Erreur::new("moteur", format!("Le moteur d'imbrication a échoué : {e}")))?;

    let export = jagua_rs::probs::spp::io::export(&solution, *EPOCH);
    let mut placements = Vec::with_capacity(export.layout.placed_items.len());
    let mut longueur: f64 = 0.0;
    let mut aire_totale = 0.0;
    for pi in &export.layout.placed_items {
        let i = pi.item_id as usize;
        let (piece, prep) = (&entree.pieces[i], &preparees[i]);
        let tr = &pi.transformation;
        let rotation = tr.rotation as f64;
        // Le moteur a placé le contour local (contour de base, retourné si la
        // pièce l'est, décalé de `decalage`) : on exprime la transformation
        // pour le contour d'ORIGINE. Les symétries se composent (ou exclusif).
        let d = transformer(prep.decalage, rotation, tr.reflected, 0.0, 0.0);
        let x = tr.translation.0 as f64 - d[0];
        let y = tr.translation.1 as f64 - d[1] + t.marge_lisiere;
        let miroir = piece.miroir ^ tr.reflected;
        for q in &prep.contour_local {
            let base = [q[0] + prep.decalage[0], q[1] + prep.decalage[1]];
            longueur = longueur.max(transformer(base, rotation, tr.reflected, x, y)[0]);
        }
        aire_totale += prep.aire;
        placements.push(Placement { piece_id: piece.id.clone(), x, y, rotation: normaliser_angle(rotation), miroir });
    }

    let arret = terminateur.cause();
    let statut = if arret == Arret::Annulation { Statut::Annule } else { Statut::Termine };
    Ok(Sortie {
        version: VERSION_CONTRAT.into(),
        statut,
        erreur: None,
        reproductible: arret == Arret::BudgetEffort,
        arret: Some(arret),
        longueur,
        largeur_utile: t.largeur_utile,
        taux_utilisation: if longueur > 0.0 { aire_totale / (longueur * t.largeur_utile) } else { 0.0 },
        depasse_longueur_max: t.longueur_max.is_some_and(|l| longueur > l + EPS),
        temps_calcul_s: debut.elapsed().as_secs_f64(),
        effort_utilise: terminateur.effort_utilise(),
        graine: entree.calcul.graine,
        moteur: Sortie::moteur(),
        placements,
    })
}

/// Ramène un angle dans [0, 360).
fn normaliser_angle(a: f64) -> f64 {
    let r = a.rem_euclid(360.0);
    if (r - 360.0).abs() < 1e-6 { 0.0 } else { r }
}

/// Reconstruit la solution du moteur à partir des placements d'une tranche
/// précédente (transformation inverse de celle appliquée en sortie).
fn solution_de_reprise(
    entree: &Entree,
    preparees: &[PiecePreparee],
    instance: &SPInstance,
    reprise: &Reprise,
) -> Result<SPSolution, Erreur> {
    let invalide = |m: String| Erreur::new("reprise_invalide", format!("Reprise du calcul impossible : {m}"));
    let marge = entree.tissu.marge_lisiere;
    let mut longueur: f64 = 0.0;
    let mut items = Vec::with_capacity(reprise.placements.len());
    for pl in &reprise.placements {
        let i = entree
            .pieces
            .iter()
            .position(|p| p.id == pl.piece_id)
            .ok_or_else(|| invalide(format!("pièce « {} » inconnue", pl.piece_id)))?;
        let (piece, prep) = (&entree.pieces[i], &preparees[i]);
        let reflechi = pl.miroir ^ piece.miroir;
        let d = transformer(prep.decalage, pl.rotation, reflechi, 0.0, 0.0);
        let tx = pl.x + d[0];
        let ty = pl.y - marge + d[1];
        for q in &prep.contour_local {
            let base = [q[0] + prep.decalage[0], q[1] + prep.decalage[1]];
            longueur = longueur.max(transformer(base, pl.rotation, reflechi, pl.x, pl.y)[0]);
        }
        items.push(json!({
            "item_id": i,
            "transformation": { "reflected": reflechi, "rotation": pl.rotation, "translation": [tx, ty] },
        }));
    }
    let ext: ExtSPSolution = serde_json::from_value(json!({
        "strip_width": longueur + 1e-3,
        "layout": { "container_id": 0, "placed_items": items, "density": 0.0 },
        "density": 0.0,
        "run_time_sec": 0,
    }))
    .map_err(|e| invalide(e.to_string()))?;
    jagua_rs::probs::spp::io::import_solution(instance, &ext).map_err(|e| invalide(e.to_string()))
}
