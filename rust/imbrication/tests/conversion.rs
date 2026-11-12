//! Tests du module : conversion des coordonnées (contours éloignés de
//! l'origine, pièces retournées, marge de lisière), erreurs en français.
//! Lancer : cargo test --release (le mode debug active les nombreuses
//! vérifications internes de sparrow et devient très lent).

use seritex_imbrication::contrat::{Calcul, Entree, Piece, Statut, Tissu, VERSION_CONTRAT};
use seritex_imbrication::{imbriquer, transformer};

fn entree(pieces: Vec<Piece>, largeur: f64, marge: f64) -> Entree {
    Entree {
        version: VERSION_CONTRAT.into(),
        tissu: Tissu { largeur_utile: largeur, marge_lisiere: marge, longueur_max: Some(10_000.0) },
        espacement: 1.0,
        calcul: Calcul { temps_max_s: 30.0, graine: 3, effort: Some(40), fichier_annulation: None },
        pieces,
    }
}

/// Triangle rectangle asymétrique placé loin de l'origine (coordonnées DXF typiques).
fn triangle_loin() -> Vec<[f64; 2]> {
    vec![[50_000.0, 20_000.0], [50_300.0, 20_000.0], [50_000.0, 20_120.0]]
}

#[test]
fn coordonnees_rendues_pour_le_contour_d_origine() {
    let pieces = vec![
        Piece { id: "t".into(), contour: triangle_loin(), quantite: 3, rotations: vec![0.0, 180.0], miroir: false },
        Piece { id: "t-miroir".into(), contour: triangle_loin(), quantite: 3, rotations: vec![0.0, 180.0], miroir: true },
    ];
    let e = entree(pieces, 400.0, 10.0);
    let s = imbriquer(&e);
    assert_eq!(s.statut, Statut::Termine, "{:?}", s.erreur);
    assert_eq!(s.placements.len(), 6);
    let mut max_x: f64 = 0.0;
    for p in &s.placements {
        let piece = e.pieces.iter().find(|q| q.id == p.piece_id).unwrap();
        assert_eq!(p.miroir, piece.miroir, "retournement conservé");
        for &q in &piece.contour {
            let [x, y] = transformer(q, p.rotation, p.miroir, p.x, p.y);
            assert!(x >= -0.01, "pièce avant le début du tracé : {x}");
            assert!(y >= 10.0 - 0.01 && y <= 390.0 + 0.01, "pièce hors largeur utilisable : {y}");
            max_x = max_x.max(x);
        }
    }
    assert!((max_x - s.longueur).abs() < 1e-6, "longueur = bord droit réel");
    assert!(s.reproductible);
}

#[test]
fn piece_trop_large() {
    let pieces = vec![Piece {
        id: "dos-XL".into(),
        contour: vec![[0.0, 0.0], [100.0, 0.0], [100.0, 500.0], [0.0, 500.0]],
        quantite: 1,
        rotations: vec![0.0],
        miroir: false,
    }];
    let s = imbriquer(&entree(pieces, 400.0, 0.0));
    assert_eq!(s.statut, Statut::Echec);
    let err = s.erreur.unwrap();
    assert_eq!(err.code, "piece_trop_large");
    assert_eq!(err.piece_id.as_deref(), Some("dos-XL"));
    assert!(err.message.contains("ne tient pas"));
}

#[test]
fn une_rotation_de_90_permet_de_tenir() {
    // 500 de long sur 100 de large : ne tient en 400 de laize que couchée.
    let pieces = vec![Piece {
        id: "bande".into(),
        contour: vec![[0.0, 0.0], [100.0, 0.0], [100.0, 500.0], [0.0, 500.0]],
        quantite: 2,
        rotations: vec![0.0, 90.0],
        miroir: false,
    }];
    let s = imbriquer(&entree(pieces, 400.0, 0.0));
    assert_eq!(s.statut, Statut::Termine, "{:?}", s.erreur);
    assert!(s.placements.iter().all(|p| (p.rotation - 90.0).abs() < 1e-3));
}

#[test]
fn version_de_contrat_inconnue() {
    let mut e = entree(vec![], 400.0, 0.0);
    e.version = "seritex.imbrication/v0".into();
    let s = imbriquer(&e);
    assert_eq!(s.erreur.unwrap().code, "version_contrat");
}
