/**
 * Banc de test du moteur d'équilibrage de chaîne (src/lib/confection/equilibrage.ts), tâche C-02.
 *
 * Tous les résultats attendus sont calculés à la main (détail en commentaire) :
 *  1. l'exemple du plan §4.2 : 800 pièces en 480 min avec 2 personnes → 1,2 min ;
 *  2. la cadence visée ;
 *  3. les personnes par opération, arrondies au-dessus, sans piège flottant ;
 *  4. une chaîne en mode « objectif de pièces » (effectif minimum, goulot, équilibre, production) ;
 *  5. la même chaîne en mode « effectif » ;
 *  6. une répartition donnée sur 3 postes ;
 *  7. la charge d'une opération commune (C7) ;
 *  8. les contrôles : boucle de précédences nommée, précédence inconnue, doublons…
 *  9. le déterminisme et l'absence de dépendance à la base.
 *
 * Tâche C-03 (répartition sur les postes, src/lib/confection/repartition.ts et controle-repartition.ts) :
 * 10. des cas d'école publiés (Scholl 1993 : Mertens, Bowman, Jaeschke, Jackson, Heskiaoff) dont l'optimum
 *     est connu — données et sources dans scripts/test-equilibrage-cas-ecole.ts ;
 * 11. le poids positionnel et un cas atelier (machines, opération parallélisée, opération commune) déroulés à la main ;
 * 12. le contrôle indépendant : répartitions produites validées, répartitions truquées refusées ;
 * 13. le déterminisme, y compris liste d'opérations inversée ;
 * 14. les corrections de la revue de C-02 et D-9 (effectif insuffisant, effectif non entier, au moins 1 personne) ;
 * 15. « j'ai N personnes, combien de pièces au mieux ? » ;
 * 16. les limites : liste vide, une seule opération, cadence invalide, opération plus longue que la cadence.
 *
 * Lancer : npm run test:equilibrage
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EquilibrageErreur,
  cadenceVisee,
  calculerChaine,
  capacitePoste,
  chargeOperationCommune,
  effectifTheoriqueMinimum,
  estimerTempsOperation,
  personnesNecessaires,
  productionJournaliere,
  productionJournaliereTheorique,
  sortieChaine,
  validerOperations,
  verifierEffectif,
  type Operation,
  type Poste,
} from "../src/lib/confection/equilibrage";
import { controlerRepartition } from "../src/lib/confection/controle-repartition";
import {
  meilleureRepartitionPourEffectif,
  poidsPositionnels,
  repartirOperations,
  type Repartition,
} from "../src/lib/confection/repartition";
import {
  BOWMAN,
  BOWMAN_SOLUTION_PUBLIEE,
  CAS_HEURISTIQUE,
  CAS_OPTIMUM,
  JACKSON,
  JAESCHKE,
  JAESCHKE_SOLUTION_PUBLIEE,
  MANSOOR_HEURISTIQUE,
  MERTENS,
  codeTache,
  type CasEcole,
} from "./test-equilibrage-cas-ecole";

let n = 0;
// Un test en échec n'arrête pas les suivants : tous sont lancés, les échecs
// sont listés, et le code de sortie est ≠ 0 s'il y en a au moins un.
const echecs: string[] = [];
function test(name: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    echecs.push(name);
    process.exitCode = 1;
    console.log(`✗ ${name}`);
    console.log(`    ${(e instanceof Error ? e.message : String(e)).split("\n").slice(0, 12).join("\n    ")}`);
    return;
  }
  n += 1;
  console.log(`✓ ${name}`);
}
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const erreur = (fn: () => unknown, ...morceaux: string[]) =>
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof EquilibrageErreur, `erreur inattendue : ${String(e)}`);
    for (const m of morceaux) assert.ok(e.message.includes(m), `« ${m} » absent de : ${e.message}`);
    return true;
  });

const op = (code: string, libelle: string, tempsMin: number, precedences: string[] = [], extra: Partial<Operation> = {}): Operation => ({
  code,
  libelle,
  tempsMin,
  source: "chronometre",
  typeMachine: "piqueuse",
  precedences,
  ...extra,
});

// Chaîne d'exemple : un t-shirt simplifié. Somme des temps de chaîne = 0,5 + 1,2 + 0,9 + 0,6 = 3,2 min.
// ETQ (étiquettes) est commune à toutes les chaînes : hors calcul.
const tshirt: Operation[] = [
  op("EPA", "Assembler les épaules", 0.5, [], { typeMachine: "surjeteuse" }),
  op("MAN", "Monter les manches", 1.2, ["EPA"], { typeMachine: "surjeteuse" }),
  op("COL", "Poser le col", 0.9, ["EPA"], { source: "estime" }),
  op("OUR", "Ourler", 0.6, ["MAN", "COL"], { typeMachine: "recouvreuse" }),
  op("ETQ", "Poser les étiquettes", 0.2, [], { commune: true, typeMachine: null }),
];

test("Exemple du plan §4.2 : 2 personnes, 800 pièces en 480 min → 1,2 min", () => {
  // 2 × 480 ÷ 800 = 960 ÷ 800 = 1,2
  close(estimerTempsOperation(2, 480, 800), 1.2);
});

test("Cadence visée : 480 min × 80 % ÷ 640 pièces = 0,6 min", () => {
  // 480 × 0,8 = 384 ; 384 ÷ 640 = 0,6
  close(cadenceVisee(480, 0.8, 640), 0.6);
  // 480 × 1 ÷ 960 = 0,5
  close(cadenceVisee(480, 1, 960), 0.5);
});

test("Personnes par opération arrondies au-dessus, sans piège flottant", () => {
  assert.equal(personnesNecessaires(1.2, 0.6), 2); // 1,2 ÷ 0,6 = 2 exactement (2,0000000000000004 en flottant)
  assert.equal(personnesNecessaires(1.3, 0.6), 3); // 2,17 → 3
  assert.equal(personnesNecessaires(0.5, 0.6), 1); // 0,83 → 1
  assert.equal(personnesNecessaires(0.9, 0.3), 3); // 3 exactement (3,0000000000000004 en flottant)
});

test("Capacité d'un poste : 2 personnes × 60 ÷ 1,2 min = 100 pièces/h", () => {
  close(capacitePoste(2, 1.2), 100);
  close(capacitePoste(1, 0.9), 66.666667);
});

test("Mode objectif : 640 pièces/jour à 80 % sur 480 min", () => {
  const r = calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { piecesVisees: 640 } });
  // Cadence 0,6 ; somme des temps 3,2 (ETQ exclue) ; effectif minimum 3,2 ÷ 0,6 = 5,333…
  close(r.cadenceMin, 0.6);
  close(r.sommeDesTempsMin, 3.2);
  close(r.effectifTheoriqueMinimum, 16 / 3);
  close(effectifTheoriqueMinimum(tshirt, 0.6), 16 / 3);
  // Personnes : EPA 0,5/0,6 → 1 ; MAN 1,2/0,6 → 2 ; COL 0,9/0,6 = 1,5 → 2 ; OUR 0,6/0,6 → 1. Total 6.
  assert.deepEqual(
    r.operations.map((o) => [o.code, o.personnes]),
    [["EPA", 1], ["MAN", 2], ["COL", 2], ["OUR", 1]],
  );
  assert.equal(r.effectifNecessaire, 6);
  // Capacités : EPA 60/0,5 = 120 ; MAN 120/1,2 = 100 ; COL 120/0,9 = 133,33 ; OUR 60/0,6 = 100.
  close(r.operations[2].capaciteParHeure, 133.333333);
  // Goulot : temps par personne max = 0,6 (MAN et OUR à égalité → le premier, MAN). Sortie 100/h.
  assert.equal(r.sortie.goulot, "MAN");
  close(r.sortie.sortieParHeure, 100);
  // Équilibre = 3,2 ÷ (6 × 0,6) = 3,2 ÷ 3,6 = 0,8889
  close(r.sortie.tauxEquilibre, 3.2 / 3.6);
  // Production = 384 ÷ 0,6 = 640 : l'objectif est tenu.
  close(r.productionJournaliere, 640);
  // COL n'a qu'un temps estimé : le résultat est indicatif.
  assert.equal(r.indicatif, true);
});

test("Mode effectif : 4 personnes → 480 pièces/jour au mieux", () => {
  const r = calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif: 4 } });
  // Cadence idéale 3,2 ÷ 4 = 0,8 ; pièces 384 ÷ 0,8 = 480.
  close(r.cadenceMin, 0.8);
  close(r.piecesVisees, 480);
  // Plafond théorique avec un équilibre parfait : 4 × 384 ÷ 3,2 = 480.
  close(productionJournaliereTheorique(tshirt, 4, 480, 0.8), 480);
  // Une opération par poste : EPA 1, MAN ⌈1,5⌉ = 2, COL ⌈1,125⌉ = 2, OUR ⌈0,75⌉ = 1 → 6 (C-03 fera mieux en regroupant).
  assert.equal(r.effectifNecessaire, 6);
});

test("Répartition donnée sur 3 postes : goulot, sortie, équilibre, production", () => {
  // P1 = EPA + COL, 1 personne : 1,4 min ; P2 = MAN, 2 personnes : 0,6 ; P3 = OUR, 1 personne : 0,6.
  const s = sortieChaine(tshirt, [
    { code: "P1", personnes: 1, operations: ["EPA", "COL"] },
    { code: "P2", personnes: 2, operations: ["MAN"] },
    { code: "P3", personnes: 1, operations: ["OUR"] },
  ]);
  close(s.postes[0].tempsMin, 1.4);
  assert.equal(s.goulot, "P1");
  assert.equal(s.effectif, 4);
  close(s.cadenceMin, 1.4);
  close(s.sortieParHeure, 60 / 1.4); // 42,857
  close(s.tauxEquilibre, 3.2 / (4 * 1.4)); // 0,5714
  // 480 × 0,8 ÷ 1,4 = 274,29
  close(productionJournaliere(s.cadenceMin, 480, 0.8), 384 / 1.4);
});

test("Opération commune (C7) : charge de la personne qui sert deux chaînes", () => {
  // (640 + 500) × 0,2 ÷ 480 = 228 ÷ 480 = 0,475 → elle suit.
  close(chargeOperationCommune(0.2, [640, 500], 480), 0.475);
  // (640 + 500) × 0,5 ÷ 480 = 570 ÷ 480 = 1,1875 → au-delà de 100 %, alerte.
  close(chargeOperationCommune(0.5, [640, 500], 480), 1.1875);
});

test("Boucle de précédences refusée, opérations nommées en français", () => {
  const boucle = [
    op("A", "Assembler les épaules", 0.5, ["C"]),
    op("B", "Poser le col", 0.9, ["A"]),
    op("C", "Monter les manches", 1.2, ["B"]),
    op("D", "Ourler", 0.6, ["C"]),
  ];
  erreur(
    () => validerOperations(boucle),
    "Boucle de précédences",
    "A (Assembler les épaules)",
    "B (Poser le col)",
    "C (Monter les manches)",
  );
  // D n'est pas dans la boucle : il ne doit pas être accusé.
  assert.throws(() => validerOperations(boucle), (e: Error) => !e.message.includes("Ourler"));
  // La boucle bloque aussi tous les calculs.
  erreur(() => calculerChaine(boucle, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif: 4 } }), "Boucle");
});

test("Autres données invalides refusées avec un message clair", () => {
  erreur(() => validerOperations([op("A", "Épaules", 0.5, ["Z"])]), "A (Épaules)", "Z", "n'existe pas");
  erreur(() => validerOperations([op("A", "Épaules", 0.5, ["A"])]), "elle-même");
  erreur(() => validerOperations([op("A", "Épaules", 0.5), op("A", "Col", 0.9)]), "deux fois");
  erreur(() => validerOperations([op("A", "Épaules", 0)]), "strictement positif");
  erreur(() => cadenceVisee(480, 1.2, 640), "rendement");
  erreur(() => cadenceVisee(480, 0.8, 0), "objectif");
  erreur(() => sortieChaine(tshirt, [{ code: "P1", personnes: 1, operations: ["EPA", "MAN", "COL"] }]), "sans poste", "OUR");
  erreur(
    () => sortieChaine(tshirt, [{ code: "P1", personnes: 1, operations: ["EPA", "MAN", "COL", "OUR", "ETQ"] }]),
    "commune",
  );
  erreur(
    () =>
      sortieChaine(tshirt, [
        { code: "P1", personnes: 1, operations: ["EPA", "MAN"] },
        { code: "P2", personnes: 1, operations: ["MAN", "COL", "OUR"] },
      ]),
    "deux postes",
  );
  erreur(() => calculerChaine([tshirt[4]], { minutesParJour: 480, rendementAttendu: 0.8, objectif: { piecesVisees: 100 } }), "aucune opération");
});

test("Déterministe : deux calculs identiques donnent le même résultat", () => {
  const params = { minutesParJour: 480, rendementAttendu: 0.85, objectif: { piecesVisees: 700 } };
  assert.deepEqual(calculerChaine(tshirt, params), calculerChaine(tshirt, params));
  // Les données d'entrée ne sont pas modifiées.
  const copie = structuredClone(tshirt);
  calculerChaine(tshirt, params);
  assert.deepEqual(tshirt, copie);
});

test("Fonctions pures : aucun import de Supabase ni de server-only", () => {
  const source = readFileSync(new URL("../src/lib/confection/equilibrage.ts", import.meta.url), "utf8");
  assert.ok(!/^\s*import\b/m.test(source), "le moteur ne doit rien importer");
  assert.ok(!/supabase|server-only/i.test(source.replace(/\/\*[\s\S]*?\*\//g, "")));
});

// ===========================================================================
// Tâche C-03 — répartition des opérations sur les postes, contrôle
// indépendant, corrections de la revue de C-02 et décision D-9.
// ===========================================================================

/** Opérations d'un cas d'école publié : tâches T01…Tnn, sans machine (règle « libre »). */
const operationsCas = (cas: CasEcole): Operation[] =>
  cas.temps.map((t, i) => ({
    code: codeTache(i + 1),
    libelle: `Tâche ${i + 1}`,
    tempsMin: t,
    source: "chronometre" as const,
    typeMachine: null,
    precedences: cas.precedences.filter(([, apres]) => apres === i + 1).map(([avant]) => codeTache(avant)),
  }));

