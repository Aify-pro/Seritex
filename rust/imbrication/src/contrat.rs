//! Contrat JSON `seritex.imbrication/v1` : ce que Seritex envoie au moteur et
//! ce qu'il en reçoit. Le même contrat est décrit côté TypeScript (Zod) dans
//! `src/lib/imbrication/contrat.ts` et documenté dans `docs/imbrication.md` :
//! toute modification doit être faite aux trois endroits, et un changement
//! incompatible impose une nouvelle version (`seritex.imbrication/v2`).
//!
//! Unités : millimètres et degrés. Repère : X = longueur du tissu (sens du
//! rouleau), Y = largeur (laize). Le tracé commence en X = 0 ; Y = 0 est la
//! lisière basse.

use serde::{Deserialize, Serialize};

pub const VERSION_CONTRAT: &str = "seritex.imbrication/v1";

/// Version du moteur sparrow embarqué (tag figé dans Cargo.toml).
pub const VERSION_SPARROW: &str = "0.3.0";
/// Version de jagua-rs embarquée (exigée par sparrow 0.3.0).
pub const VERSION_JAGUA: &str = "1.0.0";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entree {
    pub version: String,
    pub tissu: Tissu,
    /// Distance minimale entre deux pièces (mm). 0 par défaut.
    #[serde(default)]
    pub espacement: f64,
    pub calcul: Calcul,
    pub pieces: Vec<Piece>,
    /// Reprise d'un calcul : le moteur repart de ces placements (meilleur
    /// tracé d'une tranche précédente) au lieu de construire un premier
    /// tracé. Sert à dépasser la durée maximale d'une fonction serveur en
    /// enchaînant des tranches. Ajout compatible : absent = départ de zéro.
    #[serde(default)]
    pub reprise: Option<Reprise>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Reprise {
    pub placements: Vec<Placement>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tissu {
    /// Largeur utile du tissu (mm), lisières déjà retirées.
    pub largeur_utile: f64,
    /// Marge de sécurité supplémentaire le long de chaque lisière (mm).
    #[serde(default)]
    pub marge_lisiere: f64,
    /// Longueur maximale de la table de coupe (mm). Le moteur ne la plafonne
    /// pas : un dépassement est signalé dans la sortie (`depasse_longueur_max`).
    #[serde(default)]
    pub longueur_max: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Calcul {
    /// Temps maximal du calcul (secondes). Toujours respecté : c'est le
    /// garde-fou, quel que soit le mode.
    pub temps_max_s: f64,
    /// Graine du générateur aléatoire.
    pub graine: u64,
    /// Budget d'effort (nombre d'itérations du moteur). Quand il est fourni,
    /// le calcul s'arrête sur ce budget et non sur le temps : même entrée +
    /// même graine + même effort = même tracé, sur n'importe quelle machine
    /// (tant que `temps_max_s` n'est pas atteint avant). Sans effort, le
    /// moteur utilise tout `temps_max_s` (meilleure qualité, pas reproductible).
    #[serde(default)]
    pub effort: Option<u64>,
    /// Chemin d'un fichier dont l'apparition demande l'arrêt du calcul
    /// (annulation). Le moteur rend alors la meilleure solution trouvée.
    #[serde(default)]
    pub fichier_annulation: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Piece {
    /// Identifiant choisi par Seritex, renvoyé tel quel dans les placements.
    pub id: String,
    /// Contour extérieur de la pièce (mm), au moins 3 points, sans répéter
    /// le premier point à la fin (toléré : il est retiré).
    pub contour: Vec<[f64; 2]>,
    /// Nombre d'exemplaires à placer.
    pub quantite: u32,
    /// Angles autorisés (degrés), par ex. [0, 180] pour une pièce qui suit
    /// le sens du rouleau.
    pub rotations: Vec<f64>,
    /// Pièce posée retournée (symétrie y → -y, qui garde le droit-fil
    /// parallèle au rouleau), par ex. la manche droite d'une paire dont le
    /// patron est la manche gauche. Tous ses exemplaires sont retournés :
    /// sparrow 0.3.0 ne choisit jamais lui-même de retourner une pièce.
    #[serde(default)]
    pub miroir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Statut {
    /// Calcul mené jusqu'au bout de son budget.
    Termine,
    /// Calcul arrêté à la demande : `placements` contient la meilleure
    /// solution trouvée jusque-là.
    Annule,
    /// Pas de tracé : voir `erreur`.
    Echec,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Arret {
    BudgetEffort,
    BudgetTemps,
    TempsMax,
    Annulation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Erreur {
    /// Code stable, exploitable par le programme (ex. `piece_trop_large`).
    pub code: String,
    /// Message en français, lisible par un utilisateur non technique.
    pub message: String,
    /// Pièce concernée, le cas échéant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub piece_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Moteur {
    pub nom: String,
    pub version: String,
    pub jagua_rs: String,
    pub wrapper: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placement {
    pub piece_id: String,
    /// Transformation appliquée au contour d'ORIGINE de la pièce, dans cet
    /// ordre : symétrie (y → -y) si `miroir`, puis rotation de `rotation`
    /// degrés autour de l'origine, puis translation de (x, y).
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub miroir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sortie {
    pub version: String,
    pub statut: Statut,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erreur: Option<Erreur>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arret: Option<Arret>,
    /// Longueur du tracé (mm) : bord droit de la pièce la plus éloignée.
    pub longueur: f64,
    pub largeur_utile: f64,
    /// Surface des pièces / (longueur × largeur utile), entre 0 et 1.
    pub taux_utilisation: f64,
    pub depasse_longueur_max: bool,
    pub temps_calcul_s: f64,
    /// Itérations consommées (unité du budget d'effort).
    pub effort_utilise: u64,
    /// Vrai si le calcul s'est arrêté sur son budget d'effort : le relancer
    /// avec la même entrée redonne exactement ce tracé.
    pub reproductible: bool,
    pub graine: u64,
    pub moteur: Moteur,
    pub placements: Vec<Placement>,
}

impl Sortie {
    pub fn moteur() -> Moteur {
        Moteur {
            nom: "sparrow".into(),
            version: VERSION_SPARROW.into(),
            jagua_rs: VERSION_JAGUA.into(),
            wrapper: env!("CARGO_PKG_VERSION").into(),
        }
    }

    pub fn echec(graine: u64, largeur_utile: f64, erreur: Erreur) -> Sortie {
        Sortie {
            version: VERSION_CONTRAT.into(),
            statut: Statut::Echec,
            erreur: Some(erreur),
            arret: None,
            longueur: 0.0,
            largeur_utile,
            taux_utilisation: 0.0,
            depasse_longueur_max: false,
            temps_calcul_s: 0.0,
            effort_utilise: 0,
            reproductible: false,
            graine,
            moteur: Sortie::moteur(),
            placements: vec![],
        }
    }
}

impl Erreur {
    pub fn new(code: &str, message: impl Into<String>) -> Erreur {
        Erreur { code: code.into(), message: message.into(), piece_id: None }
    }

    pub fn piece(code: &str, piece_id: &str, message: impl Into<String>) -> Erreur {
        Erreur { code: code.into(), message: message.into(), piece_id: Some(piece_id.into()) }
    }
}
