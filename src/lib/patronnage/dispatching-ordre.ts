import type { FichePlacement, TracePlacement } from "@/lib/patronnage/types";

/**
 * Dispatching d'un ordre de tracé regroupé (refonte du 2026-11-12) : la
 * demande (articles d'ODF et articles saisis, quantités par taille) comparée à
 * ce que donne la SOMME de tous les tracés de l'ordre (hors annulés) :
 * pièces = quantité par couche × couches de chaque article. Calcul pur,
 * partagé par l'écran (dispatching, bilan des pièces, plis par couleur).
 */

export interface PieceArticle {
  nom: string;
  /** Pièces par vêtement (nomenclature). */
  quantite: number;
  couleur: string | null;
}

export interface ArticleOrdre {
  /** « l:<ligne d'ODF> » ou « a:<article saisi> ». */
  cle: string;
  type: "odf" | "saisi";
  id: string;
  /** ODF (référence) ou « Sans ODF ». */
  origine: string;
  libelle: string;
  modeleId: string | null;
  odfAnnule: boolean;
  tailles: Record<string, number>;
  pieces: Map<string, PieceArticle>;
}

export const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
export const SANS_COULEUR = "Sans couleur";

/** Articles de l'ordre : ceux des ODF, puis ceux saisis sans ODF. */
export function articlesOrdre(fiche: FichePlacement): ArticleOrdre[] {
  const nomenclatures = fiche.nomenclaturesBilan ?? [];
  const odf: ArticleOrdre[] = fiche.lignesRegroupees.map((l) => {
    // Nomenclature de l'article : celle qu'il utilise et qui a le plus de ses pièces.
    const options = nomenclatures.filter((n) => n.modeleId === l.modeleId);
    const nom =
      [...options].sort((a, b) => {
        const score = (n: (typeof options)[number]) =>
          (n.activePour.includes(l.lineId) ? 100 : 0) + l.semiFinis.filter((p) => (n.quantites[p.id] ?? 0) > 0).length * 10 + (n.principale ? 1 : 0);
        return score(b) - score(a);
      })[0] ?? null;
    return {
      cle: `l:${l.lineId}`,
      type: "odf",
      id: l.lineId,
      origine: l.odfReference ?? "ODF",
      libelle: l.description,
      modeleId: l.modeleId,
      odfAnnule: l.odfAnnule,
      tailles: Object.fromEntries(Object.entries(l.repartition).filter(([, n]) => n > 0)),
      pieces: new Map(l.semiFinis.map((p) => [p.id, { nom: p.nom, quantite: nom?.quantites[p.id] ?? 0, couleur: p.couleur }])),
    };
  });
  const saisis: ArticleOrdre[] = (fiche.articlesSaisis ?? []).map((a) => ({
    cle: `a:${a.id}`,
    type: "saisi",
    id: a.id,
    origine: "Sans ODF",
    libelle: `${a.modele}${a.couleur ? ` · ${a.couleur}` : ""}`,
    modeleId: a.modeleId,
    odfAnnule: false,
    tailles: Object.fromEntries(Object.entries(a.tailles).filter(([, n]) => Number(n) > 0).map(([t, n]) => [t, Number(n)])),
    pieces: new Map(a.pieces.map((p) => [p.id, { nom: p.nom, quantite: p.quantite, couleur: p.couleur }])),
  }));
  return [...odf, ...saisis];
}

/** Couches d'un article sur un tracé. */
export function couchesArticle(trace: TracePlacement, article: ArticleOrdre): number {
  return article.type === "odf"
    ? (trace.couches.find((c) => c.lineId === article.id)?.nbCouches ?? 0)
    : (trace.couchesArticles?.find((c) => c.articleId === article.id)?.nbCouches ?? 0);
}

const tracesActifs = (fiche: FichePlacement, sauf?: string) => fiche.traces.filter((t) => t.statut !== "annule" && t.id !== sauf);

