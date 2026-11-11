import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getSizes } from "@/lib/sizes";
import { buildLabelSheetPdf, formatLabelDate } from "@/lib/pdf/waste-bag-label";
import { compositionTissus, libelleTissu } from "@/lib/patronnage/tissus-matelas";

/**
 * Planche A4 des étiquettes d'un matelas regroupé clôturé (étape 4b,
 * migration 0153) : un paquet QR par article d'ODF × taille pour la pièce
 * coupée (code du lot, ODF, pièce, taille, quantité, date), puis le client,
 * l'article et le tissu de la pièce (grammage, couleur, référence) pour que
 * les couches séparées à la coupe restent identifiables. Même garde que
 * les étiquettes de matelas : personnel connecté, lecture par la RLS.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = await params;
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (current.profile.role === "client") return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const supabase = await createClient();
  const [{ data: cloture }, { data: lots }, referentiel] = await Promise.all([
    supabase.from("clotures_matelas_pieces").select("cloture_le").eq("trace_id", traceId).maybeSingle(),
    supabase
      .from("article_lots")
      .select(
        "code,composition_taille,production_order_line_id,semi_fini_id,semi_fini:product_models!article_lots_semi_fini_id_fkey(name),production_orders(reference,companies(name)),production_order_lines(description)"
      )
      .eq("trace_id", traceId)
      .not("cloture_pieces_id", "is", null)
      .order("created_at"),
    getSizes(),
  ]);
  if (!cloture || !lots?.length) return NextResponse.json({ error: "Matelas regroupé clôturé introuvable" }, { status: 404 });

  // Tissu de chaque paquet : grammage, couleur de la pièce, référence.
  const cle = (l: { production_order_line_id: string | null; semi_fini_id: string | null }) => `${l.production_order_line_id}|${l.semi_fini_id}`;
  const tissus = await compositionTissus(
    supabase,
    new Map(
      lots
        .filter((l) => l.production_order_line_id && l.semi_fini_id)
        .map((l) => [cle(l), [{ lineId: l.production_order_line_id as string, nbCouches: 0, semiFiniIds: [l.semi_fini_id as string], odf: null }]])
    )
  );

  const baseUrl = await getBaseUrl();
  const date = formatLabelDate(cloture.cloture_le as string);
  const libelle = (cle: string) => referentiel.find((t) => t.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  const pdfBytes = await buildLabelSheetPdf(
    lots.map((l) => {
      const [taille, n] = Object.entries((l.composition_taille ?? {}) as Record<string, number>)[0] ?? ["", 0];
      const piece = (l.semi_fini as unknown as { name: string } | null)?.name ?? "Pièce";
      const po = l.production_orders as unknown as { reference: string; companies: { name: string } | null } | null;
      const odf = po?.reference ?? "";
      const client = po?.companies?.name ?? "Stock";
      const article = (l.production_order_lines as unknown as { description: string } | null)?.description ?? "";
      const tissu = tissus.get(cle(l))?.[0];
      return {
        url: `${baseUrl}/lots/${l.code}`,
        lines: [l.code as string, `${odf} · ${piece} · ${libelle(taille)} · ${n} pcs`, date] as [string, string, string],
        extra: [winAnsi(`${client} · ${article}`), tissu ? winAnsi(libelleTissu(tissu)) : ""],
      };
    }),
    "Étiquettes matelas regroupé"
  );
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiquettes-matelas-regroupe.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Police standard des étiquettes (WinAnsi) : un caractère hors jeu ferait échouer le PDF. */
function winAnsi(s: string) {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^ -ÿ·]/g, "?");
}
