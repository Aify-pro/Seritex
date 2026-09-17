/**
 * Aperçu local du bon imprimable de l'ordre de fabrication.
 *
 * `npm run preview:pdf-odf [chemin/de/sortie.pdf]`
 *
 * Génère le PDF avec un jeu de données volontairement pénible (adresse
 * longue, huit tailles, plusieurs articles, six sous-ODF) pour vérifier la
 * mise en page — coupures de page, filets, chevauchements — sans avoir
 * besoin d'une base Supabase ni d'une session authentifiée.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { buildOdfPdf, type OdfPdfData } from "../src/lib/pdf/odf-pdf";

const BASE = "https://seritex.example.com";

const sizes = (entries: [string, number][]) => entries.map(([taille, quantite]) => ({ taille, quantite }));

const data: OdfPdfData = {
  reference: "ODF-2026-0148",
  statusLabel: "En production",
  sheetUrl: `${BASE}/atelier/production/11111111-2222-3333-4444-555555555555`,
  generatedAt: "16 sept. 2026",
  client: {
    name: "Groupe Textile Atlantique & Compagnie",
    address: "Zone industrielle des Hauts Fourneaux, bâtiment C, 12 rue de la Manufacture, 59200 Tourcoing",
    phone: "+33 3 20 45 88 12",
    email: "commandes@textile-atlantique.example",
    siret: "812 456 733 00027",
  },
  devis: "DEV-2026-0311",
  totalQuantity: 1450,
  plannedStart: "21 sept. 2026",
  plannedEnd: "14 oct. 2026",
  articles: [
    {
      description: "Polo piqué manches courtes col chemise, broderie poitrine gauche",
      quantity: 800,
      modele: "PL-320 Polo piqué homme",
      tissu: "Piqué de coton peigné 220 g",
      composition: "100 % coton peigné",
      grammageLaize: "220 g/m2 - laize 180 cm",
      couleurLabel: "Couleurs par zone",
      couleurs: [
        { zone: "Corps avant", name: "Bleu marine", code: "#1A2A4A" },
        { zone: "Corps arrière", name: "Bleu marine", code: "#1A2A4A" },
        { zone: "Col et poignets", name: "Blanc optique", code: "#F5F7FA" },
        { zone: "Boutonnière", name: "Rouge signal", code: "#C1272D" },
        { zone: "Fente latérale", name: "Gris perle", code: "#B9BEC4" },
        // Référence saisie hors palette : la pastille reste neutre et la
        // référence passe en alerte, elle ne ment pas sur le ton.
        { zone: "Broderie poitrine", name: "Or antique", code: "PANTONE 872 C" },
      ],
      sections: "Coupe, Piquage, Broderie, Finition, Emballage",
      fiche: "OT-2026-0091 (Bon pour coupe)",
      visuels: "logo-poitrine-v3.pdf, placement-broderie.png",
      // Renseigné dans main() : générer l'image tient à un await, impossible ici au niveau module en sortie CJS (tsx).
      maquette: null,
      sizes: sizes([
        ["XS", 40],
        ["S", 120],
        ["M", 220],
        ["L", 230],
        ["XL", 130],
        ["2XL", 40],
        ["3XL", 20],
      ]),
    },
    {
      description: "Pantalon de travail multipoches renforcé genoux",
      quantity: 450,
      modele: "PT-880 Pantalon technique",
      tissu: "Sergé polycoton 245 g",
      composition: "65 % polyester / 35 % coton",
      grammageLaize: "245 g/m2 - laize 150 cm",
      couleurLabel: "Couleur",
      couleurs: [{ zone: null, name: "Gris anthracite", code: "#3A3F44" }],
      sections: "Coupe, Piquage, Finition, Contrôle qualité, Emballage",
      fiche: "OT-2026-0092 (En cours)",
      visuels: null,
      maquette: null,
      sizes: sizes([
        ["38", 30],
        ["40", 60],
        ["42", 90],
        ["44", 95],
        ["46", 80],
        ["48", 50],
        ["50", 30],
        ["52", 15],
      ]),
    },
    {
      description: "Veste softshell coupe-vent doublée, capuche amovible",
      quantity: 200,
      modele: "VS-410 Softshell",
      tissu: null,
      composition: null,
      grammageLaize: null,
      couleurLabel: "Couleur",
      couleurs: [],
      sections: "Coupe, Piquage, Finition",
      fiche: null,
      visuels: "dossier-technique-softshell.pdf",
      maquette: null,
      sizes: sizes([
        ["S", 30],
        ["M", 70],
        ["L", 60],
        ["XL", 40],
      ]),
    },
  ],
  sousOdf: [
    { reference: "OT-2026-0501", section: "Coupe", sectionDisplayOrder: 1, planned: 1450, done: 1450 },
    { reference: "OT-2026-0502", section: "Piquage", sectionDisplayOrder: 2, planned: 1450, done: 940 },
    { reference: "OT-2026-0503", section: "Broderie", sectionDisplayOrder: 3, planned: 800, done: 610 },
    { reference: "OT-2026-0504", section: "Finition", sectionDisplayOrder: 4, planned: 1450, done: 320 },
    { reference: "OT-2026-0505", section: "Contrôle qualité", sectionDisplayOrder: 5, planned: 450, done: 0 },
    { reference: "OT-2026-0506", section: "Emballage et expédition", sectionDisplayOrder: 6, planned: 1450, done: 0 },
  ],
  surplusTraces: [
    ["M", 6],
    ["L", 4],
  ],
  lifecycle: [
    { event: "Soumis à validation", date: "18 sept. 2026", by: "Sofia Bennani" },
    { event: "Lancé en production", date: "21 sept. 2026", by: "Karim Elyazidi" },
    { event: "Clôture demandée", date: "13 oct. 2026", by: "Karim Elyazidi" },
  ],
  clotureNote:
    "Reliquat de 12 pièces en taille L a reporter sur le prochain ODF du meme modele : le tissu recu sur le dernier rouleau presentait un defaut de teinture sur environ 4 metres.",
};

async function main() {
  // Tient lieu de vraie maquette (simulation, migration 0040) : un carré
  // généré à la volée, seulement pour vérifier ici que l'image s'embarque et
  // se met à l'échelle sans jamais dépasser sa page ni se déformer — aucun
  // asset réel n'est nécessaire pour ce script.
  const sampleMaquette = await QRCode.toBuffer(`${BASE}/exemple-maquette`, { type: "png", width: 900, margin: 2 });
  data.articles[0].maquette = { fileName: "simulation-poitrine.png", bytes: sampleMaquette, format: "png" };

  const out = path.resolve(process.argv[2] ?? "odf-preview.pdf");
  const bytes = await buildOdfPdf(data);
  await writeFile(out, bytes);
  console.log(`PDF d'aperçu écrit : ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
