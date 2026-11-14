/**
 * Cas d'école publiés d'équilibrage de ligne (SALBP-1 : cadence donnée, on
 * cherche le plus petit nombre de postes), pour `scripts/test-equilibrage.ts`
 * — tâche C-03.
 *
 * SOURCE de toutes les données de ce fichier
 * ------------------------------------------
 * Recueil : Scholl, A. (1993) : « Data of assembly line balancing problems »,
 *   Schriften zur Quantitativen Betriebswirtschaftslehre 16/93, TU Darmstadt.
 * Archive : https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/
 *   - graphes de précédence : fichiers `.IN2` (« precedence graphs ») —
 *     ligne 1 : nombre de tâches ; lignes suivantes : temps entiers des
 *     tâches 1 à n ; puis les précédences directes « i,j » (i avant j) ;
 *   - optimums : classeur « SALBP data sets.xlsx », feuille « SALBP-1 data
 *     set », colonnes « c » (cadence donnée) et « m* » (nombre minimal de
 *     postes, optimum prouvé — colonne « optimum proven » = 1 pour toutes les
 *     lignes reprises ici) ;
 *   - somme des temps (`sommeTemps`) : même classeur, feuille « Precedence
 *     graphs », colonne « tsum ». Elle sert à vérifier la recopie.
 * Les temps, les précédences et les optimums ci-dessous ont été recopiés des
 * fichiers eux-mêmes (relus le 2026-11-14), pas de la sortie du moteur.
 *
 * Les tâches 1…n de la source sont codées T01…Tnn. Les cas d'école n'ont pas
 * de machines : ils se testent avec la règle de regroupement « libre ».
 */

export type CasEcole = {
  /** Nom du graphe dans le recueil de Scholl. */
  nom: string;
  /** Auteur d'origine du jeu et fichier de l'archive. */
  source: string;
  /** Temps des tâches 1 à n (unités de la source). */
  temps: number[];
  /** Précédences directes [i, j] : la tâche i avant la tâche j. */
  precedences: [number, number][];
  /** Somme des temps publiée (colonne « tsum »). */
  sommeTemps: number;
  /** Optimums publiés : cadence c → nombre minimal de postes m*. */
  optimums: { cadence: number; postes: number }[];
};

/**
 * Mertens — 7 tâches. Fichier MERTENS.IN2 du recueil de Scholl (1993) ;
 * jeu d'origine attribué à P. Mertens (1967) dans la littérature (l'archive
 * ne donne que le nom « Mertens »).
 * Optimums : feuille « SALBP-1 data set », lignes Mertens c = 6, 7, 8, 10, 15, 18.
 */
export const MERTENS: CasEcole = {
  nom: "Mertens",
  source: "Mertens (1967), dans Scholl (1993), MERTENS.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [1, 5, 4, 3, 5, 6, 5],
  precedences: [[1, 2], [1, 4], [2, 3], [2, 5], [4, 7], [5, 6]],
  sommeTemps: 29,
  optimums: [
    { cadence: 6, postes: 6 },
    { cadence: 7, postes: 5 },
    { cadence: 8, postes: 5 },
    { cadence: 10, postes: 3 },
    { cadence: 15, postes: 2 },
    { cadence: 18, postes: 2 },
  ],
};

/**
 * Bowman — 8 tâches. Fichier BOWMAN8.IN2 du recueil de Scholl (1993), qui
 * porte la mention « Bowman (1960, p. 385) » (E. H. Bowman, « Assembly-line
 * balancing by linear programming », Operations Research 8).
 * Optimum : feuille « SALBP-1 data set », ligne Bowman c = 20 → m* = 5.
 */
export const BOWMAN: CasEcole = {
  nom: "Bowman",
  source: "Bowman (1960, p. 385), dans Scholl (1993), BOWMAN8.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [11, 17, 9, 5, 8, 12, 10, 3],
  precedences: [[1, 2], [2, 3], [2, 4], [3, 5], [3, 6], [4, 6], [5, 7], [6, 8]],
  sommeTemps: 75,
  optimums: [{ cadence: 20, postes: 5 }],
};

/**
 * Solution publiée de Bowman, c = 20, 5 postes — donnée en exemple dans le
 * même classeur (feuille « SALBP-1 data set », « Example mail: Bowman 20 5
 * 1 2 3 4 3 4 5 4 ») : S1={1}, S2={2}, S3={3,5}, S4={4,6,8}, S5={7}.
 */
export const BOWMAN_SOLUTION_PUBLIEE: number[][] = [[1], [2], [3, 5], [4, 6, 8], [7]];

/**
 * Jaeschke — 9 tâches. Fichier JAESCHKE.IN2 du recueil de Scholl (1993) ;
 * jeu d'origine attribué à G. Jaeschke (1964) dans la littérature (l'archive
 * ne donne que le nom « Jaeschke »).
 * Optimums : feuille « SALBP-1 data set », lignes Jaeschke c = 6, 7, 8, 10, 18.
 */
export const JAESCHKE: CasEcole = {
  nom: "Jaeschke",
  source: "Jaeschke (1964), dans Scholl (1993), JAESCHKE.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [5, 3, 4, 5, 4, 5, 1, 4, 6],
  precedences: [[1, 2], [1, 3], [2, 4], [3, 4], [4, 5], [4, 6], [4, 7], [5, 8], [6, 9], [7, 9], [8, 9]],
  sommeTemps: 37,
  optimums: [
    { cadence: 6, postes: 8 },
    { cadence: 7, postes: 7 },
    { cadence: 8, postes: 6 },
    { cadence: 10, postes: 4 },
    { cadence: 18, postes: 3 },
  ],
};

