/**
 * Répartition des opérations d'un article sur les postes d'une chaîne :
 * poids positionnel classé (ranked positional weight, Helgeson et Birnie
 * 1961), adapté à la couture — tâche C-03.
 *
 * Plan : ~/Projects/Seritex-plans/module-confection.md §4.3, « Algorithme
 * retenu », étapes 1 à 4 (l'amélioration locale, étape 5, est la tâche C-04).
 *
 * 1. Poids d'une opération = son temps + le temps de toutes celles qui en
 *    dépendent, directement ou non (chacune comptée une fois).
 * 2. Classement par poids décroissant ; à poids égal, par code croissant
 *    (comparaison de chaînes caractère par caractère, indépendante de la
 *    langue du système et de l'ordre de la liste reçue).
 * 3. On ouvre un poste avec la première opération du classement dont toutes
 *    les précédences sont déjà placées, puis on y ajoute, tant qu'il y en a
 *    une, la première opération du classement qui est prête (précédences
 *    placées), qui tient dans le temps restant sans dépasser la cadence, et
 *    que la règle de regroupement autorise (voir `RegleRegroupement`). Quand
 *    plus rien n'entre, on ferme le poste et on en ouvre un autre.
 * 4. Une opération plus longue que la cadence est seule sur son poste, tenue
 *    par plusieurs personnes en parallèle : temps ÷ cadence, arrondi
 *    au-dessus. Rien d'autre ne rejoint ce poste.
 *
 * Les opérations communes (C7) sont hors de la chaîne : elles ne reçoivent
 * ni poids ni poste, et une précédence qui passe par elles est conservée
 * (A → commune → B : B reste après A).
 *
 * C'est une heuristique : bonne solution, pas forcément la meilleure.
 * Fonctions pures et déterministes, sans accès à la base. Le contrôle d'une
 * répartition est dans `controle-repartition.ts` et ne dépend pas de ce fichier.
 */
import {
  EPS,
  EquilibrageErreur,
  parCodeCroissant,
  personnesNecessaires,
  productionJournaliere,
  sommeDesTemps,
  sortieChaine,
  validerOperations,
  verifierEffectif,
  type Operation,
  type ParametresChaine,
  type Poste,
  type RegleRegroupement,
  type SortieChaine,
} from "./equilibrage";

export type OptionsRepartition = {
  /** Règle pour partager un poste ; par défaut `machine_et_suite` (règle de l'atelier). */
  regroupement?: RegleRegroupement;
};

export type PoidsOperation = {
  code: string;
  /** Temps de l'opération + temps de toutes celles qui en dépendent. */
  poids: number;
};

export type PosteReparti = Poste & {
  /** Type de machine de la première opération du poste (`null` = manuel). */
  typeMachine: string | null;
  /** Somme des temps des opérations du poste. */
  tempsMin: number;
  /** Temps du poste ÷ personnes : c'est lui qui se compare à la cadence. */
  tempsParPersonneMin: number;
  /** Temps par personne ÷ cadence visée (0,96 = poste chargé à 96 %). */
  charge: number;
  /** Vrai si le poste porte une opération plus longue que la cadence, tenue à plusieurs. */
  parallele: boolean;
};

export type Repartition = {
  /** Cadence visée reçue (minutes par pièce). */
  cadenceMin: number;
  regroupement: RegleRegroupement;
  /** Opérations de chaîne dans l'ordre du classement (poids décroissant, puis code). */
  classement: PoidsOperation[];
  /** Postes P1, P2… dans l'ordre du travail ; opérations dans l'ordre où les faire. */
  postes: PosteReparti[];
  nombrePostes: number;
  /** Somme des personnes de tous les postes. */
  effectif: number;
  /** Charges, goulot, sortie et taux d'équilibre de cette répartition (calcul du socle). */
  sortie: SortieChaine;
  /** Vrai si au moins un temps n'est que « estimé » : le résultat est indicatif. */
  indicatif: boolean;
};

