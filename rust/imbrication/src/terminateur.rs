//! Règle d'arrêt du moteur.
//!
//! sparrow interroge régulièrement un « terminateur » (`kill()`) et lui
//! annonce le budget de chaque phase (`new_timeout`) : exploration (80 %) puis
//! compression (20 %). Celui de sparrow s'arrête au chronomètre, ce qui rend
//! deux calculs identiques différents (constaté : 62,12 puis 62,30 avec la
//! même graine). Le nôtre sait compter des itérations à la place.
//!
//! Trois causes d'arrêt, la première atteinte l'emporte :
//! - le budget de la phase (effort en itérations, ou temps) ;
//! - le temps maximal du calcul (garde-fou, toujours actif) ;
//! - l'apparition du fichier d'annulation.

use jagua_rs::Instant;
use sparrow::util::terminator::Terminator;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use crate::contrat::Arret;

/// Part du budget d'effort consacrée à l'exploration (le reste : compression).
/// Même répartition que sparrow pour le temps.
pub const PART_EXPLORATION: f64 = 0.8;

/// Le fichier d'annulation est cherché toutes les N interrogations : un accès
/// au système de fichiers coûte quelques microsecondes, une itération du
/// moteur plusieurs millisecondes ; 4 garde une annulation quasi immédiate.
const PERIODE_ANNULATION: u64 = 4;

pub struct Terminateur {
    echeance_max: Instant,
    effort_total: Option<u64>,
    /// Mode effort : limite (en itérations cumulées) de la phase en cours.
    limite_phase: AtomicU64,
    /// Mode temps : échéance de la phase en cours.
    echeance_phase: Option<Instant>,
    phases_annoncees: u32,
    compteur: AtomicU64,
    annulation: Option<PathBuf>,
    annule: AtomicBool,
    cause: Mutex<Option<Arret>>,
}

impl Terminateur {
    pub fn new(temps_max: Duration, effort_total: Option<u64>, annulation: Option<PathBuf>) -> Self {
        Terminateur {
            echeance_max: Instant::now() + temps_max,
            effort_total,
            limite_phase: AtomicU64::new(u64::MAX),
            echeance_phase: None,
            phases_annoncees: 0,
            compteur: AtomicU64::new(0),
            annulation,
            annule: AtomicBool::new(false),
            cause: Mutex::new(None),
        }
    }

    pub fn effort_utilise(&self) -> u64 {
        self.compteur.load(Ordering::Relaxed)
    }

    /// Cause du dernier arrêt. Une phase de compression achevée normalement
    /// (sans `kill`) ne laisse pas de cause : on retombe alors sur le budget.
    pub fn cause(&self) -> Arret {
        let cause = self.cause.lock().unwrap().clone();
        match cause {
            // Annulation et temps maximal priment : ils empêchent la reproductibilité.
            Some(c) => c,
            None if self.effort_total.is_some() => Arret::BudgetEffort,
            None => Arret::BudgetTemps,
        }
    }

    fn noter(&self, arret: Arret) {
        let mut cause = self.cause.lock().unwrap();
        // Une annulation ou un temps maximal ne doit jamais être masqué par
        // l'arrêt de budget d'une phase suivante.
        match (&*cause, &arret) {
            (Some(Arret::Annulation | Arret::TempsMax), _) => {}
            _ => *cause = Some(arret),
        }
    }
}

impl Terminator for Terminateur {
    fn kill(&self) -> bool {
        let n = self.compteur.fetch_add(1, Ordering::Relaxed) + 1;

        if self.annule.load(Ordering::Relaxed) {
            return true;
        }
        if let Some(fichier) = &self.annulation
            && n % PERIODE_ANNULATION == 0
            && fichier.exists()
        {
            self.annule.store(true, Ordering::Relaxed);
            self.noter(Arret::Annulation);
            return true;
        }
        if Instant::now() > self.echeance_max {
            self.noter(Arret::TempsMax);
            return true;
        }
        match self.effort_total {
            Some(_) => {
                if n > self.limite_phase.load(Ordering::Relaxed) {
                    self.noter(Arret::BudgetEffort);
                    return true;
                }
            }
            None => {
                if self.echeance_phase.is_some_and(|e| Instant::now() > e) {
                    self.noter(Arret::BudgetTemps);
                    return true;
                }
            }
        }
        false
    }

    fn new_timeout(&mut self, timeout: Duration) {
        self.phases_annoncees += 1;
        match self.effort_total {
            Some(total) => {
                // Phase 1 (exploration) : 80 % de l'effort ; phase 2
                // (compression) : le reste, quel que soit ce que l'exploration
                // a réellement consommé.
                let fin = if self.phases_annoncees == 1 {
                    (total as f64 * PART_EXPLORATION).round() as u64
                } else {
                    let deja = self.compteur.load(Ordering::Relaxed);
                    deja + (total as f64 * (1.0 - PART_EXPLORATION)).round() as u64
                };
                self.limite_phase.store(fin, Ordering::Relaxed);
            }
            None => self.echeance_phase = Some(Instant::now() + timeout),
        }
    }

    fn timeout_at(&self) -> Option<Instant> {
        match self.effort_total {
            Some(_) => Some(self.echeance_max),
            None => self.echeance_phase,
        }
    }
}
