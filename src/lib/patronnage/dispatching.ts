import type { RepartitionTailles } from "./types";

/** Somme toutes tailles confondues d'une répartition. */
export function repartitionTotal(r: RepartitionTailles): number {
  return Object.values(r).reduce((s, v) => s + (v ?? 0), 0);
}

/**
 * Dispatching total d'un ordre de tracé : la somme de ce qui est
 * effectivement posé sur ses tracés (répartition par couche × nombre de
 * plis de chacun), pas une saisie manuelle indépendante. Partagée entre
 * l'écran (affichage) et l'action serveur `linkLine` (vérification à la
 * liaison avec un article d'ODF) pour ne calculer ce total qu'à un seul
 * endroit.
 */
export function repartitionDepuisTraces(traces: { repartitionParCouche: RepartitionTailles; nbPlis: number | null }[]): RepartitionTailles {
  const out: RepartitionTailles = {};
  for (const trace of traces) {
    const plis = trace.nbPlis ?? 0;
    if (plis <= 0) continue;
    for (const [cle, quantite] of Object.entries(trace.repartitionParCouche)) {
      out[cle] = (out[cle] ?? 0) + quantite * plis;
    }
  }
  return out;
}

/** Deux répartitions couvrent-elles exactement les mêmes tailles pour les mêmes quantités ? */
export function sameRepartition(a: RepartitionTailles, b: RepartitionTailles): boolean {
  const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const cle of cles) {
    if ((a[cle] ?? 0) !== (b[cle] ?? 0)) return false;
  }
  return true;
}