/** Les postes d'une répartition, réduits à ce que le contrôle reçoit. */
const postesDe = (r: Repartition): Poste[] => r.postes.map((p) => ({ code: p.code, personnes: p.personnes, operations: [...p.operations] }));
/** Résumé lisible : [opérations, personnes] poste par poste. */
const resume = (r: Repartition) => r.postes.map((p) => [p.operations, p.personnes]);
/** La même liste dans l'ordre inverse, précédences de chaque opération inversées aussi. */
const inverse = (ops: Operation[]): Operation[] => [...ops].reverse().map((o) => ({ ...o, precedences: [...o.precedences].reverse() }));
/** Au moins une anomalie contient tous les morceaux attendus. */
const refuse = (anomalies: string[], ...morceaux: string[]) =>
  assert.ok(
    anomalies.some((a) => morceaux.every((m) => a.includes(m))),
    `aucune anomalie ne contient ${morceaux.map((m) => `« ${m} »`).join(" + ")} — reçu : ${JSON.stringify(anomalies)}`,
  );

/**
 * Propriétés toujours vraies d'une répartition produite, vérifiées ici sans
 * passer par `controlerRepartition` (qui est testé à part) :
 * chaque opération de chaîne une fois et une seule, postes P1…Pn, personnes
 * entières ≥ 1, aucun poste au-dessus de la cadence par personne, plusieurs
 * personnes seulement sur une opération seule et plus longue que la cadence,
 * précédences directes respectées, totaux cohérents.
 */
function verifierProprietes(ops: Operation[], r: Repartition, cadence: number) {
  const chaine = ops.filter((o) => !o.commune);
  const parCode = new Map(ops.map((o) => [o.code, o]));
  const placees = r.postes.flatMap((p) => p.operations);
  assert.deepEqual([...placees].sort(), chaine.map((o) => o.code).sort(), "chaque opération de chaîne une fois et une seule");
  assert.equal(r.nombrePostes, r.postes.length);
  assert.equal(r.effectif, r.postes.reduce((s, p) => s + p.personnes, 0));
  assert.equal(r.classement.length, chaine.length);
  const rang = new Map(placees.map((c, i) => [c, i]));
  r.postes.forEach((p, i) => {
    assert.equal(p.code, `P${i + 1}`);
    assert.ok(Number.isInteger(p.personnes) && p.personnes >= 1, `${p.code} : personnes = ${p.personnes}`);
    const temps = p.operations.reduce((s, c) => s + parCode.get(c)!.tempsMin, 0);
    close(p.tempsMin, temps);
    assert.ok(temps / p.personnes <= cadence + 1e-9, `${p.code} dépasse la cadence : ${temps} ÷ ${p.personnes} > ${cadence}`);
    if (p.personnes > 1) {
      assert.equal(p.operations.length, 1, `${p.code} : une opération parallélisée est seule sur son poste`);
      assert.ok(temps > cadence, `${p.code} : plusieurs personnes sans dépassement de cadence`);
      // Arrondi au-dessus, pas plus : une personne de moins ne suffirait pas.
      assert.ok(temps / (p.personnes - 1) > cadence + 1e-9, `${p.code} : trop de personnes (${p.personnes})`);
    }
  });
  for (const o of chaine) for (const avant of o.precedences) {
    if (parCode.get(avant)!.commune) continue;
    assert.ok(rang.get(avant)! < rang.get(o.code)!, `${avant} doit être avant ${o.code}`);
  }
}

test("Cas d'école : la recopie correspond aux sommes publiées, les optimums respectent la borne ⌈somme ÷ cadence⌉", () => {
  for (const cas of [...CAS_OPTIMUM, MANSOOR_HEURISTIQUE]) {
    // Colonne « tsum » du classeur de Scholl : Mertens 29, Bowman 75, Jaeschke 37, Jackson 46, Heskiaoff 1024, Mansoor 185.
    assert.equal(cas.temps.reduce((s, t) => s + t, 0), cas.sommeTemps, `${cas.nom} : somme des temps`);
    for (const [a, b] of cas.precedences) assert.ok(a >= 1 && b <= cas.temps.length && a < b, `${cas.nom} : arc ${a},${b}`);
  }
  for (const cas of [...CAS_OPTIMUM, ...CAS_HEURISTIQUE]) {
    for (const { cadence, postes } of cas.optimums) {
      assert.ok(postes >= Math.ceil(cas.sommeTemps / cadence), `${cas.nom} c=${cadence} : optimum sous la borne`);
    }
  }
  assert.deepEqual(CAS_OPTIMUM.map((c) => c.temps.length), [7, 8, 9, 11, 28]);
});