/**
 * Précédences d'une opération de chaîne, ramenées aux opérations de chaîne :
 * une opération commune est remplacée par ses propres précédences.
 */
function precedencesDeChaine(operations: Operation[]): Map<string, string[]> {
  const parCode = new Map(operations.map((o) => [o.code, o]));
  const memo = new Map<string, string[]>();
  const resoudre = (code: string): string[] => {
    const connu = memo.get(code);
    if (connu) return connu;
    const vues = new Set<string>();
    for (const p of parCode.get(code)!.precedences) {
      if (parCode.get(p)!.commune) for (const q of resoudre(p)) vues.add(q);
      else vues.add(p);
    }
    const liste = [...vues].sort(parCodeCroissant);
    memo.set(code, liste);
    return liste;
  };
  const resultat = new Map<string, string[]>();
  for (const o of operations) if (!o.commune) resultat.set(o.code, resoudre(o.code));
  return resultat;
}

/**
 * Poids positionnel de chaque opération de chaîne, dans l'ordre du
 * classement : poids décroissant, puis code croissant.
 */
export function poidsPositionnels(operations: Operation[]): PoidsOperation[] {
  validerOperations(operations);
  return classer(operations, precedencesDeChaine(operations));
}

function classer(operations: Operation[], precedences: Map<string, string[]>): PoidsOperation[] {
  const chaine = operations.filter((o) => !o.commune);
  const temps = new Map(chaine.map((o) => [o.code, o.tempsMin]));
  const suivantes = new Map<string, string[]>(chaine.map((o) => [o.code, []]));
  for (const [code, precs] of precedences) for (const p of precs) suivantes.get(p)!.push(code);

  // Toutes les opérations qui dépendent d'une opération, directement ou non.
  const memo = new Map<string, Set<string>>();
  const dependantes = (code: string): Set<string> => {
    const connu = memo.get(code);
    if (connu) return connu;
    const ensemble = new Set<string>();
    for (const s of suivantes.get(code)!) {
      ensemble.add(s);
      for (const d of dependantes(s)) ensemble.add(d);
    }
    memo.set(code, ensemble);
    return ensemble;
  };

  const poids: PoidsOperation[] = chaine.map((o) => {
    // Somme dans l'ordre des codes : le même nombre flottant quel que soit l'ordre de la liste reçue.
    const apres = [...dependantes(o.code)].sort(parCodeCroissant);
    return { code: o.code, poids: apres.reduce((s, c) => s + temps.get(c)!, o.tempsMin) };
  });
  return poids.sort((a, b) => (Math.abs(a.poids - b.poids) > EPS ? b.poids - a.poids : parCodeCroissant(a.code, b.code)));
}

/**
 * Répartit les opérations de chaîne sur des postes pour tenir `cadenceMin`
 * (minutes par pièce), par poids positionnel classé. Voir l'en-tête du
 * fichier pour la méthode et `RegleRegroupement` pour le partage d'un poste.
 */
