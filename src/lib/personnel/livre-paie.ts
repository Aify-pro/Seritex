import { createHash } from "node:crypto";
import { lireCsv, lireMontant, normaliser, type ContexteImport, type LigneImport, type ResultatLecture } from "./import";

/**
 * Livre de paie exporté de Sage (migration 0159). Fonctions PURES.
 *
 * Format : « long », une ligne par employé et par rubrique —
 *   Matricule;Nom;Prénom;Code Rubrique;Intitulé Rubrique;Montant salarial
 * avec les cellules texte en ="…" (astuce Excel), des montants « 250 000,00 »
 * et un encodage Sage cassé (é → 0x80, à → 0x85, û → 0x96). Le fichier n'a pas
 * de colonne « mois » : le mois est demandé à l'écran. On se fie au CODE des
 * rubriques, jamais à leur intitulé (accents corrompus).
 *
 * Le livre de paie fait foi : tout ce qui est payé dans le mois est un coût du
 * mois. Le coût de référence est le « COUT_TOTAL » de Sage ; l'écart avec la
 * somme des composantes (prêts, congés, taxes patronales…) reste visible.
 */

export type CategorieRubrique =
  | "salaire_base"
  | "prime"
  | "heures_sup"
  | "indemnite"
  | "avantage"
  | "charges_patronales"
  | "controle"
  | "volume"
  | "retenue"
  | "ignore";

export const LIBELLES_CATEGORIE: Record<CategorieRubrique, string> = {
  salaire_base: "Salaire de base",
  prime: "Prime",
  heures_sup: "Heures supplémentaires",
  indemnite: "Indemnité (congés, fin de contrat…)",
  avantage: "Avantage en nature",
  charges_patronales: "Charges patronales",
  controle: "Total Sage (contrôle)",
  volume: "Volume (heures, jours, présence)",
  retenue: "Retenue salariale (hors coût)",
  ignore: "Ignorée",
};

/** Correspondance code de rubrique → catégorie ; null = « à classer ». */
export type MappingRubriques = Map<string, CategorieRubrique | null>;

/** Octets propres à l'export Sage, avant décodage Windows-1252. */
const OCTETS_SAGE: Record<number, string> = { 0x80: "é", 0x85: "à", 0x96: "û" };

/** Décode le fichier : UTF-8 s'il l'est, sinon l'encodage cassé de Sage. */
export function decoderLivre(octets: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    let texte = "";
    for (const o of octets) texte += OCTETS_SAGE[o] ?? new TextDecoder("windows-1252").decode(Uint8Array.of(o));
    return texte;
  }
}

const nettoyer = (cellule: string) => cellule.replace(/^=/, "").trim();

export interface RubriqueLue {
  matricule: string;
  nom: string;
  prenom: string;
  code: string;
  libelle: string;
  montant: number;
}

export function lireLivre(texte: string): { lignes: RubriqueLue[]; erreur?: string } {
  const cellules = lireCsv(texte);
  if (cellules.length < 2) return { lignes: [], erreur: "Le fichier est vide ou ne contient que l'en-tête." };
  const enTete = cellules[0].map((c) => normaliser(nettoyer(c)));
  const col = (nom: string) => enTete.indexOf(normaliser(nom));
  const [iMat, iNom, iPre, iCode, iLib, iMt] = ["matricule", "nom", "prenom", "coderubrique", "intitulerubrique", "montantsalarial"].map(col);
  if ([iMat, iCode, iMt].some((i) => i < 0)) {
    return { lignes: [], erreur: "Ce n'est pas un livre de paie Sage : colonnes attendues Matricule ; Nom ; Prénom ; Code Rubrique ; Intitulé Rubrique ; Montant salarial." };
  }
  const lignes: RubriqueLue[] = [];
  for (const c of cellules.slice(1)) {
    const matricule = nettoyer(c[iMat] ?? "");
    const code = nettoyer(c[iCode] ?? "");
    if (!matricule || !code) continue;
    const montant = lireMontant(nettoyer(c[iMt] ?? ""));
    lignes.push({
      matricule,
      nom: iNom >= 0 ? nettoyer(c[iNom] ?? "") : "",
      prenom: iPre >= 0 ? nettoyer(c[iPre] ?? "") : "",
      code,
      libelle: iLib >= 0 ? nettoyer(c[iLib] ?? "") : "",
      montant: montant === null || Number.isNaN(montant) ? 0 : montant,
    });
  }
  return { lignes };
}

