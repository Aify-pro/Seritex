//! Point d'entrée : lit une entrée `seritex.imbrication/v1` (JSON) sur l'entrée
//! standard, écrit la sortie (JSON) sur la sortie standard. Toujours une
//! sortie JSON, y compris en cas d'erreur (`statut: "echec"`).

use seritex_imbrication::contrat::{Entree, Erreur, Sortie};
use std::io::{Read, Write};

fn main() {
    let mut texte = String::new();
    let sortie = match std::io::stdin().read_to_string(&mut texte) {
        Err(e) => Sortie::echec(0, 0.0, Erreur::new("entree_illisible", format!("Lecture de l'entrée impossible : {e}"))),
        Ok(_) => match serde_json::from_str::<Entree>(&texte) {
            Err(e) => Sortie::echec(
                0,
                0.0,
                Erreur::new("entree_illisible", format!("Entrée du moteur mal formée : {e}")),
            ),
            Ok(entree) => seritex_imbrication::imbriquer(&entree),
        },
    };
    let json = serde_json::to_string(&sortie).expect("sortie sérialisable");
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(json.as_bytes());
    let _ = out.write_all(b"\n");
}
