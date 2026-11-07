/**
 * Banc de test des imports du personnel (src/lib/personnel, migrations 0157/0159).
 *
 * Vérifie : CSV, montants et dates à la française, matricules Excel (zéros de
 * tête), liste du personnel (matricule connu sauté, nom différent signalé,
 * atelier → section / structure / à classer), livre de paie Sage (encodage
 * cassé, format long, rubriques à classer, employés à zéro, matricule payé
 * inconnu), comparatif avec le livre précédent (identique, quasi identique,
 * variation) et présence. Données FICTIVES uniquement.
 *
 * Lancer : npm run test:personnel
 */
import assert from "node:assert/strict";
import { controlerFiches, controlerPresence, lireCsv, lireDate, lireMatricule, lireMontant, normaliser, type ContexteImport } from "../src/lib/personnel/import";
import JSZip from "jszip";
import { ecrireListe, lireClasseur } from "../src/lib/personnel/xlsx";
import { agregerParEmploye, comparerLivres, controlerLivre, controlerTotaux, decoderLivre, empreinteLivre, lireLivre, type MappingRubriques, type PaieEmploye } from "../src/lib/personnel/livre-paie";

const ctx: ContexteImport = {
  employes: new Map([
    [normaliser("0001"), { id: "e1", confidentiel: false, nomComplet: "AWA KONE" }],
    [normaliser("0002"), { id: "e2", confidentiel: false, nomComplet: "KOFFI YAO" }],
    [normaliser("D001"), { id: "e3", confidentiel: true, nomComplet: "DG" }],
  ]),
  ateliers: new Map([
    [normaliser("bonneterie"), { atelier: "bonneterie", sectionId: "s-bonn", structure: false }],
    [normaliser("Bureau"), { atelier: "bureau", sectionId: null, structure: true }],
    [normaliser("polo"), { atelier: "polo", sectionId: null, structure: false }],
  ]),
};

// CSV, montants, dates, matricules
assert.deepEqual(lireCsv("﻿a;b\r\n1;\"x;y\"\r\n"), [["a", "b"], ["1", "x;y"]]);
assert.equal(lireMontant("250 000"), 250000);
assert.equal(lireMontant("250.000,50"), 250000.5);
assert.equal(lireMontant("         0,00"), 0);
assert.equal(lireMontant("-10 000,00"), -10000);
assert.equal(lireMontant(""), null);
assert.ok(Number.isNaN(lireMontant("abc")));
assert.equal(lireDate("30/11/2026"), "2026-11-30");
assert.equal(lireDate("2026-02-30"), undefined);
assert.equal(lireMatricule("5"), "0005");
assert.equal(lireMatricule("5.0"), "0005");
assert.equal(lireMatricule("0005"), "0005");
assert.equal(lireMatricule("D001"), "D001");
assert.equal(lireMatricule("12345"), "12345");

// Liste du personnel
const liste = controlerFiches(
  [
    ["Matricule", "Nom", "Prénom", "Atelier", "Fonction", "Type de contrat", "Statut"],
    ["0001", "AWA", "KONE", "bonneterie", "Tricoteuse", "CDI", "actif"], // connu, même nom -> sauté
    ["0002", "AUTRE", "NOM", "bonneterie", "", "", ""], // connu, nom différent -> sauté + alerte
    ["0003", "BAMBA", "MOUSSA", "Bonneterie", "Tricoteur", "CDD", ""], // nouveau, section
    ["0004", "TRAORE", "ALI", "bureau", "", "", ""], // nouveau, structure
    ["0005", "SANGO", "HATO", "polo", "", "", ""], // nouveau, atelier sans section -> à classer
    ["0006", "NEUF", "ATELIER", "teinture", "", "", ""], // atelier inconnu
    ["0007", "", "X", "", "", "", ""], // nom manquant
    ["0008", "CONTRAT", "BAD", "", "", "CDX", ""],
    ["0003", "DOUBLON", "", "", "", "", ""],
  ],
  ctx
);
assert.equal(liste.erreurFichier, undefined);
const L = liste.lignes;
assert.equal(L[0].action, "ignorer");
assert.equal(L[1].action, "ignorer");
assert.ok(L[1].avertissements[0].includes("autre nom"));
assert.equal(L[2].action, "creer");
assert.deepEqual(L[2].erreurs, []);
assert.deepEqual((L[2].donnees.sections as { section_id: string }[]).map((s) => s.section_id), ["s-bonn"]);
assert.equal(L[2].donnees.type_contrat, "CDD");
assert.equal(L[3].donnees.type_emploi, "structure");
assert.equal((L[3].donnees.sections as unknown[]).length, 0);
assert.ok(L[4].avertissements[0].includes("à classer"));
assert.ok(L[5].avertissements[0].includes("inconnu"));
assert.ok(L[6].erreurs.some((e) => e.includes("Nom manquant")));
assert.ok(L[7].erreurs.some((e) => e.includes("contrat")));
assert.ok(L[8].erreurs.some((e) => e.includes("deux fois")));
assert.match(controlerFiches([["nom"], ["A"]], ctx).erreurFichier ?? "", /matricule/);

