/**
 * Aperçu local du bon de carburant (VEH-3), sans base ni session.
 *
 * `npm run preview:pdf-bon-carburant [chemin/de/sortie.pdf]`
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFuelVoucherPdf } from "../src/lib/pdf/fuel-voucher-pdf";

async function main() {
  const out = process.argv[2] ?? "bon-carburant-apercu.pdf";
  const pdf = await buildFuelVoucherPdf({
  numero: "BC-2026-0007",
  valideLe: "2026-11-10T09:30:00Z",
  statut: "valide",
  vehicule: { libelle: "Camion livraison 1", immatriculation: "2632JP01", energie: "gasoil" },
  beneficiaire: "Koné Ibrahim",
  motif: "Tournée Yopougon - Abobo - Anyama",
  station: "Total Riviera 3",
  montant: 35000,
  kmDemande: 84520,
  validePar: "Responsable logistique",
  issuer: {
    raison_sociale: "SERITEX",
    adresse: "Zone industrielle de Yopougon",
    ville: "Abidjan",
    pays: "Côte d'Ivoire",
  } as never,
  seal: null,
  logoPng: await readFile(path.join(process.cwd(), "public/logo-seritex-wide.png")),
});
  await writeFile(out, pdf);
  console.log(`Aperçu écrit : ${out}`);
}

void main();