/** Pièces obtenues par article : clé « semi-fini|taille » → pièces, sur tous les tracés (sauf un, éventuellement). */
export function piecesObtenues(fiche: FichePlacement, articles: ArticleOrdre[], sauf?: string): Map<string, Map<string, number>> {
  const res = new Map<string, Map<string, number>>(articles.map((a) => [a.cle, new Map()]));
  for (const t of tracesActifs(fiche, sauf)) {
    for (const a of articles) {
      const c = couchesArticle(t, a);
      if (c <= 0) continue;
      const m = res.get(a.cle)!;
      for (const p of t.pieces) {
        const k = `${p.semiFiniId}|${p.taille}`;
        m.set(k, (m.get(k) ?? 0) + p.quantiteParCouche * c);
      }
    }
  }
  return res;
}

export interface LigneDispatching {
  article: ArticleOrdre;
  taille: string;
  demandes: number;
  obtenus: number;
}

export interface LignePieceBilan {
  article: ArticleOrdre;
  semiFiniId: string;
  piece: string;
  couleur: string | null;
  taille: string;
  demandees: number;
  obtenues: number;
}

export interface PieceHorsDemande {
  libelle: string;
  pieces: number;
  raison: string;
}

export interface Dispatching {
  lignes: LigneDispatching[];
  pieces: LignePieceBilan[];
  horsDemande: PieceHorsDemande[];
  manquants: number;
  piecesEnTrop: number;
  piecesManquantes: number;
  ok: boolean;
}

export function calculerDispatching(fiche: FichePlacement): Dispatching {
  const articles = articlesOrdre(fiche);
  const obtenues = piecesObtenues(fiche, articles);
  const lignes: LigneDispatching[] = [];
  const pieces: LignePieceBilan[] = [];
  const horsDemande: PieceHorsDemande[] = [];
  const noms = new Map(fiche.traces.flatMap((t) => t.pieces.map((p) => [p.semiFiniId, p.semiFiniNom] as [string, string])));

  for (const a of articles) {
    const m = obtenues.get(a.cle)!;
    const sfs = [...a.pieces.entries()].filter(([, p]) => p.quantite > 0);
    for (const [taille, demandes] of Object.entries(a.tailles)) {
      const obtenus = sfs.length === 0 ? 0 : Math.min(...sfs.map(([sf, p]) => Math.floor((m.get(`${sf}|${taille}`) ?? 0) / p.quantite)));
      lignes.push({ article: a, taille, demandes, obtenus });
      for (const [sf, p] of sfs) {
        pieces.push({ article: a, semiFiniId: sf, piece: p.nom, couleur: p.couleur, taille, demandees: demandes * p.quantite, obtenues: m.get(`${sf}|${taille}`) ?? 0 });
      }
    }
    // Pièces obtenues qu'aucune demande de l'article n'attend (taille non demandée, pièce hors nomenclature).
    for (const [k, n] of m) {
      const [sf, taille] = k.split("|");
      if (n <= 0) continue;
      if (!(a.tailles[taille] > 0)) horsDemande.push({ libelle: `${a.origine} · ${a.libelle} — ${noms.get(sf) ?? "?"} ${libelleTaille(taille)}`, pieces: n, raison: "taille non demandée" });
      else if (!((a.pieces.get(sf)?.quantite ?? 0) > 0)) horsDemande.push({ libelle: `${a.origine} · ${a.libelle} — ${noms.get(sf) ?? "?"} ${libelleTaille(taille)}`, pieces: n, raison: "pièce hors nomenclature" });
    }
  }
  // Plis non attribués à un article : pièces coupées pour personne.
  for (const t of tracesActifs(fiche)) {
    const attribuees = articles.reduce((s, a) => s + couchesArticle(t, a), 0);
    const reste = (t.nbPlis ?? 0) - attribuees;
    if (reste <= 0) continue;
    for (const p of t.pieces) {
      horsDemande.push({ libelle: `${t.reference} — ${p.semiFiniNom} ${libelleTaille(p.taille)}`, pieces: p.quantiteParCouche * reste, raison: `${reste} pli(s) attribué(s) à aucun article` });
    }
  }

  const manquants = lignes.reduce((s, l) => s + Math.max(l.demandes - l.obtenus, 0), 0);
  const piecesEnTrop = pieces.reduce((s, p) => s + Math.max(p.obtenues - p.demandees, 0), 0);
  const piecesManquantes = pieces.reduce((s, p) => s + Math.max(p.demandees - p.obtenues, 0), 0);
  return {
    lignes,
    pieces,
    horsDemande,
    manquants,
    piecesEnTrop,
    piecesManquantes,
    ok: manquants === 0 && piecesEnTrop === 0 && horsDemande.length === 0 && lignes.length > 0,
  };
}