// Liste de salariés Sage avec colonne « Etat » : E et C importés, M (parti) ignoré
const sage = controlerFiches(
  [
    ["Matricule", "Civilité", "Nom", "Prénom", "Paie", "Clôture", "Etat"],
    ["0020", "M", "ACTIF", "UN", "31/10/2026", "30/09/2026", "E"],
    ["0021", "Mme", "CONGE", "DEUX", "31/10/2026", "30/09/2026", "C"],
    ["0022", "M", "PARTI", "TROIS", "31/10/2026", "30/11/2017", "M"],
    ["0023", "M", "", "", "31/10/2026", "30/11/2017", "M"], // ancien sans nom : ignoré sans erreur
    ["0024", "M", "BIZARRE", "QUATRE", "31/10/2026", "", "X"],
  ],
  ctx
);
assert.equal(sage.erreurFichier, undefined);
assert.deepEqual(sage.lignes.map((l) => l.action), ["creer", "creer", "ignorer", "ignorer", "creer"]);
assert.equal(sage.lignes[1].donnees.statut, "actif", "C = actif en congés");
assert.deepEqual(sage.lignes[2].erreurs.concat(sage.lignes[3].erreurs), [], "les anciens ne produisent aucune erreur");
assert.ok(sage.lignes[2].avertissements[0].includes("Ancien salarié"));
assert.ok(sage.lignes[4].erreurs[0].includes("État inconnu"));

// Décodage de l'export Sage (é = 0x80, à = 0x85, û = 0x96)
assert.equal(decoderLivre(Uint8Array.of(0x50, 0x72, 0x80, 0x73)), "Prés");
assert.equal(decoderLivre(Uint8Array.of(0x4e, 0x65, 0x74, 0x20, 0x85)), "Net à");
assert.equal(decoderLivre(new TextEncoder().encode("Prénom")), "Prénom");

// Livre de paie (format long, données fictives)
const mapping: MappingRubriques = new Map([
  ["100", "salaire_base"], ["10", "salaire_base"], ["130", "prime"], ["800", "prime"], ["160", "heures_sup"],
  ["1990", "indemnite"], ["COTIPAT", "charges_patronales"], ["BRUT", "controle"], ["COUT_TOTAL", "controle"],
  ["TOTALHS", "volume"], ["10010", "volume"], ["620", "retenue"], ["9999", null],
]);
const ligne = (m: string, nom: string, code: string, mt: string) => `="${m}";="${nom}";="PRENOM";="${code.padStart(12)}";="Libell€";"${mt.padStart(14)}";`;
const livre = [
  '="Matricule";="Nom";="Prénom";="Code Rubrique";="Intitulé Rubrique";="Montant salarial";',
  ligne("0001", "KONE", "100", "100 000,00"), ligne("0001", "KONE", "130", "10 000,00"), ligne("0001", "KONE", "800", "26 000,00"),
  ligne("0001", "KONE", "160", "5 000,00"), ligne("0001", "KONE", "1990", "20 000,00"), ligne("0001", "KONE", "COTIPAT", "30 000,00"),
  ligne("0001", "KONE", "BRUT", "115 000,00"), ligne("0001", "KONE", "COUT_TOTAL", "200 000,00"), ligne("0001", "KONE", "TOTALHS", "8"),
  ligne("0001", "KONE", "10010", "150"), ligne("0001", "KONE", "620", "-7 000,00"),
  ligne("0002", "YAO", "10", "80 000,00"), ligne("0002", "YAO", "BRUT", "80 000,00"), ligne("0002", "YAO", "COUT_TOTAL", "100 000,00"),
  ligne("0003", "ANCIEN", "BRUT", "0,00"), ligne("0003", "ANCIEN", "100", "0,00"), // à zéro : ancien salarié
  ligne("0777", "INCONNU", "100", "50 000,00"), // payé mais sans fiche
  ligne("D001", "DG", "100", "900 000,00"), // confidentiel
].join("\r\n");