/* ------------------------------------------------------------------------ */
/* Agrégation par employé                                                   */
/* ------------------------------------------------------------------------ */

export interface PaieEmploye {
  matricule: string;
  nom: string;
  prenom: string;
  /** Montants non nuls par code de rubrique (retenues comprises). */
  detail: Record<string, number>;
  salaire_base: number;
  primes: number;
  heures_sup: number;
  indemnites: number;
  avantages: number;
  charges_patronales: number;
  brut_sage: number | null;
  cout_total_sage: number | null;
  heures_sup_nb: number | null;
  heures_travaillees: number | null;
  jours_travailles: number | null;
  type_salaire: "mensuel" | "horaire" | null;
  /** Coût du mois (coût total Sage, sinon somme des composantes). */
  cout_mois: number;
  /** Coût total Sage moins la somme des composantes : à expliquer (prêts, congés, taxes patronales…). */
  ecart_sage: number | null;
  /** Payé ce mois-ci (un employé à zéro partout est un ancien salarié). */
  paye: boolean;
}

/** Le livre Sage se termine par une pseudo-ligne « Total » : ce n'est pas un employé. */
export const estLigneTotal = (matricule: string) => /^total$/i.test(matricule.trim());

export function agregerParEmploye(lues: RubriqueLue[], mapping: MappingRubriques): { employes: PaieEmploye[]; inconnues: string[] } {
  const parMatricule = new Map<string, PaieEmploye>();
  const inconnues = new Set<string>();
  for (const r of lues) {
    if (estLigneTotal(r.matricule)) continue;
    let e = parMatricule.get(r.matricule);
    if (!e) {
      e = {
        matricule: r.matricule,
        nom: r.nom,
        prenom: r.prenom,
        detail: {},
        salaire_base: 0,
        primes: 0,
        heures_sup: 0,
        indemnites: 0,
        avantages: 0,
        charges_patronales: 0,
        brut_sage: null,
        cout_total_sage: null,
        heures_sup_nb: null,
        heures_travaillees: null,
        jours_travailles: null,
        type_salaire: null,
        cout_mois: 0,
        ecart_sage: null,
        paye: false,
      };
      parMatricule.set(r.matricule, e);
    }
    if (r.montant === 0) continue;
    e.detail[r.code] = (e.detail[r.code] ?? 0) + r.montant;
    const categorie = mapping.get(r.code);
    if (categorie === undefined || categorie === null) {
      inconnues.add(r.code);
      continue;
    }
    switch (categorie) {
      case "salaire_base":
        e.salaire_base += r.montant;
        e.type_salaire = r.code === "100" ? "horaire" : e.type_salaire ?? "mensuel";
        break;
      case "prime":
        e.primes += r.montant;
        break;
      case "heures_sup":
        e.heures_sup += r.montant;
        break;
      case "indemnite":
        e.indemnites += r.montant;
        break;
      case "avantage":
        e.avantages += r.montant;
        break;
      case "charges_patronales":
        e.charges_patronales += r.montant;
        break;
      case "controle":
        if (r.code === "BRUT") e.brut_sage = r.montant;
        if (r.code === "COUT_TOTAL") e.cout_total_sage = r.montant;
        break;
      case "volume":
        if (r.code === "TOTALHS") e.heures_sup_nb = r.montant;
        if (r.code === "10010" || (r.code === "TOTALHTRAV" && e.heures_travaillees === null)) e.heures_travaillees = r.montant;
        if (r.code === "10000") e.jours_travailles = r.montant;
        break;
      default:
        break;
    }
  }
  const employes = [...parMatricule.values()];
  for (const e of employes) {
    const composantes = e.salaire_base + e.primes + e.heures_sup + e.indemnites + e.avantages + e.charges_patronales;
    e.paye = composantes > 0 || (e.cout_total_sage ?? 0) !== 0 || (e.brut_sage ?? 0) !== 0;
    e.cout_mois = e.cout_total_sage ?? composantes;
    e.ecart_sage = e.cout_total_sage === null ? null : Math.round((e.cout_total_sage - composantes) * 100) / 100;
  }
  return { employes, inconnues: [...inconnues].sort() };
}

