/**
 * Moteur d'équilibrage de chaîne de couture — socle et calculs de base (C-02).
 *
 * Plan : ~/Projects/Seritex-plans/module-confection.md, §4.1 à §4.3,
 * décisions C6 (une chaîne par article), C7 (opérations communes),
 * C12 (on démarre sans aucun temps).
 *
 * Fonctions pures et déterministes : aucun accès à la base, aucune date,
 * aucun hasard. Les nombres sont rendus bruts ; l'arrondi est l'affaire de
 * l'écran. La répartition des opérations sur les postes (poids positionnel
 * classé) viendra en C-03.
 *
 * Unités : temps en minutes, capacités en pièces par heure, rendement en
 * fraction (0,85 = 85 %).
 */

/** D'où vient le temps d'une opération (§4.2). */
export type SourceTemps = "estime" | "chronometre" | "mesure";

export type Operation = {
  code: string;
  libelle: string;
  /** Minutes qu'il faut à une personne pour faire l'opération une fois. */
  tempsMin: number;
  source: SourceTemps;
  /** Type de machine ; `null` = opération manuelle. */
  typeMachine: string | null;
  /** Codes des opérations qui doivent être faites avant celle-ci. */
  precedences: string[];
  /** Opération commune à toutes les chaînes (C7) : sort du calcul de la chaîne. */
  commune?: boolean;
};

/** On vise soit un nombre de pièces, soit on part d'un effectif (§4.3, deux modes). */
export type Objectif = { piecesVisees: number } | { effectif: number };

export type ParametresChaine = {
  /** Minutes de travail par jour (ex. 480). */
  minutesParJour: number;
  /** Rendement attendu, mesuré sur la chaîne, pas 100 % (ex. 0,85). */
  rendementAttendu: number;
  objectif: Objectif;
};

/** Un poste : une ou plusieurs opérations tenues par une ou plusieurs personnes. */
export type Poste = {
  code: string;
  personnes: number;
  operations: string[];
};

export class EquilibrageErreur extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EquilibrageErreur";
  }
}

/** Marge contre les erreurs d'arrondi flottant (1,2 ÷ 0,6 = 2,0000000000000004). */
const EPS = 1e-9;

const fmt = (op: Operation) => `${op.code} (${op.libelle})`;

function positif(valeur: number, nom: string): void {
  if (!Number.isFinite(valeur) || valeur <= 0) {
    throw new EquilibrageErreur(`${nom} doit être un nombre strictement positif (reçu : ${valeur}).`);
  }
}

function verifierRendement(r: number): void {
  if (!Number.isFinite(r) || r <= 0 || r > 1) {
    throw new EquilibrageErreur(`Le rendement attendu doit être compris entre 0 (exclu) et 1 (reçu : ${r}).`);
  }
}

// ---------------------------------------------------------------------------
// Contrôle des données
// ---------------------------------------------------------------------------

/**
 * Vérifie une liste d'opérations : codes uniques, temps positifs,
 * précédences connues, pas de boucle. Lève une `EquilibrageErreur` au
 * premier problème, avec un message en français qui nomme les opérations.
 */
export function validerOperations(operations: Operation[]): void {
  const parCode = new Map<string, Operation>();
  for (const op of operations) {
    if (!op.code.trim()) throw new EquilibrageErreur(`Une opération n'a pas de code (libellé : « ${op.libelle} »).`);
    if (parCode.has(op.code)) throw new EquilibrageErreur(`Le code d'opération ${op.code} est utilisé deux fois.`);
    parCode.set(op.code, op);
  }
  for (const op of operations) {
    positif(op.tempsMin, `Le temps de l'opération ${fmt(op)}`);
    for (const p of op.precedences) {
      if (p === op.code) throw new EquilibrageErreur(`L'opération ${fmt(op)} ne peut pas se précéder elle-même.`);
      if (!parCode.has(p)) {
        throw new EquilibrageErreur(`L'opération ${fmt(op)} doit suivre l'opération ${p}, qui n'existe pas dans la liste.`);
      }
    }
  }
  const boucle = trouverBoucle(operations, parCode);
  if (boucle) {
    const chemin = boucle.map((c) => fmt(parCode.get(c)!)).join(" → ");
    throw new EquilibrageErreur(`Boucle de précédences : ${chemin}. Retirez une de ces précédences pour casser la boucle.`);
  }
}

