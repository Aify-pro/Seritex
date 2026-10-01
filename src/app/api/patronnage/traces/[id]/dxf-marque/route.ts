import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { formatDate } from "@/lib/utils";
import { chargerTraceSource, facteurEnregistreTrace } from "@/lib/patronnage/trace-source";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { construireAnalyseDetaillee } from "@/lib/patronnage/detail";
import { genererDxfMarque } from "@/lib/patronnage/dxf-export";

const SEUIL_RECONNAISSANCE = 98;

/**
 * Téléchargement du DXF « marqué » : texte au centre de chaque pièce
 * (article/taille/pièce reconnus, ou « NON RECONNUE ») + cartouche (QR vers
 * la fiche, référence, OT, ODF, client) — généré à la volée contre la
 * bibliothèque ACTUELLE, jamais un instantané figé : disponible dès qu'une
 * analyse existe, y compris partielle, comme outil de contrôle (cf. décision
 * du 2026-10-01 — la fiche garde son propre circuit de validation « Bon pour
 * coupe », ce téléchargement n'en est pas un raccourci).
 *
 * Même convention d'autorisation que `dxf/route.ts` : RLS de
 * `traces_placement`/`analyses_trace`/`pattern_pieces`, pas de vérification
 * de permission dédiée ici.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: trace } = await supabase
    .from("traces_placement")
    .select(
      "id,reference,fiche_id,fiches_placement(numero_ot,client_libelle,designation_article,production_order_lines(description,production_orders(reference)))"
    )
    .eq("id", traceId)
    .maybeSingle();
  if (!trace) return NextResponse.json({ error: "Tracé introuvable" }, { status: 404 });

  const fiche = Array.isArray(trace.fiches_placement) ? trace.fiches_placement[0] : trace.fiches_placement;
  if (!fiche) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  const ligneOdf = Array.isArray(fiche.production_order_lines) ? fiche.production_order_lines[0] : fiche.production_order_lines;
  const odf = ligneOdf ? (Array.isArray(ligneOdf.production_orders) ? ligneOdf.production_orders[0] : ligneOdf.production_orders) : null;
  const odfReference = odf ? `${odf.reference}${ligneOdf?.description ? ` — ${ligneOdf.description}` : ""}` : null;

  const source = await chargerTraceSource(supabase, traceId, trace.fiche_id);
  if ("error" in source) return NextResponse.json({ error: source.error }, { status: 404 });

  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return NextResponse.json({ error: library.error }, { status: 500 });

  // Même échelle que celle affichée/enregistrée pour ce tracé (cf.
  // trace-source.ts) : le marquage ne doit jamais raconter une autre analyse
  // que celle que l'écran montre pour ce même tracé.
  const facteurForce = await facteurEnregistreTrace(supabase, traceId);
  const detail = construireAnalyseDetaillee(source.contours, library.references, SEUIL_RECONNAISSANCE, { facteurForce });

  const baseUrl = await getBaseUrl();
  const resultat = genererDxfMarque(source.texte, source.contours, detail.lignes, {
    traceReference: trace.reference,
    numeroOt: fiche.numero_ot,
    odfReference,
    clientLabel: fiche.client_libelle,
    articleLabel: fiche.designation_article,
    dateLabel: formatDate(new Date().toISOString()),
    url: `${baseUrl}/atelier/patronnage/${trace.fiche_id}?trace=${traceId}`,
    facteurEchelle: detail.scaleFactor,
  });
  if ("error" in resultat) return NextResponse.json({ error: resultat.error }, { status: 422 });

  const nomFichier = `${trace.reference}-marque.dxf`.replace(/"/g, "");
  return new NextResponse(resultat.dxf, {
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${nomFichier}"`,
    },
  });
}
