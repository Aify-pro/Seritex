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
  // Cas interessant : le client a deja valide (saisie commercial), la
  // direction pas encore — le cartouche imprime donc une case remplie et une
  // case a signer.
  validations: {
    client: { at: "06 oct. 2026", byName: "Awa Diallo (Textile Atlantique)", onBehalf: true },
    direction: { at: "06 oct. 2026", byName: "Mme Diop" },
  },
  directionSeal: null,
  negativeDecision: null,
};

/**
 * Faux cachet et fausse signature : deux images du depot, juste pour verifier
 * le cadrage (cachet dessous, signature par-dessus) sans secret en clair.
 */
async function fakeSeal(): Promise<SamplePdfData["directionSeal"]> {
  const [signaturePng, stampPng] = await Promise.all([
    readFile(path.join(process.cwd(), "public/logo-seritex.png")),
    readFile(path.join(process.cwd(), "public/logo-seritex-wide.png")),
  ]);
  return { signaturePng, stampPng, name: "Mme Diop", fonction: "Directrice generale" };
}

async function main() {
  const out = path.resolve(process.argv[2] ?? "apercu-fiche-echantillon.pdf");
  const maquette = await fakeMaquette();

  // 1. Fiche chargee, validee des deux cotes, avec cachet et signature.
  await writeFile(out, await buildSamplePdf({ ...data, maquette, directionSeal: await fakeSeal() }));
  console.log(`PDF ecrit : ${out}`);

  // 2. Cas minimal : rien de rempli, aucune validation — la fiche la plus
  //    vide possible doit rester presentable.
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
      validations: { client: { at: null, byName: null, onBehalf: false }, direction: { at: null, byName: null } },
      directionSeal: null,
      negativeDecision: null,
    })
  );
  console.log(`PDF ecrit : ${minimal}`);

  // 3. Reponse negative : le motif a son bandeau, le cartouche repart vierge
  //    (une reponse negative efface les validations, cf. migration 0100).
  const refus = path.resolve(out.replace(/\.pdf$/, "-a-ajuster.pdf"));
  await writeFile(
    refus,
    await buildSamplePdf({
      ...data,
      statusLabel: "A ajuster",
      maquette,
      validations: { client: { at: null, byName: null, onBehalf: false }, direction: { at: null, byName: null } },
      directionSeal: null,
      negativeDecision: {
        label: "Echantillon a ajuster",
        motif:
          "Col trop serre a la taille L et teinte du bleu plus sombre que la maquette validee. Reprendre le patron du col et refaire un essai avec le bain precedent.",
        byName: "Awa Diallo (Textile Atlantique)",
        at: "06 oct. 2026",
      },
    })
  );
  console.log(`PDF ecrit : ${refus}`);
}

main();
