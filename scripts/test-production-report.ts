/**
 * Banc de test du rapport de production (src/lib/production-report.ts).
 *
 * Vérifie que :
 *  1. par taille, écart = 1er + 2e choix − demandé (manquant ou en plus) ;
 *  2. le tissu net = réception − retour au stock, et le kg par pièce sortie ;
 *  3. sans devis : valeur du tissu et des déchets seulement, signalé ;
 *  4. avec devis : prix de revient réel calculé comme l'onglet Coûts ;
 *  5. la durée écoulée se lit en minutes, heures, jours.
 *
 * Lancer : npm run test:rapport
 */
import assert from "node:assert/strict";
import { buildReportValeur, buildReportView, formatDuree, type ReportContenu } from "../src/lib/production-report";

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n += 1;
  console.log(`✓ ${name}`);
}
const close = (a: number | null | undefined, b: number, eps = 0.01) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const contenu: ReportContenu = {
  bilan: {
    en_cours: 0,
    lignes: [
      {
        line_id: "l1",
        description: "T-shirt blanc",
        quantite: 100,
        en_cours: 0,
        tailles: [
          { taille: "Homme/M", demande: 60, premier_choix: 55, deuxieme_choix: 2, dechets: 3, en_cours: 0, surplus: 0 },
          { taille: "Homme/L", demande: 40, premier_choix: 42, deuxieme_choix: 0, dechets: 1, en_cours: 0, surplus: 2 },
        ],
      },
    ],
  },
  sections: [],
  tissu: { kg_reception: "14.5", kg_retour_stock: "2", kg_sortie_lots: 0, kg_dechets: "0.8", matelas_clotures: 1 },
  consommables: [{ code: "COBO0001", designation: "Bouton", unite: "piece", theorique: "396", reel: "400", motif: "casse" }],
};

test("écarts par taille : M manque 3, L a 2 en plus", () => {
  const v = buildReportView(contenu);
  assert.deepEqual(v.lignes[0].tailles.map((t) => [t.sorties, t.ecart]), [[57, -3], [42, 2]]);
  assert.deepEqual([v.totaux.manquants, v.totaux.en_plus, v.totaux.sorties, v.totaux.dechets, v.totaux.surplus], [3, 2, 99, 4, 2]);
});

test("tissu net 12,5 kg, soit 0,126 kg par pièce sortie ; consommable +4", () => {
  const v = buildReportView(contenu);
  close(v.tissu.kgNet, 12.5);
  close(v.tissu.kgParPiece, 12.5 / 99, 0.0001);
  assert.equal(v.consommables[0].ecart, 4);
});

test("sans devis : valeur du tissu et des déchets seulement, signalé", () => {
  const v = buildReportView(contenu);
  const val = buildReportValeur(v, { prix_tissu_kg: "4000", prix_tissu_source: "article", taux_change: null, theorique: [] });
  close(val.valeurTissu, 50000);
  close(val.valeurDechets, 3200);
  close(val.tissuParPiece, 50000 / 99);
  assert.equal(val.prixRevient, null);
  assert.ok(val.warnings.some((w) => w.includes("Sans devis")));
});

test("avec devis : prix de revient réel = théorique − tissu théorique + tissu réel", () => {
  const v = buildReportView(contenu);
  const val = buildReportValeur(v, {
    prix_tissu_kg: 4000,
    prix_tissu_source: "odf",
    taux_change: 1,
    theorique: [{ quantite: 100, prix_vente: 1600, prix_revient: 800, detail: { charges_pct: 40, composants: [{ libelle: "Tissu", cout: 500, est_tissu: true }] } }],
  });
  close(val.prixRevient?.reel?.prixRevient, 100 * 800 - 100 * 500 + 12.5 * 4000);
});

test("sans prix au kg : aucune valeur inventée", () => {
  const val = buildReportValeur(buildReportView(contenu), { prix_tissu_kg: null, prix_tissu_source: null, taux_change: null, theorique: [] });
  assert.equal(val.valeurTissu, null);
  assert.ok(val.warnings[0].includes("Prix du tissu"));
});

test("durée écoulée lisible", () => {
  assert.deepEqual([formatDuree(null), formatDuree(45), formatDuree(190), formatDuree(120), formatDuree(60 * 52)], ["—", "45 min", "3 h 10", "2 h", "2 j 4 h"]);
});

console.log(`\n${n} tests OK`);
