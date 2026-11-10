import { NextRequest, NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildVehicleExport, type ExportFormat, type ExportJeu } from "@/lib/vehicules/export";

/**
 * Export du suivi des véhicules pour une IA (D6) : /api/vehicules/export?du=&au=&format=md|txt|csv&jeu=…
 * Réservé au droit « Véhicules : voir » ; les données sont lues sous l'identité de l'utilisateur (RLS).
 */
export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client" || current.profile.role === "livreur" || !(await can("vehicules", "view"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const au = re.test(sp.get("au") ?? "") ? sp.get("au")! : new Date().toISOString().slice(0, 10);
  const du = re.test(sp.get("du") ?? "") ? sp.get("du")! : new Date(Date.parse(au) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (du > au) return NextResponse.json({ error: "Période invalide" }, { status: 400 });
  if (Date.parse(au) - Date.parse(du) > 400 * 86_400_000) return NextResponse.json({ error: "Période limitée à 13 mois" }, { status: 400 });
  const format = (["md", "txt", "csv"].includes(sp.get("format") ?? "") ? sp.get("format") : "md") as ExportFormat;
  const jeu = (["synthese", "bons", "km_jours", "alertes"].includes(sp.get("jeu") ?? "") ? sp.get("jeu") : "synthese") as ExportJeu;
  const file = await buildVehicleExport({ du, au, format, jeu });
  return new NextResponse(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