/**
 * Contrôle d'intégrité : la ligne « Total » du livre doit être la somme des
 * lignes des employés, rubrique par rubrique (montants seulement : Sage totalise
 * autrement les heures et les congés). Un écart signale un fichier
 * tronqué, modifié à la main ou mal exporté. Renvoie les rubriques en écart.
 */
export function controlerTotaux(lues: RubriqueLue[], ignorer: (code: string) => boolean = () => false): { code: string; total: number; somme: number }[] {
  const totaux = new Map<string, number>();
  const sommes = new Map<string, number>();
  for (const r of lues) {
    const cible = estLigneTotal(r.matricule) ? totaux : sommes;
    cible.set(r.code, (cible.get(r.code) ?? 0) + r.montant);
  }
  return [...totaux]
    .filter(([code, total]) => !ignorer(code) && Math.abs(total - (sommes.get(code) ?? 0)) >= 1)
    .map(([code, total]) => ({ code, total, somme: sommes.get(code) ?? 0 }));
}

/** Empreinte du contenu (matricule, rubrique, montant non nul) : deux livres identiques ont la même. */
export function empreinteLivre(lues: RubriqueLue[]): string {
  const lignes = lues
    .filter((r) => r.montant !== 0)
    .map((r) => `${r.matricule}|${r.code}|${r.montant}`)
    .sort();
  return createHash("sha256").update(lignes.join("\n")).digest("hex");
}

/* ------------------------------------------------------------------------ */
/* Comparatif avec le livre précédent                                       */
/* ------------------------------------------------------------------------ */

export interface PaiePrecedente {
  matricule: string;
  cout_mois: number;
}

export interface Comparatif {
  /** Mois de comparaison (1er du mois), null s'il n'y a pas de livre précédent. */
  mois_precedent: string | null;
  total_precedent: number | null;
  total_courant: number;
  variation_pct: number | null;
  nb_payes: number;
  nb_payes_precedent: number;
  /** Coût total Sage moins la somme des rubriques, sur tous les employés payés (à expliquer : prêts, congés, taxes patronales…). */
  ecart_sage_total: number;
  /** Part des employés dont le coût est exactement celui du mois précédent. */
  identiques_pct: number | null;
  /** Contenu strictement identique à un livre déjà importé (même empreinte). */
  identique_a_import: { id: string; mois: string | null } | null;
  nouveaux: string[];
  disparus: string[];
  gros_ecarts: { matricule: string; nom: string; precedent: number; courant: number; variation_pct: number }[];
  /** Alertes à lever (forte = livre identique ou quasi identique). */
  alertes: { gravite: "attention" | "critique"; titre: string; detail: string }[];
}

export const SEUIL_QUASI_IDENTIQUE = 95;
export const SEUIL_ECART_EMPLOYE = 30;
export const SEUIL_VARIATION_TOTALE = 25;
/** Écart entre le coût total Sage et la somme des rubriques, au-delà duquel une ligne est signalée (part du coût). */
export const SEUIL_ECART_SAGE_LIGNE = 0.15;
const MIN_EMPLOYES_QUASI_IDENTIQUE = 20;

