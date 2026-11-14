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
  type Operation,
} from "../src/lib/confection/equilibrage";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
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

console.log(`\n${n} tests réussis.`);