export function repartirOperations(
  operations: Operation[],
  cadenceMin: number,
  options: OptionsRepartition = {},
): Repartition {
  validerOperations(operations);
  if (!Number.isFinite(cadenceMin) || cadenceMin <= 0) {
    throw new EquilibrageErreur(`La cadence doit être un nombre strictement positif (reçu : ${cadenceMin}).`);
  }
  const regroupement: RegleRegroupement = options.regroupement ?? "machine_et_suite";
  const chaine = operations.filter((o) => !o.commune);
  if (chaine.length === 0) throw new EquilibrageErreur("La chaîne n'a aucune opération propre (hors opérations communes).");

  const parCode = new Map(chaine.map((o) => [o.code, o]));
  const precedences = precedencesDeChaine(operations);
  const classement = classer(operations, precedences);
  const placees = new Set<string>();
  const postes: PosteReparti[] = [];

  const prete = (code: string) => !placees.has(code) && precedences.get(code)!.every((p) => placees.has(p));

  while (placees.size < chaine.length) {
    // Le graphe est sans boucle : il reste toujours une opération prête.
    const premiere = parCode.get(classement.find((c) => prete(c.code))!.code)!;
    const codes = [premiere.code];
    let temps = premiere.tempsMin;
    let personnes = 1;
    placees.add(premiere.code);
    const parallele = premiere.tempsMin > cadenceMin + EPS;

    if (parallele) {
      // Au moins 2 : une opération qui dépasse la cadence, même d'un cheveu, ne tient pas seule.
      personnes = Math.max(2, personnesNecessaires(premiere.tempsMin, cadenceMin));
    } else {
      for (;;) {
        const suivante = classement.find((c) => {
          if (!prete(c.code)) return false;
          const op = parCode.get(c.code)!;
          if (temps + op.tempsMin > cadenceMin + EPS) return false;
          if (regroupement === "libre") return true;
          // Même machine que le poste, et à faire juste après une opération du poste.
          return op.typeMachine === premiere.typeMachine && precedences.get(op.code)!.some((p) => codes.includes(p));
        });
        if (!suivante) break;
        codes.push(suivante.code);
        temps += parCode.get(suivante.code)!.tempsMin;
        placees.add(suivante.code);
      }
    }

    postes.push({
      code: `P${postes.length + 1}`,
      personnes,
      operations: codes,
      typeMachine: premiere.typeMachine,
      tempsMin: temps,
      tempsParPersonneMin: temps / personnes,
      charge: temps / personnes / cadenceMin,
      parallele,
    });
  }

  const sortie = sortieChaine(
    operations,
    postes.map((p) => ({ code: p.code, personnes: p.personnes, operations: p.operations })),
  );

  return {
    cadenceMin,
    regroupement,
    classement,
    postes,
    nombrePostes: postes.length,
    effectif: sortie.effectif,
    sortie,
    indicatif: chaine.some((o) => o.source === "estime"),
  };
}

// ---------------------------------------------------------------------------
// « J'ai N personnes, combien de pièces au mieux ? » (D-9)
// ---------------------------------------------------------------------------

export type ParametresProduction = Pick<ParametresChaine, "minutesParJour" | "rendementAttendu">;

export type RepartitionPourEffectif = {
  /** Effectif donné (N). */
  effectif: number;
  /**
   * La répartition qui tient dans N personnes au plus et sort le plus de
   * pièces, calculée à sa cadence réelle (son goulot est donc chargé à
   * 100 %). `null` si aucune répartition ne tient dans N personnes.
   */
  repartition: Repartition | null;
  /** Production journalière de cette répartition = minutes × rendement ÷ cadence réelle. `null` sans répartition. */
  productionJournaliere: number | null;
  /** Pourquoi il n'y a pas de répartition, en français ; `null` quand il y en a une. */
  motif: string | null;
  /** Plus petit effectif rencontré pendant la recherche (utile quand rien ne tient dans N). */
  effectifMinimumTrouve: number;
  /** Nombre de cadences essayées (une par répartition différente). */
  cadencesEssayees: number;
  /** Vrai si la recherche a été arrêtée par le garde-fou avant la borne basse (ne devrait pas arriver). */
  rechercheInterrompue: boolean;
};

/** Garde-fou : la recherche s'arrête de toute façon après ce nombre de cadences. */
const CADENCES_MAX = 20000;

