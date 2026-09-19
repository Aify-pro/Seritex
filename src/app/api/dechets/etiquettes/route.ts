import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { buildWasteBagsSheetPdf, formatLabelDate } from "@/lib/pdf/waste-bag-label";

/**
 * Planche A4 des sacs de déchets en cours — un QR par sac, jusqu'à 12 par
 * page, pagination automatique au-delà. Bouton « Générer les QR codes » du
 * menu principal des sacs (barre d'actions de la file Coupe) : on prépare
 * souvent plusieurs sacs à l'avance et on imprime leurs étiquettes d'un
 * coup plutôt qu'une par une.
 *
 * Toujours reconstruite à la demande, jamais mise en cache : la liste des
 * sacs en cours change au fil de la journée. Même garde que la fiche
 * `/dechets/[code]` : tout le personnel connecté, jamais un client.
 */
export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const supabase = await createClient();
  const { data: bags } = await supabase
    .from("sacs_dechets")
    .select("code,created_at")
    .eq("statut", "en_cours")
    .order("created_at", { ascending: false });

  if (!bags || bags.length === 0) {
    return NextResponse.json({ error: "Aucun sac de déchets en cours" }, { status: 404 });
  }

  const baseUrl = await getBaseUrl();
  const pdfBytes = await buildWasteBagsSheetPdf(
    bags.map((bag) => ({
      code: bag.code,
      url: `${baseUrl}/dechets/${bag.code}`,
      createdAt: formatLabelDate(bag.created_at),
      sealedLine: null,
    }))
  );

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiquettes-sacs-en-cours.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
