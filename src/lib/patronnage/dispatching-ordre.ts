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
  /** Clé de couche (couleur de la pièce × tissu de l'article, 0183) et son libellé. */
  cle: string | null;
  libelleCle: string | null;
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
  const cles = fiche.clesCouches ?? [];
  const cleDe = (lineId: string | null, articleId: string | null, sf: string) =>
    cles.find((c) => c.semiFiniId === sf && (lineId ? c.lineId === lineId : c.articleId === articleId)) ?? null;
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
      pieces: new Map(
        l.semiFinis.map((p) => {
          const c = cleDe(l.lineId, null, p.id);
          return [p.id, { nom: p.nom, quantite: nom?.quantites[p.id] ?? 0, couleur: p.couleur, cle: c?.cle ?? null, libelleCle: c?.libelle ?? p.couleur }];
        })
      ),
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
    pieces: new Map(
      a.pieces.map((p) => {
        const c = cleDe(null, a.id, p.id);
        return [p.id, { nom: p.nom, quantite: p.quantite, couleur: p.couleur, cle: c?.cle ?? null, libelleCle: c?.libelle ?? p.couleur }];
      })
    ),
  }));
  return [...odf, ...saisis];
}

/**
 * Couches d'un article SUR UNE PIÈCE d'un tracé (0183) ; tracé saisi à
 * l'ancienne (sans couches par pièce) : les couches de l'article valent pour
 * toutes les pièces du tracé.
 */
export function couchesPiece(trace: TracePlacement, article: ArticleOrdre, semiFiniId: string): number {
  if ((trace.couchesPieces ?? []).length > 0) {
    return (trace.couchesPieces ?? [])
      .filter((c) => c.semiFiniId === semiFiniId && (article.type === "odf" ? c.lineId === article.id : c.articleId === article.id))
      .reduce((s, c) => s + c.nbCouches, 0);
  }
  return couchesArticle(trace, article);
}

