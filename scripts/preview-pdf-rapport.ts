/**
 * Aperçu local du rapport de production imprimable.
 *
 * `npm run preview:pdf-rapport [chemin/de/sortie.pdf]`
 *
 * Jeu de données volontairement chargé (deux articles, huit tailles, sept
 * sections, devis chiffré) pour vérifier la mise en page — coupures de
 * page, colonnes, troncatures — sans base Supabase.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildProductionReportPdf } from "../src/lib/pdf/production-report-pdf";
import { buildReportValeur, buildReportView, type ReportContenu } from "../src/lib/production-report";

const tailles = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
const ligne = (description: string, base: number) => ({
  line_id: description,
  description,
  quantite: base * tailles.length,
  en_cours: 0,
  tailles: tailles.map((t, i) => ({
    taille: `Homme/${t}`,
    demande: base,
    premier_choix: base - (i % 3),
    deuxieme_choix: i % 2,
    dechets: i % 3,
    en_cours: 0,
    surplus: i === 4 ? 3 : 0,
  })),
});
const contenu: ReportContenu = {
  bilan: { en_cours: 0, lignes: [ligne("T-shirt col rond blanc, manches courtes, sérigraphie cœur + dos", 120), ligne("Polo piqué marine brodé", 60)] },
  sections: ["Coupe", "Impression DTF", "Sérigraphie", "Bonneterie", "Couture A", "Polos", "Finition"].map((s, i) => ({
    work_order_id: s,
    etape: i + 1,
    section: s,
    categorie: null,
    ligne: i % 2 ? "Polo piqué marine brodé" : "T-shirt col rond blanc",
    prevu: 960,
    fait: 950,
    bonnes: i === 6 ? 0 : 940,
    premier_choix: i === 6 ? 930 : 0,
    deuxieme_choix: i === 6 ? 12 : 0,
    dechets: 8,
    preleve: 0,
    surplus: 0,
    premiere_declaration: "2026-10-20T08:12:00Z",
    derniere_declaration: `2026-10-2${i % 3 + 1}T16:40:00Z`,
    duree_ecoulee_min: 508 + i * 900,
  })),
  tissu: { kg_reception: "182.4", kg_retour_stock: "11.2", kg_sortie_lots: "160.1", kg_dechets: "9.7", matelas_clotures: 4 },
  consommables: [
    { code: "COBO0001", designation: "Bouton nacre 12 mm", unite: "piece", theorique: "1440", reel: "1452", motif: "boutons cassés à la pose" },
    { code: "COEM0001", designation: "Sachet individuel", unite: "piece", theorique: "1440", reel: null, motif: null },
  ],
};
const view = buildReportView(contenu);
const valeur = buildReportValeur(view, {
  prix_tissu_kg: 4468.45,
  prix_tissu_source: "article",
  taux_change: 1,
  theorique: [{ quantite: 1440, prix_vente: 1600, prix_revient: 778.39, detail: { charges_pct: 40, composants: [{ libelle: "Tissu", cout: 638.35, est_tissu: true }] } }],
});

async function main() {
  const bytes = await buildProductionReportPdf({
    reference: "ODF-2026-0148",
    client: "Société Ivoirienne de Distribution — Abidjan Plateau",
    numero: 2,
    genereLe: "2026-10-23T17:05:00Z",
    demandePar: "Chef de production",
    motifDemande: null,
    decision: "Renvoyé en production",
    decisionLe: "2026-10-24T09:30:00Z",
    decisionPar: "Direction",
    decisionNote: "Recompter les 2e choix du polo avant validation.",
    view,
    valeur,
    tailleLabel: (cle) => cle.split("/").pop() ?? cle,
    formatDateTime: (v) => (v ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "-"),
    formatMoney: (v) => (v === null ? "-" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} F CFA`),
  });
  const out = path.resolve(process.argv[2] ?? "rapport-preview.pdf");
  await writeFile(out, bytes);
  console.log(`PDF d'aperçu écrit : ${out}`);
}

main();