test("Cas d'école publiés (Scholl 1993) : nombre de postes trouvé = optimum connu, règle « libre »", () => {
  // Source de chaque jeu (auteur d'origine, recueil de Scholl, URL) : voir
  // scripts/test-equilibrage-cas-ecole.ts et le champ `source`, rappelé dans le message d'échec.
  //  - Mertens (1967), 7 tâches   : c = 6, 7, 8, 10, 15, 18 → m* = 6, 5, 5, 3, 2, 2
  //  - Bowman (1960), 8 tâches    : c = 20 → m* = 5
  //  - Jaeschke (1964), 9 tâches  : c = 6, 7, 8, 10, 18 → m* = 8, 7, 6, 4, 3
  //  - Jackson (1956), 11 tâches  : c = 7, 9, 13, 14, 21 → m* = 8, 6, 4, 4, 3
  //  - Heskiaoff (1968), 28 tâches: c = 138, 205, 216, 256, 324, 342 → m* = 8, 5, 5, 4, 4, 3
  // Scholl, A. (1993), Data of assembly line balancing problems, TU Darmstadt —
  // https://assembly-line-balancing.de/salbp/benchmark-data-sets-1993/
  let instances = 0;
  for (const cas of CAS_OPTIMUM) {
    const ops = operationsCas(cas);
    for (const { cadence, postes } of cas.optimums) {
      const r = repartirOperations(ops, cadence, { regroupement: "libre" });
      assert.equal(r.nombrePostes, postes, `${cas.nom}, cadence ${cadence} : ${r.nombrePostes} postes trouvés, optimum publié ${postes} [${cas.source}]`);
      // Aucune tâche ne dépasse la cadence dans ces jeux : une personne par poste.
      assert.equal(r.effectif, postes, `${cas.nom}, cadence ${cadence} : effectif`);
      verifierProprietes(ops, r, cadence);
      assert.deepEqual(controlerRepartition(ops, postesDe(r), cadence, { regroupement: "libre" }), [], `${cas.nom}, cadence ${cadence} : contrôle`);
      instances += 1;
    }
  }
  assert.equal(instances, 23); // 6 + 1 + 5 + 5 + 6
});

test("Mertens, cadence 10 : classement et postes déroulés à la main", () => {
  // Temps : T01 1, T02 5, T03 4, T04 3, T05 5, T06 6, T07 5. Arcs : 1→2, 1→4, 2→3, 2→5, 4→7, 5→6.
  // Poids : T01 = 29 (tout dépend d'elle) ; T02 = 5 + T03 4 + T05 5 + T06 6 = 20 ; T05 = 5 + 6 = 11 ;
  //         T04 = 3 + T07 5 = 8 ; T06 = 6 ; T07 = 5 ; T03 = 4.
  const ops = operationsCas(MERTENS);
  assert.deepEqual(
    poidsPositionnels(ops).map((p) => [p.code, p.poids]),
    [["T01", 29], ["T02", 20], ["T05", 11], ["T04", 8], ["T06", 6], ["T07", 5], ["T03", 4]],
  );
  // P1 : T01 (1) + T02 (6) ; T05 ferait 11 > 10 ; T04 → 9 ; T07 ferait 14, T03 13 → fermé à 9.
  // P2 : T05 (5) ; T06 ferait 11 ; T07 → 10 → fermé.
  // P3 : T06 (6) + T03 (4) = 10.
  const r = repartirOperations(ops, 10, { regroupement: "libre" });
  assert.deepEqual(resume(r), [[["T01", "T02", "T04"], 1], [["T05", "T07"], 1], [["T06", "T03"], 1]]);
  assert.deepEqual(r.postes.map((p) => p.tempsMin), [9, 10, 10]);
  // Goulot : le premier poste à 10 (P2). Équilibre = 29 ÷ (3 × 10).
  assert.equal(r.sortie.goulot, "P2");
  close(r.sortie.tauxEquilibre, 29 / 30);
  assert.equal(r.cadenceMin, 10);
  assert.equal(r.regroupement, "libre");
});

test("Contrôle : les solutions optimales publiées par Scholl (Bowman c=20, Jaeschke c=10) sont reconnues valables", () => {
  // Solutions données en exemple dans le classeur « SALBP data sets.xlsx » (voir le fichier des cas d'école).
  const enPostes = (solution: number[][]): Poste[] => solution.map((taches, i) => ({ code: `S${i + 1}`, personnes: 1, operations: taches.map(codeTache) }));
  // Bowman : charges 11, 17, 9+8 = 17, 5+12+3 = 20, 10 → toutes ≤ 20.
  assert.deepEqual(controlerRepartition(operationsCas(BOWMAN), enPostes(BOWMAN_SOLUTION_PUBLIEE), 20, { regroupement: "libre" }), []);
  // Jaeschke : charges 5+4 = 9, 3+5 = 8, 4+5+1 = 10, 4+6 = 10 → toutes ≤ 10.
  assert.deepEqual(controlerRepartition(operationsCas(JAESCHKE), enPostes(JAESCHKE_SOLUTION_PUBLIEE), 10, { regroupement: "libre" }), []);
  // La même solution de Jaeschke ne tient pas à la cadence 9 : deux postes à 10.
  const a9 = controlerRepartition(operationsCas(JAESCHKE), enPostes(JAESCHKE_SOLUTION_PUBLIEE), 9, { regroupement: "libre" });
  refuse(a9, "S3", "dépasse la cadence");
  refuse(a9, "S4", "dépasse la cadence");
});

test("Heuristique documentée (Jackson c=10, Mansoor) : au plus optimum + 1, jamais sous l'optimum, répartition valable", () => {
  // Le poids positionnel classé ne garantit pas l'optimum. Optimums publiés
  // (Scholl 1993, même archive) : Jackson c=10 → 5 ; Mansoor (1964) c=48, 62, 94 → 4, 3, 2.
  for (const cas of CAS_HEURISTIQUE) {
    const ops = operationsCas(cas);
    for (const { cadence, postes } of cas.optimums) {
      const r = repartirOperations(ops, cadence, { regroupement: "libre" });
      assert.ok(r.nombrePostes >= postes, `${cas.nom} c=${cadence} : ${r.nombrePostes} postes, sous l'optimum prouvé ${postes} — impossible`);
      assert.ok(r.nombrePostes <= postes + 1, `${cas.nom} c=${cadence} : ${r.nombrePostes} postes, optimum ${postes}`);
      verifierProprietes(ops, r, cadence);
      assert.deepEqual(controlerRepartition(ops, postesDe(r), cadence, { regroupement: "libre" }), []);
    }
  }
});

// Graphe en losange : A avant B et C, B et C avant D ; E est à part. Tout sur piqueuse.
const losange: Operation[] = [
  op("A", "Assembler", 2),
  op("B", "Border", 3, ["A"]),
  op("C", "Coudre le col", 4, ["A"]),
  op("D", "Doubler", 1, ["B", "C"]),
  op("E", "Étiqueter", 1),
];

test("Poids positionnel calculé à la main : losange, égalité départagée par le code, opération commune traversée", () => {
  // D est atteinte depuis A par deux chemins (A→B→D et A→C→D) : elle ne compte qu'une fois.
  // A = 2 + B 3 + C 4 + D 1 = 10 (et non 11) ; C = 4 + 1 = 5 ; B = 3 + 1 = 4 ; D = 1 ; E = 1.
  // D et E à égalité (1) : code croissant, D avant E.
  assert.deepEqual(
    poidsPositionnels(losange).map((p) => [p.code, p.poids]),
    [["A", 10], ["C", 5], ["B", 4], ["D", 1], ["E", 1]],
  );
  // T-shirt : EPA = 0,5 + 1,2 + 0,9 + 0,6 = 3,2 ; MAN = 1,2 + 0,6 = 1,8 ; COL = 0,9 + 0,6 = 1,5 ; OUR = 0,6.
  // ETQ est commune : ni poids ni place dans le classement.
  const p = poidsPositionnels(tshirt);
  assert.deepEqual(p.map((x) => x.code), ["EPA", "MAN", "COL", "OUR"]);
  [3.2, 1.8, 1.5, 0.6].forEach((attendu, i) => close(p[i].poids, attendu));
  // A → K (commune) → B : B dépend toujours de A, K ne pèse rien. A = 2 + 3 = 5 ; B = 3.
  const traverse = [op("A", "Assembler", 2), op("K", "Contrôler", 7, ["A"], { commune: true }), op("B", "Border", 3, ["K"])];
  assert.deepEqual(poidsPositionnels(traverse).map((x) => [x.code, x.poids]), [["A", 5], ["B", 3]]);
  // Liste vide : aucun poids.
  assert.deepEqual(poidsPositionnels([]), []);
  // Même classement quel que soit l'ordre de la liste reçue.
  assert.deepEqual(poidsPositionnels(inverse(losange)), poidsPositionnels(losange));
});