/** Couches d'un article sur un tracé (résumé : sa pièce la plus servie). */
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
      const m = res.get(a.cle)!;
      for (const p of t.pieces) {
        const c = couchesPiece(t, a, p.semiFiniId);
        if (c <= 0) continue;
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
  // Plis d'une couleur dont une pièce n'est attribuée à aucun article : pièces
  // coupées pour personne (ex. manches bleu nuit quand aucun article n'en a).
  const libelleDeCle = new Map((fiche.clesCouches ?? []).map((c) => [c.cle, c.libelle]));
  for (const t of tracesActifs(fiche)) {
    if ((t.plisCouleur ?? []).length === 0) continue;
    for (const pc of t.plisCouleur ?? []) {
      for (const p of t.pieces) {
        const attribuees = (t.couchesPieces ?? []).filter((c) => c.cle === pc.cle && c.semiFiniId === p.semiFiniId).reduce((s, c) => s + c.nbCouches, 0);
        const reste = pc.nbPlis - attribuees;
        if (reste <= 0) continue;
        horsDemande.push({
          libelle: `${t.reference} — ${p.semiFiniNom} ${libelleTaille(p.taille)} (${libelleDeCle.get(pc.cle) ?? "couleur"})`,
          pieces: p.quantiteParCouche * reste,
          raison: attribuees === 0 ? "aucun article n'a cette pièce dans cette couleur" : `${reste} pli(s) attribué(s) à aucun article`,
        });
      }
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
// Plis par couleur (et grammage) sur un tracé — pièce par pièce (0183)
// ----------------------------------------------------------------------------

export interface GroupeCouleur {
  cle: string;
  libelle: string;
  /** Pour chaque pièce du tracé, les articles qui l'ont dans cette couleur. */
  pieces: { semiFiniId: string; nom: string; articles: ArticleOrdre[] }[];
  plis: number;
}

/**
 * Couleurs (× grammage) d'un tracé : toutes les couleurs que prennent les
 * pièces du tracé chez les articles de l'ordre. Une couche d'une couleur
 * donne toutes les pièces du tracé dans cette couleur ; chaque pièce va aux
 * articles qui l'ont dans cette couleur (les corps blancs aux uns, les
 * manches blanches aux autres).
 */
export function couleursDuTrace(fiche: FichePlacement, trace: TracePlacement): GroupeCouleur[] {
  const sfs = [...new Map(trace.pieces.map((p) => [p.semiFiniId, p.semiFiniNom])).entries()];
  const groupes = new Map<string, GroupeCouleur>();
  for (const a of articlesOrdre(fiche)) {
    if (a.odfAnnule) continue;
    for (const [sf] of sfs) {
      const p = a.pieces.get(sf);
      if (!p || p.quantite <= 0 || !p.cle) continue;
      const g = groupes.get(p.cle) ?? { cle: p.cle, libelle: p.libelleCle ?? SANS_COULEUR, pieces: sfs.map(([id, n]) => ({ semiFiniId: id, nom: n, articles: [] as ArticleOrdre[] })), plis: 0 };
      g.pieces.find((x) => x.semiFiniId === sf)?.articles.push(a);
      groupes.set(p.cle, g);
    }
  }
  for (const g of groupes.values()) g.plis = (trace.plisCouleur ?? []).find((p) => p.cle === g.cle)?.nbPlis ?? 0;
  // Plis déjà saisis pour une couleur qu'aucun article n'a (plus) : gardés pour être vus et retirés.
  for (const p of trace.plisCouleur ?? []) {
    if (!groupes.has(p.cle)) groupes.set(p.cle, { cle: p.cle, libelle: (fiche.clesCouches ?? []).find((c) => c.cle === p.cle)?.libelle ?? "Couleur sans article", pieces: sfs.map(([id, n]) => ({ semiFiniId: id, nom: n, articles: [] })), plis: p.nbPlis });
  }
  return [...groupes.values()].sort((x, y) => x.libelle.localeCompare(y.libelle));
}

export interface CouchePiece {
  article: ArticleOrdre;
  semiFiniId: string;
  cle: string;
  nbCouches: number;
}

/**
 * Répartit les plis d'une couleur : pour chaque pièce du tracé, les couches se
 * partagent entre les articles qui ont cette pièce dans cette couleur, selon
 * leur besoin restant sur cette pièce (demande moins les autres tracés), au
 * plus ce besoin ; s'il y a moins de plis que de besoin, au prorata. Les
 * pièces sans preneur restent « hors demande ».
 */
export function repartirPlis(fiche: FichePlacement, trace: TracePlacement, groupe: GroupeCouleur, plis: number): CouchePiece[] {
  const res: CouchePiece[] = [];
  if (plis <= 0) return res;
  const tous = groupe.pieces.flatMap((p) => p.articles);
  const autres = piecesObtenues(fiche, [...new Map(tous.map((a) => [a.cle, a])).values()], trace.id);
  for (const piece of groupe.pieces) {
    const articles = piece.articles;
    if (articles.length === 0) continue;
    const besoin = (a: ArticleOrdre) =>
      Math.max(
        0,
        ...trace.pieces
          .filter((p) => p.semiFiniId === piece.semiFiniId)
          .map((p) => {
            const q = a.pieces.get(p.semiFiniId)?.quantite ?? 0;
            const demandees = (a.tailles[p.taille] ?? 0) * q;
            const deja = autres.get(a.cle)?.get(`${p.semiFiniId}|${p.taille}`) ?? 0;
            return Math.ceil(Math.max(demandees - deja, 0) / p.quantiteParCouche);
          })
      );
    // Chaque article reçoit au plus son besoin : si la couleur a plus de plis
    // que nécessaire, le reste n'est attribué à personne (« hors demande »).
    const besoins = articles.map((a) => besoin(a));
    const somme = besoins.reduce((s, w) => s + w, 0);
    if (somme === 0) continue;
    const aRepartir = Math.min(plis, somme);
    const parts = besoins.map((w) => (aRepartir * w) / somme);
    const entiers = parts.map(Math.floor);
    let reste = aRepartir - entiers.reduce((s, n) => s + n, 0);
    const ordre = parts.map((p, i) => [p - Math.floor(p), i] as const).sort((x, y) => y[0] - x[0]);
    for (const [, i] of ordre) {
      if (reste <= 0) break;
      entiers[i] += 1;
      reste -= 1;
    }
    articles.forEach((a, i) => {
      if (entiers[i] > 0) res.push({ article: a, semiFiniId: piece.semiFiniId, cle: groupe.cle, nbCouches: entiers[i] });
    });
  }
  return res;
}