/**
 * Cherche, avec `repartirOperations`, la répartition qui tient dans
 * `effectif` personnes au plus et dont la sortie réelle (goulot) est la plus
 * grande, puis rend sa production journalière (D-9).
 *
 * Méthode — parcours descendant, complet, sans dichotomie. Le nombre de
 * personnes rendu par l'heuristique ne varie pas toujours dans le même sens
 * quand la cadence baisse : on ne saute donc aucune cadence.
 * - Borne haute : cadence = somme des temps. À cette cadence ou au-dessus
 *   tout « tient », la répartition ne change plus.
 * - À chaque pas on répartit à la cadence c et on lit la cadence réelle c′
 *   de la répartition obtenue (temps par personne de son goulot, c′ ≤ c).
 *   Toute cadence comprise entre c′ et c redonne exactement cette
 *   répartition : ce qui tenait tient encore (aucun poste ne dépasse c′), ce
 *   qui ne tenait pas tient encore moins. La cadence suivante à essayer est
 *   donc juste sous c′ : c′ diminuée de trois fois la marge d'arrondi du
 *   moteur (EPS), en valeur relative et en valeur absolue, pour que le poste
 *   goulot ne « tienne » plus. La cadence baisse ainsi à chaque pas, et
 *   chaque répartition différente est vue une fois et une seule.
 * - Borne basse : somme des temps ÷ effectif. En dessous, aucune répartition
 *   ne peut tenir dans N personnes (personnes × cadence réelle ≥ somme).
 * - On retient la répartition à N personnes au plus dont la cadence réelle
 *   est la plus courte. Les cadences réelles vont strictement en décroissant :
 *   il n'y a jamais deux candidates à égalité, et le résultat est rendu à sa
 *   cadence réelle, représentant unique de toutes les cadences équivalentes.
 *
 * Rien ne tient dans N personnes quand la règle `machine_et_suite` interdit
 * de regrouper assez : `repartition` est alors `null` et `motif` l'explique.
 */
export function meilleureRepartitionPourEffectif(
  operations: Operation[],
  effectif: number,
  parametres: ParametresProduction,
  options: OptionsRepartition = {},
): RepartitionPourEffectif {
  validerOperations(operations);
  verifierEffectif(effectif);
  const somme = sommeDesTemps(operations);
  if (somme <= 0) throw new EquilibrageErreur("La chaîne n'a aucune opération propre (hors opérations communes).");
  // Contrôle des minutes et du rendement par le socle, avant toute recherche.
  productionJournaliere(somme, parametres.minutesParJour, parametres.rendementAttendu);

  const borneBasse = somme / effectif;
  let meilleure: Repartition | null = null;
  let effectifMinimumTrouve = Number.POSITIVE_INFINITY;
  let cadencesEssayees = 0;
  let cadence = somme;

  while (cadence >= borneBasse - EPS && cadencesEssayees < CADENCES_MAX) {
    const essai = repartirOperations(operations, cadence, options);
    cadencesEssayees += 1;
    effectifMinimumTrouve = Math.min(effectifMinimumTrouve, essai.effectif);
    // Cadences réelles strictement décroissantes : la dernière qui tient est la meilleure.
    if (essai.effectif <= effectif) meilleure = essai;
    cadence = Math.min(cadence, essai.sortie.cadenceMin) * (1 - 3 * EPS) - 3 * EPS;
  }
  const rechercheInterrompue = cadence >= borneBasse - EPS;

  if (!meilleure) {
    return {
      effectif,
      repartition: null,
      productionJournaliere: null,
      motif:
        `Aucune répartition ne tient dans ${effectif} ${effectif > 1 ? "personnes" : "personne"} : ` +
        `la plus petite trouvée en demande ${effectifMinimumTrouve}. ` +
        ((options.regroupement ?? "machine_et_suite") === "machine_et_suite"
          ? "Deux opérations ne partagent un poste que si elles utilisent le même type de machine et se suivent."
          : "La recherche a été interrompue avant la fin."),
      effectifMinimumTrouve,
      cadencesEssayees,
      rechercheInterrompue,
    };
  }

  // Rendue à sa cadence réelle : mêmes postes, charges lues par rapport au goulot.
  const aCadenceReelle = repartirOperations(operations, meilleure.sortie.cadenceMin, options);
  const repartition = aCadenceReelle.effectif <= effectif ? aCadenceReelle : meilleure;
  return {
    effectif,
    repartition,
    productionJournaliere: productionJournaliere(
      repartition.sortie.cadenceMin,
      parametres.minutesParJour,
      parametres.rendementAttendu,
    ),
    motif: null,
    effectifMinimumTrouve,
    cadencesEssayees,
    rechercheInterrompue,
  };
}
