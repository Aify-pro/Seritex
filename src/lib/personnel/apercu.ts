import type { LigneImport } from "./import";

/**
 * Corrections dans l'aperçu d'un import (migration 0159). Fonctions PURES :
 * l'aperçu garde les valeurs du fichier (`brut`) de chaque ligne ; corriger une
 * ligne, c'est modifier ces valeurs puis contrôler de nouveau tout le fichier ;
 * exclure une ligne, c'est l'écarter de l'import (réversible).
 */

export const MESSAGE_EXCLUSION = "Exclue de l'import (rien n'est enregistré pour cette ligne)";

export function compterLignes(lignes: LigneImport[]) {
  return {
    nb_erreurs: lignes.filter((l) => l.erreurs.length > 0).length,
    nb_creations: lignes.filter((l) => l.action === "creer" && l.erreurs.length === 0).length,
    nb_modifications: lignes.filter((l) => l.action === "modifier" && l.erreurs.length === 0).length,
  };
}

export function exclureLigne(l: LigneImport): LigneImport {
  if (l.exclue) return l;
  return {
    ...l,
    exclue: true,
    origine: { action: l.action, erreurs: l.erreurs, avertissements: l.avertissements },
    action: "ignorer",
    erreurs: [],
    avertissements: [MESSAGE_EXCLUSION],
  };
}

/** Réintègre une ligne exclue, dans l'état où elle était avant son exclusion. */
export function reintegrerLigne(l: LigneImport): LigneImport {
  if (!l.exclue || !l.origine) return l;
  const { exclue: _e, origine, ...reste } = l;
  void _e;
  return { ...reste, action: origine.action, erreurs: origine.erreurs, avertissements: origine.avertissements };
}

/**
 * Tableau de cellules du fichier avec la correction appliquée à une ligne
 * (en-tête + une ligne par ligne de l'aperçu, dans l'ordre d'origine).
 */
export function tableauCorrige(lignes: LigneImport[], numero: number, champs: Record<string, string>): string[][] {
  const enTete = Object.keys(lignes[0]?.brut ?? {});
  return [
    enTete,
    ...lignes.map((l) => enTete.map((h) => (l.ligne === numero && h in champs ? String(champs[h] ?? "").trim().slice(0, 300) : (l.brut?.[h] ?? "")))),
  ];
}

/** Applique à un nouveau contrôle les exclusions de l'aperçu précédent. */
export function conserverExclusions(nouvelles: LigneImport[], anciennes: LigneImport[]): LigneImport[] {
  const exclues = new Set(anciennes.filter((l) => l.exclue).map((l) => l.ligne));
  return nouvelles.map((l) => (exclues.has(l.ligne) ? exclureLigne(l) : l));
}