const arrondi = (n: number) => Math.round(n * 10) / 10;

export function comparerLivres(
  courant: PaieEmploye[],
  precedent: { mois: string; lignes: PaiePrecedente[] } | null,
  identiqueA: { id: string; mois: string | null } | null,
  moisCourant: string
): Comparatif {
  const payes = courant.filter((e) => e.paye);
  const total = payes.reduce((s, e) => s + e.cout_mois, 0);
  const resultat: Comparatif = {
    mois_precedent: precedent?.mois ?? null,
    total_precedent: null,
    total_courant: total,
    variation_pct: null,
    nb_payes: payes.length,
    nb_payes_precedent: 0,
    ecart_sage_total: Math.round(payes.reduce((s, e) => s + (e.ecart_sage ?? 0), 0)),
    identiques_pct: null,
    identique_a_import: identiqueA,
    nouveaux: [],
    disparus: [],
    gros_ecarts: [],
    alertes: [],
  };

  if (identiqueA) {
    resultat.alertes.push({
      gravite: "critique",
      titre: "Livre de paie identique à un livre déjà importé",
      detail: `Ce fichier est strictement identique au livre importé${identiqueA.mois ? ` pour ${identiqueA.mois.slice(0, 7)}` : ""}. Deux livres de paie ne peuvent pas être identiques : vérifiez que le bon fichier a été exporté.`,
    });
  }

  if (precedent) {
    const prec = new Map(precedent.lignes.map((l) => [l.matricule, l.cout_mois]));
    const totalPrec = precedent.lignes.reduce((s, l) => s + l.cout_mois, 0);
    resultat.total_precedent = totalPrec;
    resultat.nb_payes_precedent = precedent.lignes.length;
    resultat.variation_pct = totalPrec > 0 ? arrondi(((total - totalPrec) / totalPrec) * 100) : null;
    const courants = new Map(payes.map((e) => [e.matricule, e]));
    resultat.nouveaux = payes.filter((e) => !prec.has(e.matricule)).map((e) => e.matricule);
    resultat.disparus = precedent.lignes.filter((l) => !courants.has(l.matricule)).map((l) => l.matricule);

    const communs = payes.filter((e) => prec.has(e.matricule));
    const memes = communs.filter((e) => Math.abs(e.cout_mois - (prec.get(e.matricule) ?? 0)) < 0.5);
    resultat.identiques_pct = communs.length > 0 ? arrondi((memes.length / communs.length) * 100) : null;
    resultat.gros_ecarts = communs
      .map((e) => {
        const avant = prec.get(e.matricule) ?? 0;
        return { matricule: e.matricule, nom: `${e.nom} ${e.prenom}`.trim(), precedent: avant, courant: e.cout_mois, variation_pct: avant > 0 ? arrondi(((e.cout_mois - avant) / avant) * 100) : 0 };
      })
      .filter((x) => Math.abs(x.variation_pct) >= SEUIL_ECART_EMPLOYE)
      .sort((a, b) => Math.abs(b.variation_pct) - Math.abs(a.variation_pct))
      .slice(0, 25);

    if (!identiqueA && communs.length >= MIN_EMPLOYES_QUASI_IDENTIQUE && (resultat.identiques_pct ?? 0) >= SEUIL_QUASI_IDENTIQUE) {
      resultat.alertes.push({
        gravite: "critique",
        titre: "Livre de paie quasi identique au mois précédent",
        detail: `${resultat.identiques_pct} % des employés ont exactement le même coût que ${precedent.mois.slice(0, 7)}. Les heures et les présences changent chaque mois : à vérifier.`,
      });
    }
    if (resultat.variation_pct !== null && Math.abs(resultat.variation_pct) >= SEUIL_VARIATION_TOTALE) {
      resultat.alertes.push({
        gravite: "attention",
        titre: `Coût total de la paie en variation de ${resultat.variation_pct} %`,
        detail: `Le coût total passe de ${Math.round(totalPrec)} à ${Math.round(total)} F CFA entre ${precedent.mois.slice(0, 7)} et ${moisCourant.slice(0, 7)}.`,
      });
    }
  }
  return resultat;
}

