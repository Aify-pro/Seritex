import { computeRealCost, tissuOf, type RealCostResult, type SnapshotDetail, type TheoreticalRow } from "@/lib/real-cost";

/**
 * Rapport de production (migration 0145) : lecture du rapport figé à la
 * demande de clôture d'un ODF, et des données de valeur figées au même
 * instant (réservées à tarification/voir).
 *
 * Module pur (aucun accès base), partagé par la fiche ODF et le PDF — banc :
 * scripts/test-production-report.ts. Les quantités et les valeurs viennent
 * telles quelles du rapport : rien n'est relu dans l'état courant de l'ODF.
 *
 * Limites de la v1 (décisions S30-S31, S35-S36) : temps = durée écoulée entre
 * la première et la dernière déclaration d'une section, pas d'heures
 * travaillées ; sans devis, seules les valeurs tissu et déchets sont
 * calculées.
 */

export interface ReportTaille {
  taille: string;
  demande: number;
  premier_choix: number;
  deuxieme_choix: number;
  dechets: number;
  en_cours: number;
  surplus?: number;
}

export interface ReportSection {
  work_order_id: string;
  etape: number | null;
  section: string;
  categorie: string | null;
  ligne: string | null;
  prevu: number;
  fait: number;
  bonnes: number;
  premier_choix: number;
  deuxieme_choix: number;
  dechets: number;
  preleve: number;
  surplus: number;
  premiere_declaration: string | null;
  derniere_declaration: string | null;
  duree_ecoulee_min: number | null;
}

export interface ReportContenu {
  bilan: {
    /** Bilan non calculable au moment de la génération (rapport fait sans lui). */
    indisponible?: boolean;
    en_cours: number;
    lignes: { line_id: string; description: string; quantite: number; en_cours: number; tailles: ReportTaille[] }[];
  };
  sections: ReportSection[];
  tissu: {
    kg_reception: number | string;
    kg_retour_stock: number | string;
    kg_sortie_lots: number | string;
    kg_dechets: number | string;
    matelas_clotures: number;
  };
  consommables: { code: string; designation: string; unite: string; theorique: number | string; reel: number | string | null; motif: string | null }[];
}

export interface ReportCouts {
  prix_tissu_kg: number | string | null;
  prix_tissu_source: "odf" | "article" | null;
  taux_change: number | string | null;
  theorique: { quantite: number; prix_vente: number | string; prix_revient: number | string | null; detail: SnapshotDetail | null }[];
}

export type ReportDecision = "validee" | "renvoyee" | "cloture_forcee";

export const DECISION_LABELS: Record<ReportDecision, string> = {
  validee: "Clôture validée",
  renvoyee: "Renvoyé en production",
  cloture_forcee: "Clôture exceptionnelle",
};

export interface ReportLigneTaille extends ReportTaille {
  /** Pièces sorties (1er + 2e choix). */
  sorties: number;
  /** Sorties − demandé : négatif = manquant, positif = en plus. */
  ecart: number;
}

export interface ReportView {
  lignes: { description: string; quantite: number; tailles: ReportLigneTaille[]; totaux: Omit<ReportLigneTaille, "taille"> }[];
  totaux: { demande: number; sorties: number; premier_choix: number; deuxieme_choix: number; dechets: number; surplus: number; manquants: number; en_plus: number; en_cours: number };
  sections: ReportSection[];
  tissu: { kgReception: number; kgRetour: number; kgNet: number; kgSortieLots: number; kgDechets: number; matelasClotures: number; kgParPiece: number | null };
  consommables: { code: string; designation: string; unite: string; theorique: number; reel: number | null; ecart: number | null; motif: string | null }[];
}

