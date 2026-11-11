/**
 * Aperçu local de l'ordre de tracé imprimable.
 *
 * `npm run preview:pdf-ordre-trace [chemin/de/sortie.pdf] [--matelas]`
 *
 * Ordre de coupe regroupé de trois articles (dont un d'ODF annulé), deux
 * tracés, un dessin de tracé fictif : contrôle des coupures de page et du
 * placement, sans base Supabase. `--matelas` : la fiche matelas seule.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildOrdreTracePdf, type OrdreTracePdfData } from "../src/lib/pdf/ordre-trace-pdf";
import { genererTracePdf } from "../src/lib/patronnage/trace-pdf";
import type { DxfContour } from "../src/lib/patronnage/dxf";

const BASE = "https://seritex.example.com";
const rect = (x: number, y: number, w: number, h: number): DxfContour => ({
  layer: "0",
  points: [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ],
  interieurs: [],
});

async function main() {
  const out = process.argv.find((a) => a.endsWith(".pdf")) ?? path.join(process.cwd(), "ordre-trace-apercu.pdf");
  const seule = process.argv.includes("--matelas");
  const contours: DxfContour[] = [];
  for (let i = 0; i < 12; i += 1) contours.push(rect((i % 6) * 30, Math.floor(i / 6) * 45, 26, 40));
  const dessin = await genererTracePdf(contours, null);

  const data: OrdreTracePdfData = {
    numeroOt: "OT-2026-0008",
    statutLabel: "Bon pour coupe",
    regroupee: true,
    designation: "Manche courte + Col rond",
    modele: null,
    tissu: "Jersey 180",
    grammage: 180,
    laizeUtileCm: 178,
    couleur: null,
    client: "Orange Côte d'Ivoire, Stock",
    dateEmission: "10 nov. 2026",
    dateRetour: "14 nov. 2026",
    contraintes: "Sens du fil respecté sur les manches.",
    observations: null,
    articles: [
      { odf: "OF-20261027-3a42", client: "Orange Côte d'Ivoire", article: "T-shirt col rond Homme", couleur: "Blanc / Bleu roi", quantite: 300, tailles: [["S", 50], ["M", 120], ["L", 90], ["XL", 40]], pieces: [{ nom: "Manche courte", couleur: "Bleu roi" }, { nom: "Col rond", couleur: "Blanc" }], odfAnnule: false },
      { odf: "OF-20261109-9850", client: "Stock", article: "T-shirt col rond Homme", couleur: "Noir", quantite: 120, tailles: [["M", 60], ["L", 60]], pieces: [{ nom: "Manche courte", couleur: "Noir" }, { nom: "Col rond", couleur: null }], odfAnnule: false },
      { odf: "OF-20261109-2d15", client: "Client annulé", article: "T-shirt col rond Femme", couleur: "Rouge", quantite: 80, tailles: [["S", 40], ["M", 40]], pieces: [{ nom: "Manche courte", couleur: "Rouge" }], odfAnnule: true },
    ],
    traces: [1, 2].map((k) => ({
      reference: `OT-2026-0008-T${k}`,
      statut: k === 1 ? "Bon pour coupe" : "En préparation",
      forme: k === 1 ? "Tubulaire" : "Ouvert (au large)",
      referencePatron: "PAT-TSH-H",
      longueurCm: 640,
      laizeCm: 178,
      couches: 75,
      tissusPrevus: ["JE180BRO - Jersey 180 g · Bleu roi", "JE180NOI - Jersey 180 g · Noir"],
      tissus: [
        { libelle: "Jersey 180 g · Bleu roi · réf. JE180BRO", couches: 30, odfs: "OF-20261027-3a42 (30)" },
        { libelle: "Jersey 180 g · Noir · réf. JE180NOI", couches: 30, odfs: "OF-20261109-9850 (30)" },
        { libelle: "Jersey 145 g · Rouge", couches: 15, odfs: "OF-20261109-2d15 (15)" },
      ],
      couchesParArticle: [
        { libelle: "OF-20261027-3a42 · T-shirt col rond Homme", couleur: "Bleu roi", couches: 30, odfAnnule: false },
        { libelle: "OF-20261109-9850 · T-shirt col rond Homme", couleur: "Noir", couches: 30, odfAnnule: false },
        { libelle: "OF-20261109-2d15 · T-shirt col rond Femme", couleur: "Rouge", couches: 15, odfAnnule: true },
      ],
      piecesParCouche: [
        { piece: "Manche courte", taille: "M", quantite: 4 },
        { piece: "Manche courte", taille: "L", quantite: 2 },
      ],
      rouleaux: [
        { code: "JE180BLE-178-224", laizeCm: 178, bain: "B12", poidsKg: 24.5 },
        { code: "JE180NOI-178-225", laizeCm: 178, bain: "B07", poidsKg: 22 },
      ],
      url: `${BASE}/atelier/patronnage/x?trace=${k}`,
      dessin: "error" in dessin ? null : dessin.pdf,
    })),
    url: `${BASE}/atelier/patronnage/x`,
    generatedAt: "10 nov. 2026",
    ficheMatelasSeule: seule,
  };
  if (seule) data.traces = data.traces.slice(0, 1);
  await writeFile(out, await buildOrdreTracePdf(data));
  console.log(`PDF écrit : ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