// ----------------------------------------------------------------------------
// Plis par couleur sur un tracé
// ----------------------------------------------------------------------------

export interface GroupeCouleur {
  couleur: string;
  articles: ArticleOrdre[];
  plis: number;
}

export interface ArticleNonEligible {
  article: ArticleOrdre;
  raison: string;
}

/**
 * Couleurs d'un tracé : chaque article qui a toutes les pièces du tracé, dans
 * une seule couleur, se range sous cette couleur (une couche = un tissu d'une
 * couleur). Les autres sont listés avec la raison.
 */
export function couleursDuTrace(fiche: FichePlacement, trace: TracePlacement): { groupes: GroupeCouleur[]; nonEligibles: ArticleNonEligible[] } {
  const sfs = [...new Set(trace.pieces.map((p) => p.semiFiniId))];
  const groupes = new Map<string, GroupeCouleur>();
  const nonEligibles: ArticleNonEligible[] = [];
  for (const a of articlesOrdre(fiche)) {
    if (a.odfAnnule) continue;
    const manquent = sfs.filter((sf) => !((a.pieces.get(sf)?.quantite ?? 0) > 0));
    if (sfs.length === 0 || manquent.length > 0) {
      if (sfs.length > 0) nonEligibles.push({ article: a, raison: "n'a pas toutes les pièces de ce tracé dans sa nomenclature" });
      continue;
    }
    const couleurs = [...new Set(sfs.map((sf) => a.pieces.get(sf)?.couleur ?? SANS_COULEUR))];
    if (couleurs.length > 1) {
      nonEligibles.push({ article: a, raison: `pièces de couleurs différentes sur ce tracé (${couleurs.join(", ")})` });
      continue;
    }
    const g = groupes.get(couleurs[0]) ?? { couleur: couleurs[0], articles: [], plis: 0 };
    g.articles.push(a);
    g.plis += couchesArticle(trace, a);
    groupes.set(couleurs[0], g);
  }
  return { groupes: [...groupes.values()].sort((x, y) => x.couleur.localeCompare(y.couleur)), nonEligibles };
}

/**
 * Répartit les plis saisis pour une couleur entre les articles de cette
 * couleur, selon leur besoin restant sur ce tracé : pour chaque article, les
 * couches qui manquent encore pour couvrir sa demande compte tenu des autres
 * tracés (la pièce la plus en retard décide). Répartition proportionnelle, le
 * reste aux plus fortes parts ; sans besoin, au prorata de la demande.
 */
export function repartirPlis(fiche: FichePlacement, trace: TracePlacement, articles: ArticleOrdre[], plis: number): Map<string, number> {
  const res = new Map<string, number>(articles.map((a) => [a.cle, 0]));
  if (plis <= 0 || articles.length === 0) return res;
  const autres = piecesObtenues(fiche, articles, trace.id);
  const besoin = (a: ArticleOrdre) =>
    Math.max(
      0,
      ...trace.pieces.map((p) => {
        const q = a.pieces.get(p.semiFiniId)?.quantite ?? 0;
        const demandees = (a.tailles[p.taille] ?? 0) * q;
        const deja = autres.get(a.cle)?.get(`${p.semiFiniId}|${p.taille}`) ?? 0;
        return Math.ceil(Math.max(demandees - deja, 0) / p.quantiteParCouche);
      })
    );
  let poids = articles.map((a) => besoin(a));
  if (poids.every((w) => w === 0)) poids = articles.map((a) => Object.values(a.tailles).reduce((s, n) => s + n, 0) || 1);
  const somme = poids.reduce((s, w) => s + w, 0);
  const parts = poids.map((w) => (plis * w) / somme);
  const entiers = parts.map(Math.floor);
  let reste = plis - entiers.reduce((s, n) => s + n, 0);
  const ordre = parts.map((p, i) => [p - Math.floor(p), i] as const).sort((x, y) => y[0] - x[0]);
  for (const [, i] of ordre) {
    if (reste <= 0) break;
    entiers[i] += 1;
    reste -= 1;
  }
  articles.forEach((a, i) => res.set(a.cle, entiers[i]));
  return res;
}
