/**
 * Exécution des calculs d'imbrication en arrière-plan, par TRANCHES.
 *
 * Un calcul (table imbrication_calculs) peut demander plus de temps qu'une
 * fonction serveur n'en a (300 s sur Vercel). Chaque passage exécute donc
 * une tranche, qui repart du meilleur tracé de la précédente (reprise du
 * moteur), puis remet le calcul « en attente » s'il lui reste du temps.
 * Sur un serveur Seritex sans limite de durée, une seule tranche suffit
 * (IMBRICATION_TRANCHE_S).
 *
 * Pendant une tranche : signe de vie toutes les quelques secondes (un calcul
 * muet est repris par la base, cf. prendre_calcul_imbrication) et lecture
 * de la demande d'annulation, transmise au moteur.
 *
 * Règle d'or : un calcul ne passe « terminé » qu'avec un tracé validé par
 * Seritex. Un tracé refusé par le contrôle n'est jamais retenu ; s'il n'y a
 * aucun tracé valide, le calcul est en échec, avec la raison.
 *
 * Le stockage est injecté (`StoreCalculs`) : la logique se teste sans base.
 */
import type { EntreeImbricationNormalisee, SortieImbrication } from "./contrat";
import type { CalculImbrication, ResultatMoteur } from "./moteur";
import type { ResultatValidation } from "./validation";

export type StatutCalcul = "en_attente" | "en_cours" | "termine" | "echec" | "annule";

/** Calcul tel que réservé pour une tranche. */
export interface CalculReserve {
  id: string;
  entree: EntreeImbricationNormalisee;
  temps_total_s: number;
  temps_consomme_s: number;
  tranches: number;
  meilleur: SortieImbrication | null;
  validation: ResultatValidation | null;
  annulation_demandee_le: string | null;
}

export interface MiseAJourCalcul {
  statut: StatutCalcul;
  temps_consomme_s: number;
  tranches: number;
  meilleur: SortieImbrication | null;
  validation: ResultatValidation | null;
  longueur_mm: number | null;
  taux_utilisation: number | null;
  reproductible: boolean | null;
  erreur_code: string | null;
  erreur_message: string | null;
  fin_le: string | null;
}

export interface StoreCalculs {
  prendre(): Promise<CalculReserve | null>;
  /** Signe de vie ; rend vrai si l'annulation a été demandée. */
  signeDeVie(id: string): Promise<boolean>;
  enregistrer(id: string, maj: MiseAJourCalcul): Promise<void>;
}

export type LanceurMoteur = (entree: EntreeImbricationNormalisee) => CalculImbrication;

export interface OptionsExecution {
  /** Durée maximale d'une tranche (s). */
  dureeTrancheS: number;
  /** Intervalle des signes de vie (ms). */
  intervalleSigneDeVieMs?: number;
}

/** En dessous, le reste de temps d'un calcul ne vaut pas une tranche de plus. */
const RESTE_MINIMAL_S = 5;

/** Le meilleur des deux tracés valides (le plus court). */
function meilleurDe(a: { sortie: SortieImbrication; validation: ResultatValidation } | null, b: { sortie: SortieImbrication; validation: ResultatValidation }) {
  if (!a) return b;
  return b.validation.longueurMm < a.validation.longueurMm ? b : a;
}

/**
 * Exécute UNE tranche du calcul et rend la mise à jour à enregistrer.
 */