// Cas atelier : un polo simplifié, avec machines, une opération plus longue que
// la cadence (COT) et une opération commune (CTL) placée entre COT et OUR.
// Somme des temps de chaîne = 0,5 + 0,4 + 1,5 + 0,7 + 0,2 + 0,6 + 0,3 + 0,4 = 4,6 min.
const polo: Operation[] = [
  op("EPA", "Assembler les épaules", 0.5, [], { typeMachine: "surjeteuse" }),
  op("MAN", "Monter les manches", 0.4, ["EPA"], { typeMachine: "surjeteuse" }),
  op("COT", "Fermer les côtés", 1.5, ["MAN"], { typeMachine: "surjeteuse" }),
  op("COL", "Poser le col", 0.7, ["EPA"]),
  op("SUR", "Surpiquer le col", 0.2, ["COL"]),
  op("CTL", "Contrôler en cours", 0.3, ["COT"], { commune: true, typeMachine: null }),
  op("OUR", "Ourler", 0.6, ["CTL", "SUR"], { typeMachine: "recouvreuse" }),
  op("BTN", "Poser les boutons", 0.3, ["OUR"], { typeMachine: null }),
  op("PLI", "Plier", 0.4, ["BTN"], { typeMachine: null }),
];
// Répartition attendue du polo à la cadence 1,0, règle de l'atelier (déroulée à la main ci-dessous).
const postesPolo = (): Poste[] => [
  { code: "P1", personnes: 1, operations: ["EPA", "MAN"] },
  { code: "P2", personnes: 2, operations: ["COT"] },
  { code: "P3", personnes: 1, operations: ["COL", "SUR"] },
  { code: "P4", personnes: 1, operations: ["OUR"] },
  { code: "P5", personnes: 1, operations: ["BTN", "PLI"] },
];

test("Cas atelier (règle par défaut) : machines, opération parallélisée, opération commune — déroulé à la main", () => {
  // Poids (CTL, commune, est traversée : OUR dépend de COT) :
  //   PLI 0,4 ; BTN 0,3 + 0,4 = 0,7 ; OUR 0,6 + 0,7 = 1,3 ; SUR 0,2 + 1,3 = 1,5 ; COL 0,7 + 1,5 = 2,2 ;
  //   COT 1,5 + 1,3 = 2,8 ; MAN 0,4 + 2,8 = 3,2 ; EPA 0,5 + 4,1 (toutes les autres) = 4,6.
  const r = repartirOperations(polo, 1.0);
  assert.deepEqual(r.classement.map((c) => c.code), ["EPA", "MAN", "COT", "COL", "SUR", "OUR", "BTN", "PLI"]);
  [4.6, 3.2, 2.8, 2.2, 1.5, 1.3, 0.7, 0.4].forEach((attendu, i) => close(r.classement[i].poids, attendu));
  // Cadence 1,0 :
  //   P1 : EPA 0,5 + MAN (surjeteuse, suit EPA) = 0,9 ; COT ferait 2,4 → fermé.
  //   P2 : COT 1,5 > 1,0 → seule, ⌈1,5 ÷ 1,0⌉ = 2 personnes, 0,75 min par personne.
  //   P3 : COL 0,7 + SUR (piqueuse, suit COL) = 0,9 ; OUR est sur recouvreuse (et ferait 1,5) → fermé.
  //   P4 : OUR 0,6 ; BTN tiendrait (0,9) mais elle est manuelle → fermé.
  //   P5 : BTN 0,3 + PLI (manuelle, suit BTN) = 0,7.
  assert.equal(r.regroupement, "machine_et_suite");
  assert.deepEqual(postesDe(r), postesPolo());
  assert.deepEqual(r.postes.map((p) => p.typeMachine), ["surjeteuse", "surjeteuse", "piqueuse", "recouvreuse", null]);
  assert.deepEqual(r.postes.map((p) => p.parallele), [false, true, false, false, false]);
  [0.9, 1.5, 0.9, 0.6, 0.7].forEach((attendu, i) => close(r.postes[i].tempsMin, attendu));
  [0.9, 0.75, 0.9, 0.6, 0.7].forEach((attendu, i) => close(r.postes[i].tempsParPersonneMin, attendu));
  [0.9, 0.75, 0.9, 0.6, 0.7].forEach((attendu, i) => close(r.postes[i].charge, attendu)); // ÷ cadence 1,0
  assert.equal(r.nombrePostes, 5);
  assert.equal(r.effectif, 6); // 1 + 2 + 1 + 1 + 1
  // Goulot : P1 et P3 à 0,9 → le premier, P1. Sortie 60 ÷ 0,9 = 66,67 pièces/h.
  assert.equal(r.sortie.goulot, "P1");
  close(r.sortie.cadenceMin, 0.9);
  close(r.sortie.sortieParHeure, 60 / 0.9);
  // Équilibre = 4,6 ÷ (6 × 0,9) = 4,6 ÷ 5,4 = 0,8519.
  close(r.sortie.tauxEquilibre, 4.6 / 5.4);
  assert.equal(r.indicatif, false);
  verifierProprietes(polo, r, 1.0);
  assert.deepEqual(controlerRepartition(polo, postesDe(r), 1.0), []);
  // Un temps seulement « estimé » (COL du t-shirt) rend le résultat indicatif.
  assert.equal(repartirOperations(tshirt, 1.0).indicatif, true);
  // Les données d'entrée ne sont pas modifiées.
  const copie = structuredClone(polo);
  repartirOperations(polo, 1.0);
  assert.deepEqual(polo, copie);
});

test("Cas atelier (règle « libre ») : la machine ne compte plus, la cadence et les précédences si", () => {
  // Cadence 1,0, même classement :
  //   P1 : EPA + MAN = 0,9 (COT 2,4 et COL 1,6 ne tiennent pas) ; P2 : COT seule à 2 personnes ;
  //   P3 : COL + SUR = 0,9 (OUR ferait 1,5) ; P4 : OUR 0,6 + BTN 0,3 = 0,9 (PLI ferait 1,3) ; P5 : PLI.
  const r = repartirOperations(polo, 1.0, { regroupement: "libre" });
  assert.deepEqual(resume(r), [[["EPA", "MAN"], 1], [["COT"], 2], [["COL", "SUR"], 1], [["OUR", "BTN"], 1], [["PLI"], 1]]);
  verifierProprietes(polo, r, 1.0);
  assert.deepEqual(controlerRepartition(polo, postesDe(r), 1.0, { regroupement: "libre" }), []);
  // Cette répartition « libre » mélange recouvreuse et manuel sur P4 : la règle de l'atelier la refuse.
  refuse(controlerRepartition(polo, postesDe(r), 1.0), "P4", "machines différentes");
  // T-shirt, règle de l'atelier, cadence 2 : EPA + MAN (surjeteuse, se suivent) = 1,7 ; COL (piqueuse) ; OUR (recouvreuse).
  const t = repartirOperations(tshirt, 2);
  assert.deepEqual(resume(t), [[["EPA", "MAN"], 1], [["COL"], 1], [["OUR"], 1]]);
  assert.deepEqual(controlerRepartition(tshirt, postesDe(t), 2), []);
  // Même chose en « libre » : EPA + MAN = 1,7 (COL ferait 2,6) ; COL + OUR = 1,5.
  assert.deepEqual(resume(repartirOperations(tshirt, 2, { regroupement: "libre" })), [[["EPA", "MAN"], 1], [["COL", "OUR"], 1]]);
});

