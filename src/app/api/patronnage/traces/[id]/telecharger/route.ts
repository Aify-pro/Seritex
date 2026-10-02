import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { formatDate } from "@/lib/utils";
import { chargerTraceSource, facteurEnregistreTrace } from "@/lib/patronnage/trace-source";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { construireAnalyseDetaillee, type LignePieceDetail } from "@/lib/patronnage/detail";
import { genererDxfMarque } from "@/lib/patronnage/dxf-export";
import { genererTracePdf } from "@/lib/patronnage/trace-pdf";
import type { CartoucheInfo, OrientationCartouche } from "@/lib/patronnage/cartouche";

const SEUIL_RECONNAISSANCE = 98;

/**
 * Téléchargement d'un tracé — un seul point d'entrée pour les 6 combinaisons
 * du menu « Télécharger » : `?format=dxf|pdf&marquage=aucun|horizontal|vertical`.
 *
 * - `marquage=aucun` : le fichier TEL QUE DÉPOSÉ (DXF) ou sa représentation
 *   PDF sans annotation — aucune bibliothèque à charger.
 * - `marquage=horizontal|vertical` : texte au centre de chaque pièce
 *   (article/taille/pièce reconnus, ou « NON RECONNUE ») + cartouche (QR vers
 *   la fiche, référence, OT, ODF, client), dans l'orientation choisie —
 *   généré à la volée contre la bibliothèque ACTUELLE, jamais un instantané
 *   figé : disponible dès qu'une analyse existe, y compris partielle, comme
 *   outil de contrôle (décision du 2026-10-01 — la fiche garde son propre
 *   circuit de validation « Bon pour coupe », ce téléchargement n'en est pas
 *   un raccourci).
 *
 * Le DXF marqué SURCHARGE le fichier original (jamais régénéré, cf.
 * dxf-export.ts) ; le PDF, lui, est toujours redessiné sur UNE page, hors
 * échelle, jamais un support de coupe (cf. trace-pdf.ts).
 *
 * Aucune vérification de permission dédiée : l'autorisation réelle vit dans
 * la RLS (`traces_placement`/`analyses_trace`/`pattern_pieces`), même
 * convention que les autres téléchargements de fichiers de l'app (ex.
 * `/api/production/[id]/pdf`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: traceId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const marquage = url.searchParams.get("marquage") ?? "aucun";

  if (format !== "dxf" && format !== "pdf") {
    return NextResponse.json({ error: "Paramètre « format » invalide (dxf ou pdf attendu)." }, { status: 400 });
  }
  if (marquage !== "aucun" && marquage !== "horizontal" && marquage !== "vertical") {
    return NextResponse.json({ error: "Paramètre « marquage » invalide." }, { status: 400 });
  }

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

  const source = await chargerTraceSource(supabase, traceId, trace.fiche_id);
  if ("error" in source) return NextResponse.json({ error: source.error }, { status: 404 });

  const suffixe = marquage === "aucun" ? "" : `-marque-${marquage === "horizontal" ? "h" : "v"}`;
  const nomFichier = `${trace.reference}${suffixe}.${format}`.replace(/"/g, "");

  if (marquage === "aucun") {
    if (format === "dxf") {
      return new NextResponse(source.texte, {
        headers: { "Content-Type": "application/dxf", "Content-Disposition": `attachment; filename="${nomFichier}"` },
      });
    }
    const resultat = await genererTracePdf(source.contours, null);
    if ("error" in resultat) return NextResponse.json({ error: resultat.error }, { status: 422 });
    return new NextResponse(new Uint8Array(resultat.pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nomFichier}"` },
    });
  }

  // --- Marqué (H ou V) : il faut la bibliothèque, l'analyse et les infos de
  // la fiche pour construire le contenu du cartouche.
  const fiche = Array.isArray(trace.fiches_placement) ? trace.fiches_placement[0] : trace.fiches_placement;
  if (!fiche) return NextResponse.json({ error: "Fiche introuvable" }, { status: 404 });
  const ligneOdf = Array.isArray(fiche.production_order_lines) ? fiche.production_order_lines[0] : fiche.production_order_lines;
  const odf = ligneOdf ? (Array.isArray(ligneOdf.production_orders) ? ligneOdf.production_orders[0] : ligneOdf.production_orders) : null;
  const odfReference = odf ? `${odf.reference}${ligneOdf?.description ? ` — ${ligneOdf.description}` : ""}` : null;

  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return NextResponse.json({ error: library.error }, { status: 500 });

  // Même échelle que celle affichée/enregistrée pour ce tracé (cf.
  // trace-source.ts) : le marquage ne doit jamais raconter une autre analyse
  // que celle que l'écran montre pour ce même tracé.
  const facteurForce = await facteurEnregistreTrace(supabase, traceId);
  const detail = construireAnalyseDetaillee(source.contours, library.references, SEUIL_RECONNAISSANCE, { facteurForce });

  const baseUrl = await getBaseUrl();
  const info: CartoucheInfo = {
    traceReference: trace.reference,
    numeroOt: fiche.numero_ot,
    odfReference,
    clientLabel: fiche.client_libelle,
    articleLabel: fiche.designation_article,
    dateLabel: formatDate(new Date().toISOString()),
    url: `${baseUrl}/atelier/patronnage/${trace.fiche_id}?trace=${traceId}`,
    facteurEchelle: detail.scaleFactor,
  };
  const orientation = marquage as OrientationCartouche;
  const lignes: LignePieceDetail[] = detail.lignes;

  if (format === "dxf") {
    const resultat = genererDxfMarque(source.texte, source.contours, lignes, info, orientation);
    if ("error" in resultat) return NextResponse.json({ error: resultat.error }, { status: 422 });
    return new NextResponse(resultat.dxf, {
      headers: { "Content-Type": "application/dxf", "Content-Disposition": `attachment; filename="${nomFichier}"` },
    });
  }

  const resultat = await genererTracePdf(source.contours, { lignes, info, orientation });
  if ("error" in resultat) return NextResponse.json({ error: resultat.error }, { status: 422 });
  return new NextResponse(new Uint8Array(resultat.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nomFichier}"` },
  });
}
