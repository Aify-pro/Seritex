import type { LignePieceDetail } from "@/lib/patronnage/detail";

/**
 * Contenu du cartouche (texte + QR), FORMAT-AGNOSTIQUE — un seul endroit qui
 * décide quoi dire (verdict, troncature des champs trop longs...), partagé
 * par le marquage DXF (dxf-export.ts) et le rendu PDF (trace-pdf.ts) : les
 * deux documents téléchargeables pour un même tracé doivent dire exactement
 * la même chose. La MISE EN PAGE (positions, tailles, orientation H/V) reste
 * propre à chaque renderer — un DXF (pas de métrique de police réelle) et un
 * PDF (police embarquée, largeurs de texte exactes) ne se disposent pas de
 * la même façon.
 */

export type OrientationCartouche = "horizontal" | "vertical";

export interface CartoucheInfo {
  traceReference: string;
  numeroOt: string;
  odfReference: string | null;
  clientLabel: string | null;
  articleLabel: string | null;
  dateLabel: string;
  /** URL absolue de la fiche (deep-link `?trace=`) — encodée dans le QR. */
  url: string;
  /**
   * Facteur d'échelle retenu par la pré-passe de reconnaissance (1 = aucune
   * correction). Information seule, mentionnée si ≠ 1 : jamais appliqué à la
   * géométrie dessinée — le dessin garde l'échelle physique exacte du
   * fichier déposé par la PAO.
   */
  facteurEchelle: number;
}

export interface LigneCartouche {
  texte: string;
  accent?: "titre" | "verdict_ok" | "verdict_ko";
}

export interface ContenuCartouche {
  /** Lignes de texte, dans l'ordre d'affichage (titre, verdict, OT/ODF, client, article, date). */
  lignes: LigneCartouche[];
  qrUrl: string;
  /** Repli lisible à l'œil sous le QR si le scan ne passe pas — la référence du tracé. */
  qrLegende: string;
  complet: boolean;
}

export function construireContenuCartouche(lignes: LignePieceDetail[], info: CartoucheInfo): ContenuCartouche {
  const totalPieces = lignes.length;
  const totalReconnues = lignes.filter((l) => l.reconnue).length;
  const complet = totalPieces > 0 && totalReconnues === totalPieces;
  const verdict = complet
    ? `TOUTES LES PIÈCES RECONNUES (${totalReconnues}/${totalPieces})`
    : `${totalPieces - totalReconnues} PIÈCE(S) NON RECONNUE(S) SUR ${totalPieces} — VOIR MARQUAGE`;

  const contenu: LigneCartouche[] = [
    { texte: `SERITEX — Tracé ${tronque(info.traceReference, 40)}`, accent: "titre" },
    { texte: verdict, accent: complet ? "verdict_ok" : "verdict_ko" },
    { texte: `OT ${tronque(info.numeroOt, 30)} · ODF ${tronque(info.odfReference ?? "—", 40)}` },
    { texte: `Client : ${tronque(info.clientLabel ?? "—", 50)}` },
  ];
  if (info.articleLabel) contenu.push({ texte: tronque(info.articleLabel, 60) });
  contenu.push({
    texte:
      info.facteurEchelle !== 1
        ? `Généré le ${info.dateLabel} · échelle fichier ×${info.facteurEchelle} (reconnaissance seule, dessin inchangé)`
        : `Généré le ${info.dateLabel}`,
  });

  return { lignes: contenu, qrUrl: info.url, qrLegende: info.traceReference, complet };
}

function tronque(texte: string, max: number): string {
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