/**
 * Solution publiée de Jaeschke, c = 10, 4 postes — donnée en exemple dans le
 * même classeur (feuille « SALBP-E data set », « Example mail: Jaeschke 4 7
 * 3 4 10 1 2 1 2 3 3 3 4 4 ») : S1={1,3}, S2={2,4}, S3={5,6,7}, S4={8,9}.
 */
export const JAESCHKE_SOLUTION_PUBLIEE: number[][] = [[1, 3], [2, 4], [5, 6, 7], [8, 9]];

/**
 * Jackson — 11 tâches. Fichier JACKSON.IN2 du recueil de Scholl (1993) ;
 * jeu d'origine attribué à J. R. Jackson (1956) dans la littérature
 * (l'archive ne donne que le nom « Jackson »).
 * Optimums : feuille « SALBP-1 data set », lignes Jackson c = 7, 9, 13, 14, 21.
 * Le cas c = 10 (m* = 5) est à part, voir `JACKSON_HEURISTIQUE`.
 */
export const JACKSON: CasEcole = {
  nom: "Jackson",
  source: "Jackson (1956), dans Scholl (1993), JACKSON.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [6, 2, 5, 7, 1, 2, 3, 6, 5, 5, 4],
  precedences: [
    [1, 2], [1, 3], [1, 4], [1, 5], [2, 6], [3, 7], [4, 7], [5, 7],
    [6, 8], [7, 9], [8, 10], [9, 11], [10, 11],
  ],
  sommeTemps: 46,
  optimums: [
    { cadence: 7, postes: 8 },
    { cadence: 9, postes: 6 },
    { cadence: 13, postes: 4 },
    { cadence: 14, postes: 4 },
    { cadence: 21, postes: 3 },
  ],
};

/**
 * Heskiaoff — 28 tâches. Fichier HESKIA.IN2 du recueil de Scholl (1993) ;
 * jeu d'origine attribué à H. Heskiaoff (1968) dans la littérature
 * (l'archive ne donne que le nom « Heskiaoff »).
 * Optimums : feuille « SALBP-1 data set », lignes Heskiaoff c = 138, 205,
 * 216, 256, 324, 342.
 */
export const HESKIAOFF: CasEcole = {
  nom: "Heskiaoff",
  source: "Heskiaoff (1968), dans Scholl (1993), HESKIA.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [
    70, 59, 33, 6, 1, 27, 17, 62, 31, 53,
    21, 19, 108, 52, 5, 8, 97, 8, 47, 67,
    17, 8, 3, 21, 107, 3, 2, 72,
  ],
  precedences: [
    [1, 3], [1, 4], [1, 5], [1, 8], [1, 19], [1, 21], [1, 22], [1, 23], [1, 24], [1, 26],
    [2, 6], [2, 17], [3, 28], [4, 28], [5, 28], [6, 7], [7, 18], [8, 9], [9, 10], [10, 11],
    [10, 12], [11, 15], [12, 13], [13, 14], [13, 16], [14, 28], [15, 28], [16, 28], [17, 28], [18, 28],
    [19, 20], [20, 28], [21, 28], [22, 28], [23, 28], [24, 25], [25, 28], [26, 27], [27, 28],
  ],
  sommeTemps: 1024,
  optimums: [
    { cadence: 138, postes: 8 },
    { cadence: 205, postes: 5 },
    { cadence: 216, postes: 5 },
    { cadence: 256, postes: 4 },
    { cadence: 324, postes: 4 },
    { cadence: 342, postes: 3 },
  ],
};

/** Les cas où le nombre de postes trouvé doit être égal à l'optimum publié. */
export const CAS_OPTIMUM: CasEcole[] = [MERTENS, BOWMAN, JAESCHKE, JACKSON, HESKIAOFF];

/**
 * Jackson, c = 10 : optimum publié m* = 5 (feuille « SALBP-1 data set »,
 * ligne Jackson c = 10). Le poids positionnel classé est une heuristique et
 * n'atteint pas forcément cet optimum : ce cas ne sert qu'au test « au plus
 * optimum + 1, et répartition valable ».
 */
export const JACKSON_HEURISTIQUE: CasEcole = { ...JACKSON, optimums: [{ cadence: 10, postes: 5 }] };

/**
 * Mansoor — 11 tâches. Fichier MANSOOR.IN2 du recueil de Scholl (1993), qui
 * porte la mention « Mansoor (1964) ».
 * Optimums : feuille « SALBP-1 data set », lignes Mansoor c = 48, 62, 94.
 * Même usage que `JACKSON_HEURISTIQUE` : qualité de l'heuristique, pas égalité.
 */
export const MANSOOR_HEURISTIQUE: CasEcole = {
  nom: "Mansoor",
  source: "Mansoor (1964), dans Scholl (1993), MANSOOR.IN2 — https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/",
  temps: [4, 38, 45, 12, 10, 8, 12, 10, 2, 10, 34],
  precedences: [[1, 4], [2, 4], [2, 5], [3, 11], [4, 6], [5, 7], [6, 8], [7, 9], [8, 10], [9, 10], [10, 11]],
  sommeTemps: 185,
  optimums: [
    { cadence: 48, postes: 4 },
    { cadence: 62, postes: 3 },
    { cadence: 94, postes: 2 },
  ],
};

/** Les cas « heuristique » : au plus optimum + 1. */
export const CAS_HEURISTIQUE: CasEcole[] = [JACKSON_HEURISTIQUE, MANSOOR_HEURISTIQUE];

/** Code d'une tâche de la source : 1 → « T01 ». */
export const codeTache = (numero: number): string => `T${String(numero).padStart(2, "0")}`;