export async function executerTranche(calcul: CalculReserve, store: StoreCalculs, lancer: LanceurMoteur, options: OptionsExecution): Promise<MiseAJourCalcul> {
  const precedent =
    calcul.meilleur && calcul.validation?.valide ? { sortie: calcul.meilleur, validation: calcul.validation } : null;
  const effort = calcul.entree.calcul.effort;
  const reste = Math.max(0, calcul.temps_total_s - calcul.temps_consomme_s);
  const duree = Math.max(1, Math.min(reste, options.dureeTrancheS));

  const fin = (statut: StatutCalcul, retenu: typeof precedent, extra: Partial<MiseAJourCalcul> = {}, consomme = 0): MiseAJourCalcul => ({
    statut,
    temps_consomme_s: calcul.temps_consomme_s + consomme,
    tranches: calcul.tranches + 1,
    meilleur: retenu?.sortie ?? null,
    validation: retenu?.validation ?? null,
    longueur_mm: retenu?.validation.longueurMm ?? null,
    taux_utilisation: retenu?.validation.tauxUtilisation ?? null,
    reproductible: retenu ? retenu.sortie.reproductible && calcul.tranches === 0 : null,
    erreur_code: null,
    erreur_message: null,
    fin_le: statut === "en_attente" ? null : new Date().toISOString(),
    ...extra,
  });

  // Annulé avant même de démarrer la tranche.
  if (calcul.annulation_demandee_le) return fin("annule", precedent);

  const entree: EntreeImbricationNormalisee = {
    ...calcul.entree,
    calcul: {
      ...calcul.entree.calcul,
      temps_max_s: duree,
      // Une graine par tranche : la suite des tranches reste reproductible.
      graine: calcul.entree.calcul.graine + calcul.tranches,
      fichier_annulation: null,
    },
    reprise: precedent ? { placements: precedent.sortie.placements } : null,
  };

  const execution = lancer(entree);
  let annulationDemandee = false;
  const minuterie = setInterval(() => {
    store
      .signeDeVie(calcul.id)
      .then((annuler) => {
        if (annuler && !annulationDemandee) {
          annulationDemandee = true;
          void execution.annuler();
        }
      })
      .catch(() => {});
  }, options.intervalleSigneDeVieMs ?? 5000);

  let r: ResultatMoteur;
  try {
    r = await execution.resultat;
  } finally {
    clearInterval(minuterie);
  }

  if (!r.ok) {
    // Une tranche ratée ne fait pas perdre le tracé valide déjà trouvé.
    if (precedent) return fin("termine", precedent, { erreur_code: null, erreur_message: null });
    return fin("echec", null, { erreur_code: r.code, erreur_message: r.message });
  }

  const consomme = r.sortie.temps_calcul_s;
  if (!r.validation.valide) {
    console.error("[imbrication] tracé refusé par le contrôle", calcul.id, r.validation.problemes.slice(0, 5));
    if (precedent) return fin("termine", precedent, {}, consomme);
    return fin(
      "echec",
      null,
      {
        erreur_code: "trace_invalide",
        erreur_message: `Le tracé calculé a été refusé par le contrôle de Seritex : ${r.validation.problemes[0]?.message ?? "raison inconnue"}`,
      },
      consomme
    );
  }

  const retenu = meilleurDe(precedent, { sortie: r.sortie, validation: r.validation });
  if (r.sortie.statut === "annule" || annulationDemandee) return fin("annule", retenu, {}, consomme);

  const resteApres = calcul.temps_total_s - (calcul.temps_consomme_s + consomme);
  // Calcul à budget d'effort : une seule tranche (c'est ce qui le rend reproductible).
  const continuer = effort == null && resteApres >= RESTE_MINIMAL_S && r.sortie.arret !== "budget_effort";
  return fin(continuer ? "en_attente" : "termine", retenu, {}, consomme);
}

/**
 * Traite des calculs tant que le temps de la fonction le permet.
 * `tempsDisponibleS` : durée restante de la fonction serveur.
 */
export async function traiterCalculs(
  store: StoreCalculs,
  lancer: LanceurMoteur,
  options: OptionsExecution & { tempsDisponibleS: number }
): Promise<{ traites: string[] }> {
  const debut = Date.now();
  const traites: string[] = [];
  const marge = 30;
  for (;;) {
    const restant = options.tempsDisponibleS - (Date.now() - debut) / 1000 - marge;
    if (restant < 10) break;
    const calcul = await store.prendre();
    if (!calcul) break;
    const maj = await executerTranche(calcul, store, lancer, { ...options, dureeTrancheS: Math.min(options.dureeTrancheS, restant) });
    await store.enregistrer(calcul.id, maj);
    traites.push(calcul.id);
  }
  return { traites };
}
