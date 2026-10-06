/**
 * Aperçu local du bon imprimable de la fiche échantillon.
 *
 * `npm run preview:pdf-echantillon [chemin/de/sortie.pdf]`
 *
 * Jeu de données volontairement pénible (long besoin, nom de client à
 * rallonge, plusieurs visuels, maquette) pour vérifier la mise en page —
 * notamment que la fiche ne mord jamais sur l'étiquette détachable — sans
 * base Supabase ni session authentifiée.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSamplePdf, type SamplePdfData } from "../src/lib/pdf/sample-pdf";

/**
 * Fausse maquette : on réutilise le logo du dépôt comme image, uniquement
 * pour vérifier le cadrage de la vignette (mise à l'échelle, centrage).
 */
async function fakeMaquette(): Promise<SamplePdfData["maquette"]> {
  return {
    bytes: await readFile(path.join(process.cwd(), "public/logo-seritex-wide.png")),
    format: "png",
    fileName: "maquette-tshirt-180g-recto-verso-validee-client.png",
  };
}

const data: SamplePdfData = {
  sampleNumber: "ECH-2026-00142",
  reference: "ECH-M9Q2KX7",
  statusLabel: "En fabrication",
  priorityLabel: "Urgente",
  companyName: "Groupe Textile Atlantique & Compagnie",
  requestReference: "REQ-2026-0311",
  quoteLineLabel: "DEV-2026-0311 - T-shirt col rond 180g coton peigne, serigraphie 2 couleurs poitrine",
  orderLineLabel: "ODF-2026-0148 - T-shirt col rond 180g (En production)",
  needDescription:
    "Echantillon avant commande ferme : valider le tombant du 180g sur la taille L, le rendu de la serigraphie deux couleurs sur fond blanc, et la tenue du col apres deux lavages a 40 degres. Le client compare avec un concurrent, la main du tissu est le critere decisif.",
  extraInfo:
    "Prevoir un second exemplaire non imprime pour comparaison. Le client passe le recuperer en main propre jeudi matin.",
  requestDate: "06 oct. 2026",
  dueDate: "14 oct. 2026",
  visuelNames: [
    "visuel-poitrine-2couleurs-vectorise.pdf",
    "visuel-dos-logo-monochrome.ai",
    "gabarit-placement-serigraphie-L.png",
  ],
  requiresVisuel: true,
  maquette: null,
  sheetUrl: "https://seritex.example.com/echantillons/ECH-2026-00142",
  generatedAt: "06 oct. 2026",
};

async function main() {
  const out = path.resolve(process.argv[2] ?? "apercu-fiche-echantillon.pdf");
  await writeFile(out, await buildSamplePdf({ ...data, maquette: await fakeMaquette() }));
  console.log(`PDF ecrit : ${out}`);

  // Second tirage dans le cas minimal : pas de maquette, pas de visuel, pas
  // de devis ni d'ODF, besoin tres court — c'est la fiche la plus vide
  // possible, elle doit rester presentable.
  const minimal = path.resolve(out.replace(/\.pdf$/, "-minimal.pdf"));
  await writeFile(
    minimal,
    await buildSamplePdf({
      ...data,
      statusLabel: "Demande",
      priorityLabel: "Normale",
      companyName: null,
      requestReference: "REQ-2026-0312",
      quoteLineLabel: null,
      orderLineLabel: null,
      needDescription: "Echantillon simple, sans impression.",
      extraInfo: null,
      dueDate: null,
      visuelNames: [],
      requiresVisuel: false,
      maquette: null,
    })
  );
  console.log(`PDF ecrit : ${minimal}`);
}

main();