const lu = lireLivre(livre);
assert.equal(lu.erreur, undefined);
assert.equal(lu.lignes[0].matricule, "0001");
assert.equal(lu.lignes[0].code, "100");
assert.equal(lu.lignes[0].montant, 100000);
const agr = agregerParEmploye(lu.lignes, mapping);
const kone = agr.employes.find((e) => e.matricule === "0001")!;
assert.equal(kone.salaire_base, 100000);
assert.equal(kone.primes, 36000, "transport = prime");
assert.equal(kone.heures_sup, 5000);
assert.equal(kone.indemnites, 20000);
assert.equal(kone.charges_patronales, 30000);
assert.equal(kone.cout_total_sage, 200000);
assert.equal(kone.cout_mois, 200000, "le coût total Sage fait foi");
assert.equal(kone.ecart_sage, 200000 - (100000 + 36000 + 5000 + 20000 + 30000), "écart visible");
assert.equal(kone.heures_sup_nb, 8);
assert.equal(kone.heures_travaillees, 150);
assert.equal(kone.type_salaire, "horaire");
assert.equal(kone.detail["620"], -7000, "retenue gardée dans le détail, hors coût");
assert.equal(agr.employes.find((e) => e.matricule === "0002")!.type_salaire, "mensuel");
assert.equal(agr.employes.find((e) => e.matricule === "0003")!.paye, false);

const controle = controlerLivre(livre, "2026-10-01", ctx, mapping);
assert.equal(controle.erreurFichier, undefined);
assert.equal(controle.nbInactifs, 1);
assert.equal(controle.lignes.length, 4);
assert.ok(controle.lignes.find((l) => l.matricule === "0777")!.erreurs[0].includes("inconnu"));
assert.equal(controle.lignes.find((l) => l.matricule === "D001")!.action, "ignorer");
assert.equal(controle.lignes.find((l) => l.matricule === "0001")!.erreurs.length, 0);
assert.equal(controle.lignes.find((l) => l.matricule === "0001")!.avertissements.length, 0, "écart de 7,5 % : pas signalé ligne à ligne");
assert.match(controlerLivre(livre, "2026-10", ctx, mapping).erreurFichier ?? "", /mois/);
assert.match(controlerLivre("a;b\n1;2", "2026-10-01", ctx, mapping).erreurFichier ?? "", /livre de paie/);

// Ligne « Total » : pas un employé, et contrôle d'intégrité du fichier
const sansTotal = livre.replace(/\r\n$/, "");
const totalCoherent = sansTotal + "\r\n" + ligne("Total", "", "COUT_TOTAL", "300 000,00");
assert.deepEqual(controlerTotaux(lireLivre(totalCoherent).lignes), [], "total = somme des employés");
const avecTotal = controlerLivre(totalCoherent, "2026-10-01", ctx, mapping);
assert.equal(avecTotal.erreurFichier, undefined);
assert.equal(avecTotal.lignes.some((l) => l.matricule === "Total"), false, "« Total » n'est pas un employé");
const totalFaux = sansTotal + "\r\n" + ligne("Total", "", "COUT_TOTAL", "299 000,00");
assert.equal(controlerTotaux(lireLivre(totalFaux).lignes)[0].code, "COUT_TOTAL");
assert.match(controlerLivre(totalFaux, "2026-10-01", ctx, mapping).erreurFichier ?? "", /Total/);

// Rubrique nouvelle : à classer, jamais ignorée en silence
const avecNouvelle = livre + "\r\n" + ligne("0002", "YAO", "7777", "1 000,00");
assert.deepEqual(controlerLivre(avecNouvelle, "2026-10-01", ctx, mapping).inconnues, ["7777"]);
const classee = new Map(mapping).set("9999", null);
assert.deepEqual(controlerLivre(livre + "\r\n" + ligne("0002", "YAO", "9999", "5,00"), "2026-10-01", ctx, classee).inconnues, ["9999"]);

// Empreinte : stable, sensible au moindre montant
assert.equal(empreinteLivre(lu.lignes), empreinteLivre(lireLivre(livre).lignes));
assert.notEqual(empreinteLivre(lu.lignes), empreinteLivre(lireLivre(livre.replace("5 000,00", "5 001,00")).lignes));

