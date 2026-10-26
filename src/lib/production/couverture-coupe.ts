/**
 * Couverture de coupe d'un ODF (TR-1b, migration 0148), lue par
 * couverture_coupe() : par article et par taille, demandé, coupé (matelas
 * clôturés), à couper (tracés Bon pour coupe ou en coupe), en préparation
 * (tracés pas encore validés) et écart = coupé + à couper − demandé. Aucune
 * tolérance : tout écart non nul est signalé. Module pur.
 */

export interface CouvertureRow {
  line_id: string;
  description: string;
  taille: string;
  demande: number;
  coupe: number;
  a_couper: number;
  en_preparation: number;
  projete: number;
  ecart: number;
}

export interface CouvertureArticle {
  lineId: string;
  description: string;
  tailles: Omit<CouvertureRow, "line_id" | "description">[];
}

export function groupCouverture(rows: CouvertureRow[]): CouvertureArticle[] {
  const map = new Map<string, CouvertureArticle>();
  for (const r of rows) {
    const a = map.get(r.line_id) ?? { lineId: r.line_id, description: r.description, tailles: [] };
    a.tailles.push({ taille: r.taille, demande: r.demande, coupe: r.coupe, a_couper: r.a_couper, en_preparation: r.en_preparation, projete: r.projete, ecart: r.ecart });
    map.set(r.line_id, a);
  }
  return [...map.values()];
}

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;

/** Résumé lisible des écarts non nuls (« T-shirt blanc : il manque 10 L ; surplus +2 M »), ou null. */
export function resumeEcarts(articles: CouvertureArticle[]): string | null {
  const parts = articles
    .map((a) => {
      const manquants = a.tailles.filter((t) => t.ecart < 0).map((t) => `${-t.ecart} ${libelleTaille(t.taille)}`);
      const surplus = a.tailles.filter((t) => t.ecart > 0).map((t) => `+${t.ecart} ${libelleTaille(t.taille)}`);
      if (!manquants.length && !surplus.length) return null;
      return `${a.description} : ${[manquants.length ? `il manque ${manquants.join(", ")}` : null, surplus.length ? `surplus ${surplus.join(", ")}` : null]
        .filter(Boolean)
        .join(" ; ")}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Surplus qu'un matelas pas encore coupé créerait, par taille : la part du
 * surplus projeté de l'article qui vient de ce tracé (au plus ses pièces).
 */
export function surplusSiCoupe(article: CouvertureArticle | undefined, piecesDuTrace: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of article?.tailles ?? []) {
    const n = Math.min(Math.max(t.ecart, 0), piecesDuTrace[t.taille] ?? 0);
    if (n > 0) out[t.taille] = n;
  }
  return out;
}