test("Contrôle : chaque répartition truquée à la main est refusée, et le message nomme le problème", () => {
  // Point de départ : la répartition valable du polo à la cadence 1,0.
  assert.deepEqual(controlerRepartition(polo, postesPolo(), 1.0), []);
  const [p1, p2, p3, p4, p5] = postesPolo();

  // 1. Précédence inversée entre postes : le poste des boutons (BTN, PLI) passe avant celui de l'ourlet.
  refuse(controlerRepartition(polo, [p1, p2, p3, p5, p4], 1.0), "Précédence non respectée", "BTN (Poser les boutons)", "OUR (Ourler)", "P5", "P4");

  // 2. Précédence inversée dans un poste : MAN écrite avant EPA sur P1.
  refuse(
    controlerRepartition(polo, [{ ...p1, operations: ["MAN", "EPA"] }, p2, p3, p4, p5], 1.0),
    "Précédence non respectée sur le poste P1", "MAN (Monter les manches)", "EPA (Assembler les épaules)",
  );

  // 3. Deux machines différentes sur un poste : OUR (recouvreuse) + BTN (manuelle) = 0,9, sous la cadence.
  const deuxMachines = controlerRepartition(polo, [p1, p2, p3, { ...p4, operations: ["OUR", "BTN"] }, { ...p5, operations: ["PLI"] }], 1.0);
  refuse(deuxMachines, "P4", "machines différentes", "recouvreuse", "manuel");
  assert.ok(!deuxMachines.some((a) => a.includes("cadence")), "0,9 min ≤ 1,0 : pas d'anomalie de cadence attendue");

  // 4. Poste au-dessus de la cadence.
  //    a) COT (1,5 min) laissée à une seule personne pour une cadence de 1,0.
  refuse(controlerRepartition(polo, [p1, { ...p2, personnes: 1 }, p3, p4, p5], 1.0), "P2", "dépasse la cadence", "1,5");
  //    b) à 2 personnes mais cadence 0,7 : 1,5 ÷ 2 = 0,75 min par personne > 0,7. (P1 et P3, à 0,9, dépassent aussi.)
  const cadence07 = controlerRepartition(polo, postesPolo(), 0.7);
  refuse(cadence07, "P2", "dépasse la cadence", "2 personnes", "0,75");
  refuse(cadence07, "P1", "dépasse la cadence", "0,9");
  //    c) trois opérations regroupées : EPA + MAN + COT = 2,4 min à une personne.
  refuse(controlerRepartition(polo, [{ ...p1, operations: ["EPA", "MAN", "COT"] }, p3, p4, p5], 1.0), "P1", "dépasse la cadence", "2,4");

  // 5. Opération oubliée : le poste de l'ourlet a disparu.
  refuse(controlerRepartition(polo, [p1, p2, p3, p5], 1.0), "OUR (Ourler)", "aucun poste");

  // 6. Opération affectée deux fois : sur deux postes, puis deux fois sur le même.
  refuse(controlerRepartition(polo, [p1, p2, p3, p4, p5, { code: "P6", personnes: 1, operations: ["OUR"] }], 1.0), "OUR (Ourler)", "deux postes", "P4", "P6");
  refuse(controlerRepartition(polo, [p1, p2, p3, { ...p4, operations: ["OUR", "OUR"] }, p5], 1.0), "OUR (Ourler)", "deux fois", "P4");

  // Précédence à travers l'opération commune : COT → CTL (commune) → OUR. OUR placée avant COT est refusée.
  refuse(controlerRepartition(polo, [p1, p3, p4, p2, p5], 1.0), "Précédence non respectée", "OUR (Ourler)", "COT (Fermer les côtés)");

  // Autres malfaçons : opération commune sur un poste, opération inconnue, poste sans personne,
  // poste vide, poste en double, aucune répartition.
  refuse(controlerRepartition(polo, [p1, p2, p3, { ...p4, operations: ["OUR", "CTL"] }, p5], 1.0), "CTL (Contrôler en cours)", "commune");
  refuse(controlerRepartition(polo, [p1, p2, p3, { ...p4, operations: ["OUR", "ZZZ"] }, p5], 1.0), "ZZZ", "n'existe pas");
  refuse(controlerRepartition(polo, [p1, { ...p2, personnes: 0 }, p3, p4, p5], 1.0), "P2", "personnes");
  refuse(controlerRepartition(polo, [p1, { ...p2, personnes: 1.5 }, p3, p4, p5], 1.0), "P2", "entier");
  refuse(controlerRepartition(polo, [p1, p2, p3, p4, p5, { code: "P6", personnes: 1, operations: [] }], 1.0), "P6", "aucune opération");
  refuse(controlerRepartition(polo, [p1, p2, p3, p4, { ...p5, code: "P4" }], 1.0), "P4", "deux fois");
  const rien = controlerRepartition(polo, [], 1.0);
  refuse(rien, "aucun poste");
  assert.ok(rien.length >= 9, "aucun poste : les 8 opérations de chaîne sont aussi signalées une à une");

  // Données de départ invalides : là, c'est une erreur (cadence, opérations).
  for (const cadence of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    erreur(() => controlerRepartition(polo, postesPolo(), cadence), "cadence", "strictement positif");
  }
  erreur(() => controlerRepartition([op("A", "Épaules", 0.5, ["Z"])], [], 1), "n'existe pas");
});

test("Contrôle, règle par défaut : même machine mais sans lien de précédence sur un poste → refusé ; accepté en « libre »", () => {
  // Losange, tout sur piqueuse, cadence 10. B et C dépendent toutes deux de A mais pas l'une de l'autre.
  const separees: Poste[] = [
    { code: "P1", personnes: 1, operations: ["A"] },
    { code: "P2", personnes: 1, operations: ["B", "C"] }, // 3 + 4 = 7 ≤ 10, même machine, aucun lien direct
    { code: "P3", personnes: 1, operations: ["D", "E"] }, // E n'a de lien avec personne
  ];
  const a = controlerRepartition(losange, separees, 10);
  refuse(a, "P2", "ne se suivent pas", "C (Coudre le col)");
  refuse(a, "P3", "ne se suivent pas", "E (Étiqueter)");
  assert.ok(!a.some((x) => x.includes("machines différentes")), "même machine partout : seul le « se suivent » est en cause");
  // En « libre », la même répartition est valable.
  assert.deepEqual(controlerRepartition(losange, separees, 10, { regroupement: "libre" }), []);
  // A, B, C, D sur un poste : chacune est reliée à une autre par une précédence directe → valable (2+3+4+1 = 10).
  assert.deepEqual(
    controlerRepartition(losange, [{ code: "P1", personnes: 1, operations: ["A", "B", "C", "D"] }, { code: "P2", personnes: 1, operations: ["E"] }], 10),
    [],
  );
  // Ce que produit le moteur avec la règle par défaut respecte la règle : E n'est jamais regroupée.
  for (const cadence of [4, 5, 7, 9, 10, 11, 100]) {
    const r = repartirOperations(losange, cadence);
    verifierProprietes(losange, r, cadence);
    assert.deepEqual(controlerRepartition(losange, postesDe(r), cadence), [], `losange, cadence ${cadence}`);
    assert.ok(r.postes.some((p) => p.operations.length === 1 && p.operations[0] === "E"), `cadence ${cadence} : E doit rester seule`);
  }
  // Cadence 100, règle par défaut, à la main : A (2), puis C (prête, suit A), B (suit A), D (suit B et C) → P1 = A, C, B, D ; P2 = E.
  assert.deepEqual(resume(repartirOperations(losange, 100)), [[["A", "C", "B", "D"], 1], [["E"], 1]]);
  // En « libre » à la cadence 100 : tout tient sur un poste (somme 11), dans l'ordre du classement.
  assert.deepEqual(resume(repartirOperations(losange, 100, { regroupement: "libre" })), [[["A", "C", "B", "D", "E"], 1]]);
});

