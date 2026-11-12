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

/**
 * Texte de marquage (DXF et PDF) : lettres sans accent, chiffres et quelques
 * signes simples seulement. Un accent ou un caractère spécial fausse le rendu
 * d'un DXF chez le traceur/imprimeur (retour utilisateur du 2026-11-11).
 */
export function texteMarquage(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[·•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[×]/g, "x")
    .replace(/[«»“”"]/g, "")
    .replace(/[‘’']/g, " ")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/æ/g, "ae")
    .replace(/[^A-Za-z0-9 .,:;()/+\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  return {
    lignes: contenu.map((l) => ({ ...l, texte: texteMarquage(l.texte) })),
    qrUrl: info.url,
    qrLegende: texteMarquage(info.traceReference),
    complet,
  };
}

/** Étiquette d'une pièce marquée : article, taille, pièce (sans accent ni caractère spécial). */
export function libellePieceMarquee(ligne: LignePieceDetail): string {
  return texteMarquage(
    ligne.reconnue && ligne.patron
      ? `${ligne.patron.articleCode} - ${ligne.patron.size} - ${ligne.patron.pieceName}${ligne.enMiroir ? " (miroir)" : ""}`
      : "NON RECONNUE"
  );
}

// ----------------------------------------------------------------------------
// Mise en page commune du cartouche (DXF et PDF), en millimètres
// ----------------------------------------------------------------------------
//
// Retour utilisateur du 2026-11-11 : le cartouche ne doit pas élargir le
// tracé (la largeur, c'est la laize : on n'y touche pas). Il se place donc au
// BOUT de la longueur du tracé, tourné de 90° pour courir le long de la
// largeur, et n'en dépasse jamais la largeur.
//
// La mise en page se fait dans un repère local (u : sens de lecture, v : vers
// le haut du texte), puis chaque format la projette sur le tracé avec
// `placerCartouche`.

export type ElementCartouche =
  | { type: "texte"; u: number; v: number; hauteur: number; texte: string; accent?: LigneCartouche["accent"]; centre?: boolean }
  | { type: "cadre"; u0: number; v0: number; u1: number; v1: number }
  | { type: "qr"; u0: number; v0: number; taille: number; url: string };

export interface MiseEnPageCartouche {
  /** Étendue le long du sens de lecture (posée le long de la largeur du tracé). */
  largeurMm: number;
  /** Étendue perpendiculaire (prise sur la longueur du tracé). */
  hauteurMm: number;
  elements: ElementCartouche[];
}

/** Largeur estimée d'un texte (Helvetica, sans métrique réelle côté DXF). */
const largeurTexteMm = (texte: string, hauteur: number) => texte.length * hauteur * 0.8;

export function mettreEnPageCartouche(contenu: ContenuCartouche, orientation: OrientationCartouche, largeurMaxMm: number): MiseEnPageCartouche {
  const pad = 4;
  const hauteurDe = (l: LigneCartouche) => (l.accent === "titre" ? 4 : l.accent ? 3.2 : 2.8);
  const plusLongue = (k: number) => Math.max(...contenu.lignes.map((l) => largeurTexteMm(l.texte, hauteurDe(l) * k)));
  let qr = 28;
  let k = 1;
  // Ne jamais dépasser la largeur du tracé : le texte puis le QR rétrécissent.
  const largeur = () => (orientation === "horizontal" ? pad * 3 + qr + plusLongue(k) : pad * 2 + Math.max(qr, plusLongue(k)));
  while (largeur() > largeurMaxMm && k > 0.45) k -= 0.05;
  while (largeur() > largeurMaxMm && qr > 16) qr -= 2;
  const interligne = (l: LigneCartouche) => hauteurDe(l) * k * 1.45;
  const hauteurTexte = contenu.lignes.reduce((s, l) => s + interligne(l), 0);
  const legende = 2.5 * k;

  const elements: ElementCartouche[] = [];
  let largeurMm: number;
  let hauteurMm: number;
  if (orientation === "horizontal") {
    largeurMm = largeur();
    hauteurMm = pad * 2 + Math.max(qr + legende + 2, hauteurTexte);
    elements.push({ type: "qr", u0: pad, v0: hauteurMm - pad - qr, taille: qr, url: contenu.qrUrl });
    elements.push({ type: "texte", u: pad + qr / 2, v: hauteurMm - pad - qr - legende - 1, hauteur: legende, texte: contenu.qrLegende, centre: true });
    let v = hauteurMm - pad;
    for (const l of contenu.lignes) {
      v -= interligne(l);
      elements.push({ type: "texte", u: pad * 2 + qr, v, hauteur: hauteurDe(l) * k, texte: l.texte, accent: l.accent });
    }
  } else {
    largeurMm = largeur();
    hauteurMm = pad * 3 + qr + legende + 2 + hauteurTexte;
    elements.push({ type: "qr", u0: (largeurMm - qr) / 2, v0: hauteurMm - pad - qr, taille: qr, url: contenu.qrUrl });
    elements.push({ type: "texte", u: largeurMm / 2, v: hauteurMm - pad - qr - legende - 1, hauteur: legende, texte: contenu.qrLegende, centre: true });
    let v = hauteurMm - pad * 2 - qr - legende - 2;
    for (const l of contenu.lignes) {
      v -= interligne(l);
      elements.push({ type: "texte", u: pad, v, hauteur: hauteurDe(l) * k, texte: l.texte, accent: l.accent });
    }
  }
  elements.unshift({ type: "cadre", u0: 0, v0: 0, u1: largeurMm, v1: hauteurMm });
  return { largeurMm, hauteurMm, elements };
}

export interface PlacementCartouche {
  /** Point local (mm) → point du tracé (mm, même repère que le tracé). */
  versTrace: (u: number, v: number) => [number, number];
  /** Rotation du texte en degrés (90 : le cartouche court le long de la largeur). */
  rotation: 0 | 90;
}

/**
 * Place le cartouche au bout de la longueur du tracé (boîte en mm), centré
 * sur sa largeur. Longueur sur X (cas habituel) : à droite, tourné de 90°.
 * Longueur sur Y : au-dessus, sans rotation.
 */
export function placerCartouche(
  boite: { minX: number; minY: number; maxX: number; maxY: number },
  miseEnPage: MiseEnPageCartouche,
  margeMm = 15
): PlacementCartouche {
  const longueurSurX = boite.maxX - boite.minX >= boite.maxY - boite.minY;
  if (longueurSurX) {
    const x0 = boite.maxX + margeMm;
    const y0 = boite.minY + (boite.maxY - boite.minY - miseEnPage.largeurMm) / 2;
    // u (lecture) → +Y ; v (haut du texte) → -X : le haut du texte regarde le tracé.
    return { versTrace: (u, v) => [x0 + miseEnPage.hauteurMm - v, y0 + u], rotation: 90 };
  }
  const x0 = boite.minX + (boite.maxX - boite.minX - miseEnPage.largeurMm) / 2;
  const y0 = boite.maxY + margeMm;
  return { versTrace: (u, v) => [x0 + u, y0 + v], rotation: 0 };
}

function tronque(texte: string, max: number): string {
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
