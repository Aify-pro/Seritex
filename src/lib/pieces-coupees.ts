/**
 * Pièces coupées par semi-fini (migration 0146), figées à chaque clôture de
 * matelas : regroupement pour l'affichage (fiche ODF, onglet Stock tampon du
 * semi-fini). Module pur — banc : scripts/test-production-report.ts.
 *
 * Coupé = pièces reconnues sur le tracé × couches réelles (source « trace ») ;
 * attendu = t-shirts obtenus × quantité de la nomenclature (source
 * « nomenclature »), pour les semi-finis seulement.
 */

export type PieceCoupeeStatut = "semi_fini" | "non_rattachee" | "non_reconnue";

export interface PieceCoupeeRow {
  source: "trace" | "nomenclature";
  statut: PieceCoupeeStatut;
  semi_fini_id: string | null;
  piece: string;
  taille: string | null;
  quantite: number;
}

export interface PieceCoupeeGroupe {
  key: string;
  statut: PieceCoupeeStatut;
  semiFiniId: string | null;
  libelle: string;
  /** Coupé par taille du patron (« — » si inconnue). */
  parTaille: Record<string, number>;
  coupe: number;
  /** Null hors semi-fini (aucune nomenclature à comparer). */
  attendu: number | null;
  /** Coupé − attendu : négatif = pièces manquantes, positif = en plus. */
  ecart: number | null;
}

export const PIECE_STATUT_LABELS: Record<PieceCoupeeStatut, string> = {
  semi_fini: "Semi-fini",
  non_rattachee: "Non rattachée à un semi-fini",
  non_reconnue: "Non reconnue sur le tracé",
};

const ORDRE: Record<PieceCoupeeStatut, number> = { semi_fini: 0, non_rattachee: 1, non_reconnue: 2 };

/**
 * Regroupe les lignes figées : un groupe par semi-fini (libellé = nom du
 * semi-fini, fourni par `semiFiniName`), un par pièce non rattachée, un pour
 * les pièces non reconnues. Les tailles sont rendues dans l'ordre d'apparition.
 */
export function groupPiecesCoupees(rows: PieceCoupeeRow[], semiFiniName: (id: string) => string | null): { groupes: PieceCoupeeGroupe[]; tailles: string[] } {
  const map = new Map<string, PieceCoupeeGroupe>();
  const tailles: string[] = [];
  for (const r of rows) {
    const key = r.statut === "semi_fini" ? `sf:${r.semi_fini_id}` : `${r.statut}:${r.piece}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        statut: r.statut,
        semiFiniId: r.semi_fini_id,
        libelle: (r.semi_fini_id && semiFiniName(r.semi_fini_id)) || r.piece,
        parTaille: {},
        coupe: 0,
        attendu: r.statut === "semi_fini" ? 0 : null,
        ecart: null,
      };
      map.set(key, g);
    }
    const q = Number(r.quantite) || 0;
    if (r.source === "nomenclature") {
      g.attendu = (g.attendu ?? 0) + q;
    } else {
      const t = r.taille ?? "—";
      if (!tailles.includes(t)) tailles.push(t);
      g.parTaille[t] = (g.parTaille[t] ?? 0) + q;
      g.coupe += q;
    }
  }
  const groupes = [...map.values()]
    .map((g) => ({ ...g, ecart: g.attendu === null ? null : g.coupe - g.attendu }))
    .sort((a, b) => ORDRE[a.statut] - ORDRE[b.statut] || a.libelle.localeCompare(b.libelle, "fr"));
  return { groupes, tailles };
}