test("Contrôle indépendant : controle-repartition.ts n'importe ni repartition.ts ni Supabase", () => {
  const source = readFileSync(new URL("../src/lib/confection/controle-repartition.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const modules = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(modules)], ["./equilibrage"], "le contrôle ne doit importer que le socle");
  assert.ok(!/\brequire\s*\(|\bimport\s*\(/.test(code), "ni require ni import dynamique");
  assert.ok(!/["'][^"']*repartition["']/.test(code.replace(/controle-repartition/g, "")), "aucun module « repartition » importé");
  assert.ok(!/repartirOperations|meilleureRepartitionPourEffectif|poidsPositionnels/.test(code), "le contrôle n'appelle pas l'algorithme");
  assert.ok(!/supabase|server-only/i.test(code));
  // repartition.ts reste pur lui aussi : il n'importe que le socle.
  const repartition = readFileSync(new URL("../src/lib/confection/repartition.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.deepEqual([...new Set([...repartition.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]))], ["./equilibrage"]);
  assert.ok(!/supabase|server-only/i.test(repartition));
});

test("Déterminisme de la répartition : deux exécutions identiques, et même résultat liste inversée", () => {
  const essais: [string, Operation[], number, "machine_et_suite" | "libre"][] = [
    ["polo, règle atelier", polo, 1.0, "machine_et_suite"],
    ["polo, libre", polo, 1.0, "libre"],
    ["polo, cadence 0,45", polo, 0.45, "machine_et_suite"],
    ["losange", losange, 7, "machine_et_suite"],
    ["t-shirt", tshirt, 1.4, "libre"],
  ];
  for (const cas of [...CAS_OPTIMUM, ...CAS_HEURISTIQUE]) {
    for (const { cadence } of cas.optimums) essais.push([`${cas.nom} c=${cadence}`, operationsCas(cas), cadence, "libre"]);
  }
  for (const [nom, ops, cadence, regroupement] of essais) {
    const premiere = repartirOperations(ops, cadence, { regroupement });
    assert.deepEqual(repartirOperations(ops, cadence, { regroupement }), premiere, `${nom} : deux exécutions`);
    const retournee = repartirOperations(inverse(ops), cadence, { regroupement });
    // La répartition elle-même : mêmes postes, mêmes opérations dans le même ordre, mêmes personnes, même classement.
    assert.deepEqual(postesDe(retournee), postesDe(premiere), `${nom} : postes, liste inversée`);
    assert.deepEqual(retournee.classement.map((c) => c.code), premiere.classement.map((c) => c.code), `${nom} : classement, liste inversée`);
    // Les chiffres de chaque poste aussi, au bit près.
    assert.deepEqual(retournee.postes, premiere.postes, `${nom} : chiffres des postes, liste inversée`);
    assert.deepEqual(retournee.classement, premiere.classement, `${nom} : poids, liste inversée`);
    // Le contrôle rend le même verdict dans les deux ordres.
    assert.deepEqual(controlerRepartition(inverse(ops), postesDe(premiere), cadence, { regroupement }), []);
  }
});

test("Déterminisme strict : liste inversée → résultat complet identique au bit près (taux d'équilibre compris)", () => {
  // Critère de la tâche : « même résultat quand la liste d'opérations est donnée dans l'ordre inverse ».
  // Temps entiers (cas d'école) puis temps décimaux (polo, t-shirt).
  for (const cas of CAS_OPTIMUM) {
    const ops = operationsCas(cas);
    for (const { cadence } of cas.optimums) {
      assert.deepEqual(repartirOperations(inverse(ops), cadence, { regroupement: "libre" }), repartirOperations(ops, cadence, { regroupement: "libre" }), `${cas.nom} c=${cadence}`);
    }
  }
  for (const [nom, ops, cadence] of [["polo", polo, 1.0], ["polo", polo, 0.45], ["t-shirt", tshirt, 1.4]] as const) {
    const a = repartirOperations([...ops], cadence);
    const b = repartirOperations(inverse([...ops]), cadence);
    assert.equal(b.sortie.tauxEquilibre, a.sortie.tauxEquilibre, `${nom}, cadence ${cadence} : taux d'équilibre ${a.sortie.tauxEquilibre} (liste donnée) ≠ ${b.sortie.tauxEquilibre} (liste inversée)`);
    assert.deepEqual(b, a, `${nom}, cadence ${cadence} : résultat complet`);
  }
});

test("D-9 : effectif insuffisant → avertissement chiffré et production maximale avec les personnes données", () => {
  const p = (effectif: number) => calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif } });
  // T-shirt : EPA 0,5 ; MAN 1,2 ; COL 0,9 ; OUR 0,6 ; somme 3,2. Minutes utiles = 480 × 0,8 = 384.

  // --- 4 personnes : cadence idéale 3,2 ÷ 4 = 0,8.
  // À une opération par poste : EPA ⌈0,625⌉ = 1 ; MAN ⌈1,5⌉ = 2 ; COL ⌈1,125⌉ = 2 ; OUR ⌈0,75⌉ = 1 → 6 nécessaires, il en manque 2.
  const r4 = p(4);
  assert.equal(r4.effectifDonne, 4);
  assert.equal(r4.effectifNecessaire, 6);
  assert.equal(r4.effectifSuffisant, false);
  assert.equal(r4.personnesManquantes, 2);
  assert.ok(r4.avertissement !== null, "un avertissement est attendu");
  assert.ok(r4.avertissement.startsWith("Effectif insuffisant : 6 personnes nécessaires"), r4.avertissement);
  assert.ok(r4.avertissement.includes("4 données"), r4.avertissement);
  // Avec les 4 personnes, une par opération : goulot MAN à 1,2 min → 384 ÷ 1,2 = 320 pièces/jour au plus.
  assert.ok(r4.sortieEffectifDonne !== null);
  assert.equal(r4.sortieEffectifDonne.effectif, 4);
  assert.equal(r4.sortieEffectifDonne.goulot, "MAN");
  close(r4.sortieEffectifDonne.cadenceMin, 1.2);
  assert.ok(r4.productionMaximaleEffectifDonne !== null);
  close(r4.productionMaximaleEffectifDonne, 320);
  // On ne mélange plus les deux effectifs : `sortie` et `productionJournaliere` décrivent la chaîne à 6 personnes.
  // Temps par personne : EPA 0,5 ; MAN 0,6 ; COL 0,45 ; OUR 0,6 → goulot 0,6 → 384 ÷ 0,6 = 640.
  assert.equal(r4.sortie.effectif, 6);
  close(r4.productionJournaliere, 640);
  // Le plafond théorique (équilibre parfait) reste dans piecesVisees : 384 ÷ 0,8 = 480.
  close(r4.piecesVisees, 480);
  assert.ok(r4.productionMaximaleEffectifDonne < r4.piecesVisees);

  // --- 5 personnes : cadence 3,2 ÷ 5 = 0,64. EPA ⌈0,78⌉ = 1 ; MAN ⌈1,875⌉ = 2 ; COL ⌈1,41⌉ = 2 ; OUR ⌈0,94⌉ = 1 → 6, il en manque 1.
  // La 5e personne rejoint le poste le plus chargé (MAN : 1,2 → 0,6) ; le goulot devient COL à 0,9 → 384 ÷ 0,9 = 426,67.
  const r5 = p(5);
  assert.equal(r5.effectifSuffisant, false);
  assert.equal(r5.personnesManquantes, 1);
  assert.ok(r5.avertissement !== null && r5.avertissement.includes("Effectif insuffisant : 6 personnes nécessaires") && r5.avertissement.includes("5 données"), String(r5.avertissement));
  assert.ok(r5.sortieEffectifDonne !== null && r5.productionMaximaleEffectifDonne !== null);
  assert.equal(r5.sortieEffectifDonne.effectif, 5);
  assert.equal(r5.sortieEffectifDonne.goulot, "COL");
  assert.deepEqual(r5.sortieEffectifDonne.postes.map((x) => [x.code, x.personnes]), [["EPA", 1], ["MAN", 2], ["COL", 1], ["OUR", 1]]);
  close(r5.productionMaximaleEffectifDonne, 384 / 0.9);

  // --- 3 personnes pour 4 opérations : cadence 3,2 ÷ 3 = 1,0667. EPA 1 ; MAN ⌈1,125⌉ = 2 ; COL ⌈0,84⌉ = 1 ; OUR 1 → 5, il en manque 2.
  // Moins de personnes que d'opérations : pas de chiffre « une opération par poste », l'avertissement renvoie au regroupement.
  const r3 = p(3);
  assert.equal(r3.effectifNecessaire, 5);
  assert.equal(r3.effectifSuffisant, false);
  assert.equal(r3.personnesManquantes, 2);
  assert.equal(r3.sortieEffectifDonne, null);
  assert.equal(r3.productionMaximaleEffectifDonne, null);
  assert.ok(r3.avertissement !== null && r3.avertissement.includes("Effectif insuffisant : 5 personnes nécessaires"), String(r3.avertissement));
  assert.ok(r3.avertissement.includes("3 données") && r3.avertissement.includes("regroupées"), r3.avertissement);

  // --- 1 personne : cadence 3,2 ; une personne par opération → 4 nécessaires, il en manque 3. Accord au singulier.
  const r1 = p(1);
  assert.equal(r1.personnesManquantes, 3);
  assert.ok(r1.avertissement !== null && r1.avertissement.includes("4 personnes nécessaires") && r1.avertissement.includes("1 donnée"), String(r1.avertissement));
  assert.ok(!r1.avertissement.includes("1 données"), r1.avertissement);
});

test("D-9 : effectif suffisant → avertissement nul ; mode objectif de pièces → rien à signaler", () => {
  // A 1,0 min et B 0,5 min, 3 personnes : cadence 1,5 ÷ 3 = 0,5 ; A ⌈2⌉ = 2 ; B ⌈1⌉ = 1 → 3 nécessaires = 3 données.
  const ab = [op("A", "Assembler", 1.0), op("B", "Border", 0.5, ["A"])];
  const r = calculerChaine(ab, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif: 3 } });
  assert.equal(r.effectifDonne, 3);
  assert.equal(r.effectifNecessaire, 3);
  assert.equal(r.effectifSuffisant, true);
  assert.equal(r.personnesManquantes, 0);
  assert.equal(r.avertissement, null);
  // Avec les 3 personnes : A à 2 (0,5 min par personne), B à 1 (0,5) → 384 ÷ 0,5 = 768 pièces/jour = le plafond.
  assert.ok(r.sortieEffectifDonne !== null && r.productionMaximaleEffectifDonne !== null);
  assert.deepEqual(r.sortieEffectifDonne.postes.map((x) => [x.code, x.personnes]), [["A", 2], ["B", 1]]);
  close(r.productionMaximaleEffectifDonne, 768);
  close(r.productionJournaliere, 768);
  close(r.piecesVisees, 768);
  // Mode objectif de pièces : pas d'effectif donné, donc ni avertissement ni production « avec l'effectif donné ».
  const o = calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { piecesVisees: 640 } });
  assert.equal(o.effectifDonne, null);
  assert.equal(o.effectifSuffisant, true);
  assert.equal(o.personnesManquantes, 0);
  assert.equal(o.avertissement, null);
  assert.equal(o.sortieEffectifDonne, null);
  assert.equal(o.productionMaximaleEffectifDonne, null);
});

test("Effectif non entier, nul ou négatif refusé en français (4,5 ; 0 ; −1 ; NaN)", () => {
  for (const effectif of [4.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    erreur(() => calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif } }), "effectif", "nombre entier", "personnes");
    erreur(() => productionJournaliereTheorique(tshirt, effectif, 480, 0.8), "effectif", "nombre entier", "personnes");
    erreur(() => verifierEffectif(effectif), "effectif", "nombre entier");
    erreur(() => meilleureRepartitionPourEffectif(tshirt, effectif, { minutesParJour: 480, rendementAttendu: 0.8 }), "effectif", "nombre entier");
  }
  // Le message rappelle la valeur reçue.
  erreur(() => calculerChaine(tshirt, { minutesParJour: 480, rendementAttendu: 0.8, objectif: { effectif: 4.5 } }), "4.5");
  // Un entier ≥ 1 passe, y compris 1.
  verifierEffectif(1);
  close(productionJournaliereTheorique(tshirt, 1, 480, 0.8), 120); // 384 ÷ 3,2
});

