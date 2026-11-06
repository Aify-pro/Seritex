/**
 * Banc de test de la lecture des fichiers d'import du personnel
 * (src/lib/personnel/import.ts, migration 0157).
 *
 * Vérifie : CSV (« ; », « , », BOM, guillemets), montants et dates à la
 * française, fiches (création / mise à jour, sections et répartition en %,
 * employé confidentiel sans montant), paie (un mois par fichier, matricule
 * inconnu, confidentiel ignoré) et présence (statut, heures, doublons).
 *
 * Lancer : npm run test:personnel
 */
import assert from "node:assert/strict";
import { controlerFichier, lireCsv, lireDate, lireMontant, normaliser, type ContexteImport } from "../src/lib/personnel/import";

const ctx: ContexteImport = {
  employes: new Map([
    [normaliser("M001"), { id: "e1", confidentiel: false }],
    [normaliser("D001"), { id: "e2", confidentiel: true }],
  ]),
  sections: new Map([
    [normaliser("Coupe"), { id: "s-coupe", nom: "Coupe" }],
    [normaliser("Finition"), { id: "s-fin", nom: "Finition" }],
  ]),
};

// CSV
assert.deepEqual(lireCsv("﻿a;b\r\n1;\"x;y\"\r\n"), [["a", "b"], ["1", "x;y"]]);
assert.deepEqual(lireCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);

// Montants et dates
assert.equal(lireMontant("250 000"), 250000);
assert.equal(lireMontant("250.000,50"), 250000.5);
assert.equal(lireMontant("250000.50"), 250000.5);
assert.equal(lireMontant(""), null);
assert.ok(Number.isNaN(lireMontant("abc")));
assert.equal(lireDate("30/11/2026"), "2026-11-30");
assert.equal(lireDate("2026-02-30"), undefined);
assert.equal(lireDate(""), null);

// Fiches
const fiches2 = controlerFichier(
  "fiches",
  [
    "matricule;nom;fonction;type;section;salaire_base;primes_fixes;avantages;charges_patronales;date_entree;date_sortie;statut;confidentiel",
    "M001;Awa;Couturière;production_directe;Coupe:60|Finition:40;100 000;5 000;;20 000;01/03/2020;;actif;non",
    "M002;Koffi;Coupeur;;Coupe;90000;;;;2021-05-01;;;",
    "D001;Direction;DG;structure;;500000;;;;;;actif;oui",
    "M003;Faux;;;Inconnue;;;;;;;;",
    "M004;Mal;;;Coupe:70|Finition:20;;;;;;;;",
    "M002;Doublon;;;;;;;;;;;",
  ].join("\n"),
  ctx
);
assert.equal(fiches2.erreurFichier, undefined);
const [l1, l2, l3, l4, l5, l6] = fiches2.lignes;
assert.equal(l1.action, "modifier");
assert.deepEqual(l1.erreurs, []);
assert.equal((l1.donnees.sections as unknown[]).length, 2);
assert.equal(l1.donnees.salaire_base, 100000);
assert.equal(l2.action, "creer");
assert.equal(l2.donnees.type_emploi, "production_directe", "type vide = production directe");
assert.equal(l3.donnees.salaire_base, null, "confidentiel : aucun montant");
assert.equal(l3.avertissements.length, 1);
assert.ok(l4.erreurs.some((e) => e.includes("Section inconnue")));
assert.ok(l5.erreurs.some((e) => e.includes("100 %")));
assert.ok(l6.erreurs.some((e) => e.includes("deux fois")));

// Colonnes obligatoires
assert.match(controlerFichier("fiches", "nom;fonction\nA;B", ctx).erreurFichier ?? "", /matricule/);
assert.match(controlerFichier("paie", "matricule\nM001", ctx).erreurFichier ?? "", /mois/);
assert.match(controlerFichier("fiches", "matricule;nom", ctx).erreurFichier ?? "", /vide/);

// Paie
const paie = controlerFichier(
  "paie",
  ["matricule;mois;salaire_base;primes;heures_sup;avantages;charges_patronales", "M001;2026-10;100000;5000;2000;;20000", "D001;2026-10;1;;;;", "X999;2026-10;1;;;;", "M001;2026-11;1;;;;"].join("\n"),
  ctx
);
assert.equal(paie.lignes[0].erreurs.length, 0);
assert.equal(paie.lignes[0].donnees.mois, "2026-10-01");
assert.equal(paie.lignes[1].action, "ignorer", "confidentiel ignoré");
assert.ok(paie.lignes[2].erreurs.some((e) => e.includes("inconnu")));
assert.ok(paie.lignes[3].erreurs.some((e) => e.includes("Plusieurs mois")));

// Présence
const presence = controlerFichier(
  "presence",
  ["matricule;jour;statut;heures", "M001;2026-10-01;present;8", "M001;2026-10-01;present;8", "M001;2026-10-02;vacances;8", "M001;2026-10-03;present;30"].join("\n"),
  ctx
);
assert.equal(presence.lignes[0].erreurs.length, 0);
assert.ok(presence.lignes[1].erreurs.some((e) => e.includes("deux fois")));
assert.ok(presence.lignes[2].erreurs.some((e) => e.includes("inconnu")));
assert.ok(presence.lignes[3].erreurs.some((e) => e.includes("Heures")));

console.log("test-personnel-import : OK");