/**
 * Cherche une boucle dans le graphe « doit suivre ». Rend le chemin fermé
 * (premier code répété à la fin) ou `null`. Parcours dans l'ordre de la
 * liste, donc toujours la même boucle pour les mêmes données.
 */
function trouverBoucle(operations: Operation[], parCode: Map<string, Operation>): string[] | null {
  const etat = new Map<string, 1 | 2>(); // 1 = en cours de visite, 2 = terminé
  const pile: string[] = [];

  const visiter = (code: string): string[] | null => {
    etat.set(code, 1);
    pile.push(code);
    for (const p of parCode.get(code)!.precedences) {
      const e = etat.get(p);
      if (e === 1) {
        // Le chemin va de `code` vers ses prédécesseurs : on le remet dans
        // le sens du travail (prédécesseur → successeur).
        const debut = pile.indexOf(p);
        return [...pile.slice(debut), p].reverse();
      }
      if (e === undefined) {
        const b = visiter(p);
        if (b) return b;
      }
    }
    pile.pop();
    etat.set(code, 2);
    return null;
  };

  for (const op of operations) {
    if (!etat.has(op.code)) {
      const b = visiter(op.code);
      if (b) return b;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Calculs élémentaires (§4.3)
// ---------------------------------------------------------------------------

/**
 * Estimation d'un temps sans chronométrage (§4.2, niveau 2) : borne haute
 * = personnes × minutes ÷ pièces. 2 personnes, 800 pièces en 480 min → 1,2 min.
 * Le résultat est à marquer « estimé ».
 */
export function estimerTempsOperation(personnes: number, minutes: number, pieces: number): number {
  positif(personnes, "Le nombre de personnes");
  positif(minutes, "Le nombre de minutes");
  positif(pieces, "Le nombre de pièces");
  return (personnes * minutes) / pieces;
}

/** Cadence visée (minutes par pièce) = minutes × rendement ÷ pièces visées. */
export function cadenceVisee(minutesParJour: number, rendementAttendu: number, piecesVisees: number): number {
  positif(minutesParJour, "Le nombre de minutes de travail par jour");
  verifierRendement(rendementAttendu);
  positif(piecesVisees, "L'objectif de pièces");
  return (minutesParJour * rendementAttendu) / piecesVisees;
}

/** Somme des temps des opérations de chaîne (les opérations communes sont exclues, C7). */
export function sommeDesTemps(operations: Operation[]): number {
  return operations.filter((o) => !o.commune).reduce((s, o) => s + o.tempsMin, 0);
}

/** Personnes nécessaires sur une opération = temps ÷ cadence, arrondi au-dessus. */
export function personnesNecessaires(tempsMin: number, cadence: number): number {
  positif(tempsMin, "Le temps de l'opération");
  positif(cadence, "La cadence");
  return Math.ceil(tempsMin / cadence - EPS);
}

/** Effectif théorique minimum = somme des temps ÷ cadence (non arrondi). */
export function effectifTheoriqueMinimum(operations: Operation[], cadence: number): number {
  positif(cadence, "La cadence");
  return sommeDesTemps(operations) / cadence;
}

/** Capacité d'un poste en pièces par heure = personnes × 60 ÷ temps de ses opérations. */
export function capacitePoste(personnes: number, tempsPosteMin: number): number {
  positif(personnes, "Le nombre de personnes du poste");
  positif(tempsPosteMin, "Le temps du poste");
  return (personnes * 60) / tempsPosteMin;
}

export type ChargePoste = {
  code: string;
  personnes: number;
  /** Somme des temps des opérations du poste. */
  tempsMin: number;
  /** Temps par personne = tempsMin ÷ personnes. */
  tempsParPersonneMin: number;
  capaciteParHeure: number;
};

export type SortieChaine = {
  postes: ChargePoste[];
  /** Code du poste goulot (le premier dans l'ordre donné en cas d'égalité). */
  goulot: string;
  /** Pièces par heure en sortie de chaîne = capacité du goulot. */
  sortieParHeure: number;
  /** Cadence réelle de la chaîne (minutes par pièce) = temps par personne au goulot. */
  cadenceMin: number;
  effectif: number;
  /** Somme des temps ÷ (effectif × temps par personne au goulot). 1 = personne n'attend. */
  tauxEquilibre: number;
};

/**
 * Charge de chaque poste, goulot, sortie et taux d'équilibre pour une
 * répartition donnée. Chaque opération de chaîne doit être sur un poste et
 * un seul ; les opérations communes ne doivent être sur aucun poste.
 */
export function sortieChaine(operations: Operation[], postes: Poste[]): SortieChaine {
  validerOperations(operations);
  if (postes.length === 0) throw new EquilibrageErreur("La chaîne n'a aucun poste.");
  const parCode = new Map(operations.map((o) => [o.code, o]));
  const placee = new Map<string, string>();
  const codesPostes = new Set<string>();

  const charges: ChargePoste[] = postes.map((poste) => {
    if (codesPostes.has(poste.code)) throw new EquilibrageErreur(`Le poste ${poste.code} apparaît deux fois.`);
    codesPostes.add(poste.code);
    if (!Number.isInteger(poste.personnes) || poste.personnes < 1) {
      throw new EquilibrageErreur(`Le poste ${poste.code} doit avoir au moins une personne (nombre entier).`);
    }
    if (poste.operations.length === 0) throw new EquilibrageErreur(`Le poste ${poste.code} n'a aucune opération.`);
    let temps = 0;
    for (const c of poste.operations) {
      const op = parCode.get(c);
      if (!op) throw new EquilibrageErreur(`Le poste ${poste.code} porte l'opération ${c}, qui n'existe pas.`);
      if (op.commune) {
        throw new EquilibrageErreur(`L'opération ${fmt(op)} est commune à toutes les chaînes : elle ne se place pas sur un poste de la chaîne.`);
      }
      const deja = placee.get(c);
      if (deja) throw new EquilibrageErreur(`L'opération ${fmt(op)} est placée sur deux postes : ${deja} et ${poste.code}.`);
      placee.set(c, poste.code);
      temps += op.tempsMin;
    }
    return {
      code: poste.code,
      personnes: poste.personnes,
      tempsMin: temps,
      tempsParPersonneMin: temps / poste.personnes,
      capaciteParHeure: capacitePoste(poste.personnes, temps),
    };
  });

  const oubliees = operations.filter((o) => !o.commune && !placee.has(o.code));
  if (oubliees.length > 0) {
    throw new EquilibrageErreur(`Opérations sans poste : ${oubliees.map(fmt).join(", ")}.`);
  }

  let goulot = charges[0];
  for (const c of charges) if (c.tempsParPersonneMin > goulot.tempsParPersonneMin + EPS) goulot = c;
  const effectif = charges.reduce((s, c) => s + c.personnes, 0);

  return {
    postes: charges,
    goulot: goulot.code,
    sortieParHeure: goulot.capaciteParHeure,
    cadenceMin: goulot.tempsParPersonneMin,
    effectif,
    tauxEquilibre: sommeDesTemps(operations) / (effectif * goulot.tempsParPersonneMin),
  };
}

/** Production journalière d'une chaîne dont la cadence réelle est connue = minutes × rendement ÷ cadence. */
export function productionJournaliere(cadenceMin: number, minutesParJour: number, rendementAttendu: number): number {
  positif(cadenceMin, "La cadence");
  positif(minutesParJour, "Le nombre de minutes de travail par jour");
  verifierRendement(rendementAttendu);
  return (minutesParJour * rendementAttendu) / cadenceMin;
}

/**
 * Production journalière théorique pour un effectif donné, si l'équilibre
 * était parfait = effectif × minutes × rendement ÷ somme des temps.
 * C'est un plafond : la répartition réelle (C-03) fera au mieux autant.
 */
export function productionJournaliereTheorique(
  operations: Operation[],
  effectif: number,
  minutesParJour: number,
  rendementAttendu: number,
): number {
  validerOperations(operations);
  positif(effectif, "L'effectif");
  positif(minutesParJour, "Le nombre de minutes de travail par jour");
  verifierRendement(rendementAttendu);
  const somme = sommeDesTemps(operations);
  if (somme <= 0) throw new EquilibrageErreur("La chaîne n'a aucune opération propre (hors opérations communes).");
  return (effectif * minutesParJour * rendementAttendu) / somme;
}

/**
 * Charge d'une opération commune (C7) = pièces de toutes les chaînes
 * servies × temps ÷ minutes de présence. Au-delà de 1, la personne ne suit pas.
 */
export function chargeOperationCommune(tempsMin: number, piecesParChaine: number[], minutesPresence: number): number {
  positif(tempsMin, "Le temps de l'opération commune");
  positif(minutesPresence, "Le temps de présence");
  if (piecesParChaine.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new EquilibrageErreur("Les pièces par chaîne doivent être des nombres positifs ou nuls.");
  }
  const pieces = piecesParChaine.reduce((s, p) => s + p, 0);
  return (pieces * tempsMin) / minutesPresence;
}

// ---------------------------------------------------------------------------
// Synthèse : les chiffres de base d'une chaîne pour un objectif
// ---------------------------------------------------------------------------

export type BesoinOperation = {
  code: string;
  libelle: string;
  tempsMin: number;
  source: SourceTemps;
  personnes: number;
  capaciteParHeure: number;
};

export type CalculChaine = {
  /** Minutes par pièce visées. */
  cadenceMin: number;
  piecesVisees: number;
  sommeDesTempsMin: number;
  /** Somme des temps ÷ cadence, non arrondi. */
  effectifTheoriqueMinimum: number;
  /** Une opération = un poste, personnes arrondies au-dessus. */
  operations: BesoinOperation[];
  effectifNecessaire: number;
  sortie: SortieChaine;
  productionJournaliere: number;
  /** Vrai si au moins un temps n'est que « estimé » : le résultat est indicatif. */
  indicatif: boolean;
};

/**
 * Chiffres de base d'une chaîne, une opération par poste (la répartition
 * fine viendra en C-03).
 * - Objectif en pièces : cadence = minutes × rendement ÷ pièces.
 * - Objectif en effectif : cadence idéale = somme des temps ÷ effectif,
 *   pièces visées = minutes × rendement ÷ cadence.
 */
export function calculerChaine(operations: Operation[], params: ParametresChaine): CalculChaine {
  validerOperations(operations);
  positif(params.minutesParJour, "Le nombre de minutes de travail par jour");
  verifierRendement(params.rendementAttendu);
  const chaine = operations.filter((o) => !o.commune);
  if (chaine.length === 0) throw new EquilibrageErreur("La chaîne n'a aucune opération propre (hors opérations communes).");
  const somme = sommeDesTemps(operations);

  let cadence: number;
  let pieces: number;
  if ("piecesVisees" in params.objectif) {
    pieces = params.objectif.piecesVisees;
    cadence = cadenceVisee(params.minutesParJour, params.rendementAttendu, pieces);
  } else {
    positif(params.objectif.effectif, "L'effectif");
    cadence = somme / params.objectif.effectif;
    pieces = (params.minutesParJour * params.rendementAttendu) / cadence;
  }

  const besoins: BesoinOperation[] = chaine.map((o) => {
    const personnes = personnesNecessaires(o.tempsMin, cadence);
    return {
      code: o.code,
      libelle: o.libelle,
      tempsMin: o.tempsMin,
      source: o.source,
      personnes,
      capaciteParHeure: capacitePoste(personnes, o.tempsMin),
    };
  });

  const sortie = sortieChaine(
    operations,
    besoins.map((b) => ({ code: b.code, personnes: b.personnes, operations: [b.code] })),
  );

  return {
    cadenceMin: cadence,
    piecesVisees: pieces,
    sommeDesTempsMin: somme,
    effectifTheoriqueMinimum: somme / cadence,
    operations: besoins,
    effectifNecessaire: sortie.effectif,
    sortie,
    productionJournaliere: productionJournaliere(sortie.cadenceMin, params.minutesParJour, params.rendementAttendu),
    indicatif: chaine.some((o) => o.source === "estime"),
  };
}