test("personnesNecessaires : au moins 1 pour un temps > 0, jamais 0 ni −0", () => {
  // Avant correction : ⌈1e-12 ÷ 0,6 − 1e-9⌉ = ⌈−0,000000001⌉ = −0.
  for (const [temps, cadence] of [[1e-12, 0.6], [1e-9, 1], [1e-10, 480], [Number.MIN_VALUE, 1], [0.0001, 1000], [0.5, 0.6]]) {
    const x = personnesNecessaires(temps, cadence);
    assert.equal(x, 1, `personnesNecessaires(${temps}, ${cadence}) = ${x}`);
    assert.equal(Object.is(x, -0), false, `personnesNecessaires(${temps}, ${cadence}) rend −0`);
    assert.equal(Object.is(x, 0), false);
  }
  // Une opération minuscule dans une chaîne : une personne, capacité finie, pas de division par zéro.
  const r = calculerChaine([op("A", "Assembler", 1), op("B", "Couper un fil", 1e-12, ["A"])], { minutesParJour: 480, rendementAttendu: 0.8, objectif: { piecesVisees: 384 } });
  assert.deepEqual(r.operations.map((o) => o.personnes), [1, 1]);
  assert.ok(r.operations.every((o) => Number.isFinite(o.capaciteParHeure)));
  // Les arrondis exacts restent justes : 1,2 ÷ 0,6 = 2 ; 2,5 ÷ 1 → 3 ; 3 ÷ 1 = 3.
  assert.equal(personnesNecessaires(1.2, 0.6), 2);
  assert.equal(personnesNecessaires(2.5, 1), 3);
  assert.equal(personnesNecessaires(3, 1), 3);
  // Un temps nul ou négatif reste refusé.
  erreur(() => personnesNecessaires(0, 0.6), "strictement positif");
  erreur(() => personnesNecessaires(-1, 0.6), "strictement positif");
});

const jour = { minutesParJour: 480, rendementAttendu: 0.8 }; // 384 minutes utiles

test("« J'ai N personnes » avec moins de personnes que d'opérations : résultat chiffré, calculé à la main", () => {
  // T-shirt (4 opérations de chaîne), 3 personnes, règle « libre ».
  // Avec une personne par poste, toutes les façons de faire 3 postes en respectant EPA → {MAN, COL} → OUR :
  //   {EPA, COL} 1,4 | {MAN} 1,2 | {OUR} 0,6           → goulot 1,4   ← la meilleure
  //   {EPA} | {MAN} | {COL, OUR} 1,5                    → goulot 1,5
  //   {EPA} | {COL} | {MAN, OUR} 1,8                    → goulot 1,8
  //   {EPA, MAN} 1,7 | {COL} | {OUR}                    → goulot 1,7
  // Production = 384 ÷ 1,4 = 274,29 pièces/jour.
  const r = meilleureRepartitionPourEffectif(tshirt, 3, jour, { regroupement: "libre" });
  assert.equal(r.effectif, 3);
  assert.equal(r.motif, null);
  assert.equal(r.rechercheInterrompue, false);
  assert.ok(r.repartition !== null && r.productionJournaliere !== null);
  assert.ok(r.repartition.effectif <= 3, `effectif utilisé ${r.repartition.effectif} > 3`);
  assert.deepEqual(resume(r.repartition), [[["EPA", "COL"], 1], [["MAN"], 1], [["OUR"], 1]]);
  close(r.repartition.sortie.cadenceMin, 1.4);
  close(r.productionJournaliere, 384 / 1.4);
  // Rendue à sa cadence réelle : le goulot est chargé à 100 %.
  close(r.repartition.cadenceMin, 1.4);
  close(Math.max(...r.repartition.postes.map((x) => x.charge)), 1);
  assert.deepEqual(controlerRepartition(tshirt, postesDe(r.repartition), r.repartition.cadenceMin, { regroupement: "libre" }), []);
  // Le socle, lui, ne chiffre pas ce cas (3 personnes < 4 opérations) : c'est bien cette fonction qui donne le chiffre.
  assert.equal(calculerChaine(tshirt, { ...jour, objectif: { effectif: 3 } }).productionMaximaleEffectifDonne, null);

  // 2 personnes, « libre » : {EPA, MAN} 1,7 | {COL, OUR} 1,5 → 1,7 (les autres coupes : 1,8 ; 2,6 ; 2,7) → 384 ÷ 1,7 = 225,88.
  const r2 = meilleureRepartitionPourEffectif(tshirt, 2, jour, { regroupement: "libre" });
  assert.ok(r2.repartition !== null && r2.productionJournaliere !== null);
  assert.deepEqual(resume(r2.repartition), [[["EPA", "MAN"], 1], [["COL", "OUR"], 1]]);
  close(r2.productionJournaliere, 384 / 1.7);
  // 1 personne : tout sur un poste, 3,2 min → 384 ÷ 3,2 = 120.
  const r1 = meilleureRepartitionPourEffectif(tshirt, 1, jour, { regroupement: "libre" });
  assert.ok(r1.repartition !== null && r1.productionJournaliere !== null);
  assert.equal(r1.repartition.nombrePostes, 1);
  close(r1.productionJournaliere, 120);

  // 3 personnes, règle de l'atelier : seules EPA et MAN (surjeteuse, se suivent) peuvent partager un poste.
  //   {EPA, MAN} 1,7 | {COL} 0,9 | {OUR} 0,6 → 384 ÷ 1,7 = 225,88.
  const a3 = meilleureRepartitionPourEffectif(tshirt, 3, jour);
  assert.ok(a3.repartition !== null && a3.productionJournaliere !== null);
  assert.deepEqual(resume(a3.repartition), [[["EPA", "MAN"], 1], [["COL"], 1], [["OUR"], 1]]);
  close(a3.productionJournaliere, 384 / 1.7);
  assert.deepEqual(controlerRepartition(tshirt, postesDe(a3.repartition), a3.repartition.cadenceMin), []);

  // Polo, règle de l'atelier, 4 personnes pour 8 opérations : un poste par machine,
  //   {EPA, MAN, COT} 2,4 | {COL, SUR} 0,9 | {OUR} 0,6 | {BTN, PLI} 0,7 → 384 ÷ 2,4 = 160.
  const polo4 = meilleureRepartitionPourEffectif(polo, 4, jour);
  assert.ok(polo4.repartition !== null && polo4.productionJournaliere !== null);
  assert.deepEqual(resume(polo4.repartition), [[["EPA", "MAN", "COT"], 1], [["COL", "SUR"], 1], [["OUR"], 1], [["BTN", "PLI"], 1]]);
  close(polo4.productionJournaliere, 160);

  // Paramètres invalides refusés avant toute recherche.
  erreur(() => meilleureRepartitionPourEffectif(tshirt, 3, { minutesParJour: 0, rendementAttendu: 0.8 }), "minutes");
  erreur(() => meilleureRepartitionPourEffectif(tshirt, 3, { minutesParJour: 480, rendementAttendu: 1.2 }), "rendement");
  erreur(() => meilleureRepartitionPourEffectif([], 3, jour), "aucune opération");
});

test("« J'ai N personnes » sans solution : trois machines, 2 personnes, règle de l'atelier → null et motif en français", () => {
  // T-shirt : surjeteuse (EPA, MAN), piqueuse (COL), recouvreuse (OUR) → au moins 3 postes, donc 3 personnes.
  const r = meilleureRepartitionPourEffectif(tshirt, 2, jour);
  assert.equal(r.repartition, null);
  assert.equal(r.productionJournaliere, null);
  assert.equal(r.effectif, 2);
  assert.equal(r.effectifMinimumTrouve, 3);
  assert.ok(r.motif !== null, "un motif est attendu");
  assert.ok(r.motif.includes("Aucune répartition ne tient dans 2 personnes"), r.motif);
  assert.ok(r.motif.includes("3"), r.motif);
  assert.ok(r.motif.includes("même type de machine"), r.motif);
  // Singulier pour une personne.
  const r1 = meilleureRepartitionPourEffectif(tshirt, 1, jour);
  assert.equal(r1.repartition, null);
  assert.ok(r1.motif !== null && r1.motif.includes("dans 1 personne ") && !r1.motif.includes("1 personnes"), String(r1.motif));
  // Polo : 4 machines (surjeteuse, piqueuse, recouvreuse, manuel) → rien à 3 personnes.
  const p3 = meilleureRepartitionPourEffectif(polo, 3, jour);
  assert.equal(p3.repartition, null);
  assert.equal(p3.effectifMinimumTrouve, 4);
});