// Comparatif
const employe = (m: string, cout: number): PaieEmploye => ({ ...kone, matricule: m, nom: "N" + m, prenom: "", cout_mois: cout, paye: true, detail: {} });
const trente = (f: (i: number) => number) => Array.from({ length: 30 }, (_, i) => employe(String(1000 + i), f(i)));
const prec = (cs: PaieEmploye[]) => ({ mois: "2026-09-01", lignes: cs.map((e) => ({ matricule: e.matricule, cout_mois: e.cout_mois })) });
const septembre = trente((i) => 100000 + i * 1000);

const identique = comparerLivres(septembre, prec(septembre), null, "2026-10-01");
assert.equal(identique.identiques_pct, 100);
assert.ok(identique.alertes.some((a) => a.gravite === "critique" && a.titre.includes("quasi identique")));

const importIdentique = comparerLivres(septembre, null, { id: "i1", mois: "2026-09-01" }, "2026-10-01");
assert.ok(importIdentique.alertes.some((a) => a.titre.includes("identique à un livre déjà importé")));

const normal = comparerLivres(trente((i) => 100000 + i * 1000 + 7 * (i + 1)), prec(septembre), null, "2026-10-01");
assert.equal(normal.alertes.length, 0, "un livre normal ne lève aucune alerte");
assert.equal(normal.identiques_pct, 0);

const hausse = comparerLivres(trente((i) => (100000 + i * 1000) * 1.4), prec(septembre), null, "2026-10-01");
assert.ok(hausse.alertes.some((a) => a.titre.includes("variation")));
assert.equal(hausse.gros_ecarts.length > 0, true);

const avecChangement = comparerLivres([...trente((i) => 100000 + i * 1000 + 5 * (i + 1)).slice(1), employe("9999", 50000)], prec(septembre), null, "2026-10-01");
assert.deepEqual(avecChangement.nouveaux, ["9999"]);
assert.deepEqual(avecChangement.disparus, ["1000"]);
assert.equal(comparerLivres(septembre, null, null, "2026-10-01").total_precedent, null, "premier livre : rien à comparer");

// Présence
const presence = controlerPresence(
  ["matricule;jour;statut;heures", "1;2026-10-01;present;8", "0001;2026-10-01;present;8", "0001;2026-10-02;vacances;8", "0001;2026-10-03;present;30", "D001;2026-10-03;present;8"].join("\n"),
  ctx
);
assert.deepEqual(presence.lignes[0].erreurs, [], "« 1 » = « 0001 »");
assert.ok(presence.lignes[1].erreurs.some((e) => e.includes("deux fois")));
assert.ok(presence.lignes[2].erreurs.some((e) => e.includes("inconnu")));
assert.ok(presence.lignes[3].erreurs.some((e) => e.includes("Heures")));
assert.equal(presence.lignes[4].action, "ignorer");

// Classeurs Excel : export Sage non standard (espace de noms « x: », texte en ligne) et classeur standard
async function classeurs() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const t = (v: string) => `<x:c t="str"><x:v>${v}</x:v></x:c>`;
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>` +
      `<x:row>${t("Matricule")}${t("Nom")}${t("Prénom")}</x:row>` +
      `<x:row>${t("0011")}${t("KONE &amp; FILS")}${t("")}</x:row>` +
      `<x:row><x:c r="A3" t="str"><x:v>0012</x:v></x:c><x:c r="C3" t="str"><x:v>AWA</x:v></x:c></x:row>` +
      `</x:sheetData></x:worksheet>`
  );
  const octets = await zip.generateAsync({ type: "arraybuffer" });
  const sage = await lireClasseur(octets);
  assert.deepEqual(sage, [["Matricule", "Nom", "Prénom"], ["0011", "KONE & FILS", ""], ["0012", "", "AWA"]], "classeur Sage non standard lu par le lecteur de secours");
  const liste = controlerFiches(sage, ctx);
  assert.equal(liste.erreurFichier, undefined);
  assert.equal(liste.lignes[0].matricule, "0011");

  const standard = await ecrireListe([{ matricule: "0005", nom: "SANGO", prenom: "HATO", atelier: "polo", fonction: "Couturier", type_contrat: "CDI", statut: "actif" }]);
  const relu = await lireClasseur(standard.buffer.slice(standard.byteOffset, standard.byteOffset + standard.byteLength) as ArrayBuffer);
  assert.deepEqual(relu[1], ["0005", "SANGO", "HATO", "polo", "Couturier", "CDI", "actif"], "aller-retour du classeur standard, zéros de tête conservés");
  await assert.rejects(() => lireClasseur(new TextEncoder().encode("pas un classeur").buffer as ArrayBuffer), "un fichier qui n'est pas un classeur lève une erreur");
}

classeurs().then(
  () => console.log("test-personnel-import : OK"),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
