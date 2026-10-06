import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { buildLabelSheetPdf } from "@/lib/pdf/waste-bag-label";

/**
 * Étiquettes de rouleaux (migration 0095), planche A4 : QR du code du
 * rouleau, tissu et coloris, laize, poids et bain.
 */
export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const codes = (req.nextUrl.searchParams.get("codes") ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^ROL-\d{4}-\d{5}$/.test(c))
    .slice(0, 200);
  if (codes.length === 0) return NextResponse.json({ error: "Aucun rouleau" }, { status: 400 });

  const supabase = await createClient();
  const { data: rolls } = await supabase
    .from("textile_rolls")
    .select("code,bain,laize_cm,poids_initial_kg,sage_reference,textiles(nom)")
    .in("code", codes);
  if (!rolls || rolls.length === 0) return NextResponse.json({ error: "Rouleaux introuvables" }, { status: 404 });

  const baseUrl = await getBaseUrl();
  const ordered = codes.map((c) => rolls.find((r) => r.code === c)).filter((r): r is NonNullable<typeof r> => !!r);
  const pdf = await buildLabelSheetPdf(
    ordered.map((r) => ({
      url: `${baseUrl}/atelier/stock/rouleaux?q=${r.code}`,
      lines: [
        r.code as string,
        `${(r.textiles as unknown as { nom: string } | null)?.nom ?? ""}${r.sage_reference ? ` · ${r.sage_reference}` : ""}`,
        `${r.laize_cm ? `${r.laize_cm} cm · ` : ""}${Number(r.poids_initial_kg).toLocaleString("fr-FR")} kg${r.bain ? ` · bain ${r.bain}` : ""}`,
      ] as [string, string, string],
    })),
    "Étiquettes de rouleaux"
  );
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="rouleaux.pdf"`, "Cache-Control": "no-store" },
  });
}
