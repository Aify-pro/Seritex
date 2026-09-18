import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { buildWasteBagLabelPdf, A4_MAX_COPIES, type WasteBagLabelFormat } from "@/lib/pdf/waste-bag-label";

/**
 * Étiquette imprimable d'un sac de déchets — `?format=thermique` (une
 * étiquette de 52 mm de large) ou `?format=a4&copies=N` (planche de 1 à 12
 * étiquettes). Construite à la demande, jamais mise en cache : un sac scellé
 * entre deux impressions doit ressortir avec son poids final.
 *
 * Même garde que la fiche `/dechets/[code]` : tout le personnel connecté,
 * jamais un client. La lecture passe par la RLS de l'utilisateur.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const supabase = await createClient();
  const { data: bag } = await supabase
    .from("sacs_dechets")
    .select("code,statut,poids_total_kg,created_at")
    .eq("code", code)
    .maybeSingle();

  if (!bag) return NextResponse.json({ error: "Sac de déchets introuvable" }, { status: 404 });

  const format: WasteBagLabelFormat = req.nextUrl.searchParams.get("format") === "a4" ? "a4" : "thermique";
  const copies = Number(req.nextUrl.searchParams.get("copies") ?? A4_MAX_COPIES);

  const pdfBytes = await buildWasteBagLabelPdf(
    {
      code: bag.code,
      url: `${await getBaseUrl()}/dechets/${bag.code}`,
      createdAt: formatDate(bag.created_at),
      sealedLine:
        bag.statut === "charge" && bag.poids_total_kg !== null
          ? `Scellé ${Number(bag.poids_total_kg).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`
          : null,
    },
    format,
    Number.isFinite(copies) ? copies : A4_MAX_COPIES
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiquette-${bag.code}-${format}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(value)
  );
}