test("« J'ai N personnes » : production non décroissante avec N, sous le plafond théorique, et ≥ celle du socle", () => {
  const series: [string, Operation[], "machine_et_suite" | "libre", number][] = [
    ["t-shirt libre", tshirt, "libre", 12],
    ["t-shirt atelier", tshirt, "machine_et_suite", 12],
    ["polo libre", polo, "libre", 16],
    ["polo atelier", polo, "machine_et_suite", 16],
    ["Jackson libre", operationsCas(JACKSON), "libre", 14],
  ];
  for (const [nom, ops, regroupement, max] of series) {
    let precedente = 0;
    for (let effectif = 1; effectif <= max; effectif += 1) {
      const r = meilleureRepartitionPourEffectif(ops, effectif, jour, { regroupement });
      assert.equal(r.rechercheInterrompue, false, `${nom}, N=${effectif} : recherche interrompue`);
      if (r.repartition === null) {
        assert.equal(precedente, 0, `${nom}, N=${effectif} : plus de solution alors qu'il y en avait une avec moins de personnes`);
        assert.ok(r.motif !== null && r.productionJournaliere === null);
        assert.ok(regroupement === "machine_et_suite", `${nom}, N=${effectif} : en « libre », tout tient toujours sur un poste`);
        continue;
      }
      assert.ok(r.productionJournaliere !== null && r.motif === null);
      assert.ok(r.repartition.effectif <= effectif, `${nom}, N=${effectif} : ${r.repartition.effectif} personnes utilisées`);
      verifierProprietes(ops, r.repartition, r.repartition.cadenceMin);
      assert.deepEqual(controlerRepartition(ops, postesDe(r.repartition), r.repartition.cadenceMin, { regroupement }), [], `${nom}, N=${effectif} : contrôle`);
      // Production = minutes utiles ÷ cadence réelle (goulot).
      close(r.productionJournaliere, 384 / r.repartition.sortie.cadenceMin);
      assert.ok(r.productionJournaliere >= precedente - 1e-6, `${nom} : production en baisse de N=${effectif - 1} (${precedente}) à N=${effectif} (${r.productionJournaliere})`);
      // Jamais au-dessus du plafond théorique (équilibre parfait) : N × 384 ÷ somme des temps.
      assert.ok(r.productionJournaliere <= productionJournaliereTheorique(ops, effectif, 480, 0.8) + 1e-6, `${nom}, N=${effectif} : au-dessus du plafond`);
      // Au moins aussi bien que le socle (une opération par poste), quand le socle donne un chiffre.
      const socle = calculerChaine(ops, { ...jour, objectif: { effectif } }).productionMaximaleEffectifDonne;
      if (socle !== null) {
        assert.ok(r.productionJournaliere >= socle - 1e-6, `${nom}, N=${effectif} : ${r.productionJournaliere} < socle ${socle}`);
      }
      precedente = r.productionJournaliere;
    }
    assert.ok(precedente > 0, `${nom} : aucune solution trouvée`);
  }
  // Valeurs du t-shirt calculées à la main (384 minutes utiles), identiques pour les deux règles à partir de 4 personnes :
  //   N=4 : une personne par opération, goulot MAN 1,2 → 320 (= socle).
  //   N=5 : MAN à 2 (0,6), goulot COL 0,9 → 426,67 (= socle).
  //   N=6 : COL à 2 (0,45), goulot MAN et OUR 0,6 → 640.
  //   N=7 : pour passer sous 0,6 il faut MAN à 3 et OUR à 2, soit 8 personnes → on reste à 640.
  //   N=8 : EPA 1 (0,5), MAN 3 (0,4), COL 2 (0,45), OUR 2 (0,3) → goulot 0,5 → 768.
  const attendues: [number, number][] = [[4, 320], [5, 384 / 0.9], [6, 640], [7, 640], [8, 768]];
  for (const regroupement of ["libre", "machine_et_suite"] as const) {
    for (const [effectif, production] of attendues) {
      const r = meilleureRepartitionPourEffectif(tshirt, effectif, jour, { regroupement });
      assert.ok(r.productionJournaliere !== null);
      close(r.productionJournaliere, production);
    }
  }
  close(calculerChaine(tshirt, { ...jour, objectif: { effectif: 4 } }).productionMaximaleEffectifDonne!, 320);
  close(calculerChaine(tshirt, { ...jour, objectif: { effectif: 5 } }).productionMaximaleEffectifDonne!, 384 / 0.9);
});

test("« J'ai N personnes » : déterministe, y compris liste inversée", () => {
  for (const [ops, effectif, regroupement] of [[tshirt, 3, "libre"], [polo, 6, "machine_et_suite"], [polo, 5, "libre"], [operationsCas(JAESCHKE), 4, "libre"]] as const) {
    const premiere = meilleureRepartitionPourEffectif([...ops], effectif, jour, { regroupement });
    assert.deepEqual(meilleureRepartitionPourEffectif([...ops], effectif, jour, { regroupement }), premiere);
    const retournee = meilleureRepartitionPourEffectif(inverse([...ops]), effectif, jour, { regroupement });
    assert.ok(premiere.repartition !== null && retournee.repartition !== null);
    assert.deepEqual(postesDe(retournee.repartition), postesDe(premiere.repartition), "mêmes postes, liste inversée");
    assert.equal(retournee.productionJournaliere, premiere.productionJournaliere, "même production, liste inversée");
  }
});

test("Limites : liste vide, une seule opération, cadence invalide, opération plus longue que la cadence", () => {
  // Liste vide, ou seulement des opérations communes : rien à répartir, erreur claire.
  erreur(() => repartirOperations([], 1), "aucune opération");
  erreur(() => repartirOperations([op("ETQ", "Poser les étiquettes", 0.2, [], { commune: true })], 1), "aucune opération");
  // Cadence nulle, négative ou non finie.
  for (const cadence of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    erreur(() => repartirOperations(tshirt, cadence), "cadence", "strictement positif");
  }
  // Données invalides : même refus que le socle.
  erreur(() => repartirOperations([op("A", "Épaules", 0.5, ["B"]), op("B", "Col", 0.9, ["A"])], 1), "Boucle de précédences");

  // Une seule opération de 0,5 min, cadence 1 : un poste, une personne, chargée à 50 %, équilibre 0,5 ÷ (1 × 0,5) = 1.
  const seule = [op("A", "Assembler", 0.5)];
  const r1 = repartirOperations(seule, 1);
  assert.deepEqual(postesDe(r1), [{ code: "P1", personnes: 1, operations: ["A"] }]);
  close(r1.postes[0].charge, 0.5);
  assert.equal(r1.postes[0].parallele, false);
  close(r1.sortie.tauxEquilibre, 1);
  assert.deepEqual(controlerRepartition(seule, postesDe(r1), 1), []);
  // Temps exactement égal à la cadence : une personne, pas de parallèle.
  assert.deepEqual(resume(repartirOperations(seule, 0.5)), [[["A"], 1]]);

  // Opération plus longue que la cadence : 2,5 min pour une cadence de 1 → ⌈2,5⌉ = 3 personnes, seule sur son poste,
  // même si l'opération suivante (0,2 min, même machine, juste après) aurait de la place : 2,5 ÷ 3 + 0,2 < 1.
  const longue = [op("A", "Assembler", 2.5), op("B", "Border", 0.2, ["A"])];
  for (const regroupement of ["machine_et_suite", "libre"] as const) {
    const r = repartirOperations(longue, 1, { regroupement });
    assert.deepEqual(resume(r), [[["A"], 3], [["B"], 1]], regroupement);
    assert.equal(r.postes[0].parallele, true);
    close(r.postes[0].tempsMin, 2.5);
    close(r.postes[0].tempsParPersonneMin, 2.5 / 3);
    close(r.postes[0].charge, 2.5 / 3);
    assert.equal(r.effectif, 4);
    assert.equal(r.sortie.goulot, "P1");
    assert.deepEqual(controlerRepartition(longue, postesDe(r), 1, { regroupement }), []);
  }
  // Avec une personne de moins sur l'opération longue, le contrôle refuse : 2,5 ÷ 2 = 1,25 > 1.
  refuse(
    controlerRepartition(longue, [{ code: "P1", personnes: 2, operations: ["A"] }, { code: "P2", personnes: 1, operations: ["B"] }], 1),
    "P1", "dépasse la cadence", "1,25",
  );
  // Rapport entier : 1,2 ÷ 0,6 = 2 personnes exactement (pas 3 malgré 2,0000000000000004) ; 3 ÷ 1 = 3.
  assert.deepEqual(resume(repartirOperations([op("A", "Assembler", 1.2)], 0.6)), [[["A"], 2]]);
  assert.deepEqual(resume(repartirOperations([op("A", "Assembler", 3)], 1)), [[["A"], 3]]);
  // À peine au-dessus de la cadence : une personne ne suffit pas, il en faut 2.
  assert.deepEqual(resume(repartirOperations([op("A", "Assembler", 1.001)], 1)), [[["A"], 2]]);
  // Opération longue en tête de liste et opération sans lien, en « libre » : rien ne rejoint le poste parallélisé.
  const sansLien = [op("A", "Assembler", 2.5), op("B", "Border", 0.2)];
  assert.deepEqual(resume(repartirOperations(sansLien, 1, { regroupement: "libre" })), [[["A"], 3], [["B"], 1]]);

  // Polo à cadence très courte (0,25) : chaque opération dépasse ou égale presque la cadence.
  //   EPA ⌈2⌉ = 2 ; MAN ⌈1,6⌉ = 2 ; COT ⌈6⌉ = 6 ; COL ⌈2,8⌉ = 3 ; SUR 0,2 → 1 ; OUR ⌈2,4⌉ = 3 ; BTN ⌈1,2⌉ = 2 ; PLI ⌈1,6⌉ = 2 → 21 personnes.
  const court = repartirOperations(polo, 0.25);
  assert.equal(court.nombrePostes, 8);
  assert.equal(court.effectif, 21);
  assert.deepEqual(court.postes.map((p) => [p.operations[0], p.personnes]), [["EPA", 2], ["MAN", 2], ["COT", 6], ["COL", 3], ["SUR", 1], ["OUR", 3], ["BTN", 2], ["PLI", 2]]);
  verifierProprietes(polo, court, 0.25);
  assert.deepEqual(controlerRepartition(polo, postesDe(court), 0.25), []);
  // Cadence très longue : la règle de l'atelier garde un poste par machine (4), la règle libre met tout sur un poste.
  assert.equal(repartirOperations(polo, 1000).nombrePostes, 4);
  assert.equal(repartirOperations(polo, 1000, { regroupement: "libre" }).nombrePostes, 1);
});

console.log(`\n${n} tests réussis${echecs.length > 0 ? `, ${echecs.length} en échec :\n${echecs.map((e) => `  ✗ ${e}`).join("\n")}` : "."}`);