export interface ReportValeur {
  prixKg: number | null;
  prixKgSource: "odf" | "article" | null;
  /** kg nets × prix au kg. */
  valeurTissu: number | null;
  valeurDechets: number | null;
  tissuParPiece: number | null;
  /** Prix de revient réel complet : seulement avec un devis chiffré (v1). */
  prixRevient: RealCostResult | null;
  warnings: string[];
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const numOrNull = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Quantités du rapport, prêtes à afficher : écarts par taille, totaux, tissu net. */
export function buildReportView(c: ReportContenu): ReportView {
  const lignes = c.bilan.lignes.map((l) => {
    const tailles = l.tailles.map((t) => {
      const sorties = t.premier_choix + t.deuxieme_choix;
      return { ...t, surplus: t.surplus ?? 0, sorties, ecart: sorties - t.demande };
    });
    const sum = (k: keyof ReportLigneTaille) => tailles.reduce((s, t) => s + Number(t[k] ?? 0), 0);
    return {
      description: l.description,
      quantite: l.quantite,
      tailles,
      totaux: {
        demande: sum("demande"),
        premier_choix: sum("premier_choix"),
        deuxieme_choix: sum("deuxieme_choix"),
        dechets: sum("dechets"),
        en_cours: sum("en_cours"),
        surplus: sum("surplus"),
        sorties: sum("sorties"),
        ecart: sum("sorties") - sum("demande"),
      },
    };
  });
  const toutes = lignes.flatMap((l) => l.tailles);
  const total = (f: (t: ReportLigneTaille) => number) => toutes.reduce((s, t) => s + f(t), 0);
  const sorties = total((t) => t.sorties);

  const kgReception = num(c.tissu.kg_reception);
  const kgRetour = num(c.tissu.kg_retour_stock);
  const kgNet = Math.max(kgReception - kgRetour, 0);

  return {
    lignes,
    totaux: {
      demande: total((t) => t.demande),
      sorties,
      premier_choix: total((t) => t.premier_choix),
      deuxieme_choix: total((t) => t.deuxieme_choix),
      dechets: total((t) => t.dechets),
      surplus: total((t) => t.surplus ?? 0),
      manquants: total((t) => Math.max(-t.ecart, 0)),
      en_plus: total((t) => Math.max(t.ecart, 0)),
      en_cours: total((t) => t.en_cours),
    },
    sections: c.sections,
    tissu: {
      kgReception,
      kgRetour,
      kgNet,
      kgSortieLots: num(c.tissu.kg_sortie_lots),
      kgDechets: num(c.tissu.kg_dechets),
      matelasClotures: c.tissu.matelas_clotures ?? 0,
      kgParPiece: kgNet > 0 && sorties > 0 ? kgNet / sorties : null,
    },
    consommables: c.consommables.map((k) => {
      const theorique = num(k.theorique);
      const reel = numOrNull(k.reel);
      return { code: k.code, designation: k.designation, unite: k.unite, theorique, reel, ecart: reel === null ? null : reel - theorique, motif: k.motif };
    }),
  };
}

/** Valeurs du rapport, à partir des données figées : tissu, déchets et, avec un devis, prix de revient réel. */
export function buildReportValeur(view: ReportView, couts: ReportCouts): ReportValeur {
  const warnings: string[] = [];
  const prixKg = numOrNull(couts.prix_tissu_kg);
  if (prixKg === null) warnings.push("Prix du tissu au kg non renseigné (ni sur l'ODF, ni sur la fiche article du tissu) : valeur du tissu indisponible.");
  if (view.tissu.kgReception === 0) warnings.push("Aucune pesée de réception du tissu : tissu consommé inconnu.");
  const valeurTissu = prixKg !== null && view.tissu.kgNet > 0 ? view.tissu.kgNet * prixKg : null;
  const valeurDechets = prixKg !== null && view.tissu.kgDechets > 0 ? view.tissu.kgDechets * prixKg : null;

  const taux = num(couts.taux_change) || 1;
  const rows: TheoreticalRow[] = (couts.theorique ?? []).map((s) => {
    const detail = s.detail ?? {};
    return {
      quantite: s.quantite,
      prixVenteXof: num(s.prix_vente) * (detail.taux_change ?? taux),
      prixRevient: numOrNull(s.prix_revient),
      tissu: tissuOf(detail),
      chargesPct: Number(detail.charges_pct ?? 0),
    };
  });
  if (rows.length === 0) warnings.push("Sans devis chiffré, le prix de revient complet n'est pas calculé dans cette version : seules les valeurs du tissu et des déchets sont données.");
  const prixRevient = rows.length > 0 ? computeRealCost({ rows, kgMesures: view.tissu.kgNet > 0 ? view.tissu.kgNet : null, prixKg }) : null;

  return {
    prixKg,
    prixKgSource: couts.prix_tissu_source,
    valeurTissu,
    valeurDechets,
    tissuParPiece: valeurTissu !== null && view.totaux.sorties > 0 ? valeurTissu / view.totaux.sorties : null,
    prixRevient,
    warnings,
  };
}

/** Durée écoulée lisible : « 45 min », « 3 h 10 », « 2 j 4 h ». */
export function formatDuree(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  const j = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${j} j ${hr} h` : `${j} j`;
}