/* ------------------------------------------------------------------------ */
/* Contrôle d'un fichier de livre de paie                                   */
/* ------------------------------------------------------------------------ */

export interface ResultatLivre extends ResultatLecture {
  employes: PaieEmploye[];
  inconnues: string[];
  empreinte: string;
  /** Employés à zéro ce mois-ci (anciens salariés), ignorés. */
  nbInactifs: number;
}

/**
 * Une ligne de contrôle par employé payé. Un employé à zéro partout est
 * ignoré ; un employé payé sans fiche est en erreur (importer d'abord la
 * liste du personnel) ; une rubrique non classée bloque la validation.
 */
export function controlerLivre(texte: string, mois: string, ctx: ContexteImport, mapping: MappingRubriques): ResultatLivre {
  const vide: ResultatLivre = { lignes: [], employes: [], inconnues: [], empreinte: "", nbInactifs: 0 };
  if (!/^\d{4}-\d{2}-01$/.test(mois)) return { ...vide, erreurFichier: "Choisissez le mois du livre de paie." };
  const { lignes: lues, erreur } = lireLivre(texte);
  if (erreur) return { ...vide, erreurFichier: erreur };
  if (lues.length === 0) return { ...vide, erreurFichier: "Aucune ligne de paie lisible." };

  const ecartsTotaux = controlerTotaux(lues, (code) => mapping.get(code) === "volume");
  if (ecartsTotaux.length > 0) {
    const e = ecartsTotaux[0];
    return {
      ...vide,
      erreurFichier: `La ligne « Total » du livre ne correspond pas à la somme des employés (rubrique ${e.code} : total ${Math.round(e.total)}, somme ${Math.round(e.somme)}${ecartsTotaux.length > 1 ? `, et ${ecartsTotaux.length - 1} autre(s)` : ""}). Le fichier est incomplet, modifié ou mal exporté : exportez-le de nouveau depuis Sage.`,
    };
  }
  const { employes, inconnues } = agregerParEmploye(lues, mapping);
  const lignes: LigneImport[] = [];
  let nbInactifs = 0;

  employes.forEach((e, i) => {
    if (!e.paye) {
      nbInactifs++;
      return;
    }
    const existant = ctx.employes.get(normaliser(e.matricule));
    const erreurs: string[] = [];
    const avertissements: string[] = [];
    if (!existant) erreurs.push(`Matricule payé inconnu : « ${e.matricule} » (${`${e.nom} ${e.prenom}`.trim()}). Importez d'abord la liste du personnel.`);
    if (existant?.confidentiel) avertissements.push("Employé confidentiel : ligne ignorée (aucun montant enregistré)");
    if (e.ecart_sage !== null && e.cout_mois > 0 && Math.abs(e.ecart_sage) / e.cout_mois >= SEUIL_ECART_SAGE_LIGNE) {
      avertissements.push(`Coût total Sage ${e.ecart_sage > 0 ? "supérieur" : "inférieur"} de ${Math.abs(Math.round(e.ecart_sage))} F CFA à la somme des rubriques`);
    }
    const { nom: _n, prenom: _p, paye: _pa, ecart_sage, ...reste } = e;
    void _n;
    void _p;
    void _pa;
    lignes.push({
      ligne: i + 2,
      action: existant?.confidentiel ? "ignorer" : "creer",
      matricule: e.matricule,
      donnees: { ...reste, mois, ecart_sage, nom_affiche: `${e.nom} ${e.prenom}`.trim() },
      erreurs,
      avertissements,
    });
  });

  return { lignes, employes, inconnues, empreinte: empreinteLivre(lues), nbInactifs, mois };
}
