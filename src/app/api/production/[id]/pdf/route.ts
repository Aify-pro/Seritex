import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getMediaFileBuffers } from "@/lib/media/preview";
import {
  buildOdfPdf,
  type OdfPdfArticle,
  type OdfPdfColor,
  type OdfPdfData,
} from "@/lib/pdf/odf-pdf";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";
import type { StatutFiche } from "@/lib/patronnage/types";

/**
 * Bon imprimable de l'ordre de fabrication — construit à la demande, jamais
 * mis en cache, reflète toujours l'état courant de l'ODF.
 *
 * Cette route ne fait que lire Supabase et aplatir le résultat : toute la
 * mise en page vit dans `@/lib/pdf/odf-pdf` (voir le commentaire d'en-tête
 * de ce module pour la structure du document et pourquoi elle en est
 * séparée).
 *
 * Le document porte toujours les mentions du document de logique
 * consolidée (section 4) : qui a validé le lancement, qui a demandé puis
 * validé la clôture définitive.
 *
 * L'authentification suit le même client Supabase (cookies de session) que
 * le reste de l'application — la RLS s'applique identiquement.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name,address,phone,email,siret),quotes(reference)")
    .eq("id", id)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Ordre de fabrication introuvable" }, { status: 404 });

  const [{ data: lines }, { data: workOrders }, { data: zoneTemplatesAll }, { data: mediaFiles }] = await Promise.all([
    // ODF multi-lignes : modèle/tissu/couleur/tailles/sections par article
    // (migrations 0035/0037) — même jointure que la Configuration produit
    // écran (/atelier/production/[id]/page.tsx).
    supabase
      .from("production_order_lines")
      .select(
        "id,description,quantity,product_model_id,couleur_unique_id,product_models(name,textiles(nom,composition,grammage,laize_cm)),couleur_unique:couleur_unique_id(name,code),zone_colors:production_order_line_zone_colors(zone_key,colors:color_id(name,code)),sizes:production_order_sizes(taille,quantite_demandee),line_sections:production_order_line_sections(ordre,sections(name))"
      )
      .eq("production_order_id", id)
      .order("created_at"),
    supabase
      .from("work_orders")
      .select("id,reference,quantity_planned,quantity_done,sections(name)")
      .eq("production_order_id", id)
      .order("planned_start", { ascending: true }),
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label,display_order"),
    // Visuels ET maquettes joints par article (migrations 0037/0040) —
    // distingués par catégorie, contrairement à avant la migration 0040 où
    // seul le visuel pouvait être scopé par article.
    supabase
      .from("production_order_media_files")
      .select("production_order_line_id,media_file_id,media_files(file_name,category,mime_type)")
      .eq("production_order_id", id)
      .not("production_order_line_id", "is", null),
  ]);

  // Une fiche par article passant en Coupe (migration 0037, plus une seule
  // par ODF entier) — récupérée après `lines` puisqu'elle s'y filtre.
  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: fiches } =
    lineIds.length > 0
      ? await supabase
          .from("fiches_placement")
          .select("numero_ot,statut,production_order_line_id")
          .in("production_order_line_id", lineIds)
      : { data: [] as { numero_ot: string; statut: string; production_order_line_id: string }[] };

  const visuelsByLine = new Map<string, string[]>();
  // Une seule maquette par article (migration 0040, voir attachMediaFileToLine) —
  // le premier trouvé suffit, défensif si jamais plusieurs traînaient.
  const maquetteByLine = new Map<string, { id: string; file_name: string }>();
  for (const m of mediaFiles ?? []) {
    const lineId = m.production_order_line_id as string;
    const media = m.media_files as unknown as { file_name: string; category: string; mime_type: string | null } | null;
    if (!media) continue;
    if (media.category === "maquette") {
      if (!maquetteByLine.has(lineId)) maquetteByLine.set(lineId, { id: m.media_file_id as string, file_name: media.file_name });
    } else if (media.category === "visuel") {
      const list = visuelsByLine.get(lineId) ?? [];
      list.push(media.file_name);
      visuelsByLine.set(lineId, list);
    }
  }

  // Octets des maquettes (migration 0040), une par article au plus — voir
  // src/lib/media/preview.ts. Récupérés ici (indépendants de la mise en
  // page), embarqués dans le PDF par odf-pdf.ts.
  const maquetteBuffers = await getMediaFileBuffers(Array.from(maquetteByLine.values()).map((m) => m.id));

  const userIds = [order.launched_by, order.cloture_demandee_par, order.closed_by].filter(
    (v): v is string => !!v
  );
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  const company = order.companies as unknown as {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    siret: string | null;
  } | null;
  const quote = order.quotes as unknown as { reference: string } | null;
  const baseUrl = await getBaseUrl();

  const articles: OdfPdfArticle[] = (lines ?? []).map((line) => {
    const productModel = line.product_models as unknown as {
      name: string;
      textiles: { nom: string; composition: string | null; grammage: number | null; laize_cm: number | null } | null;
    } | null;
    const textile = productModel?.textiles ?? null;

    // Couleur unique de la ligne, sinon déclinaison par zone du modèle.
    // Le PDF dessine une pastille du ton réel : on lui passe le code du
    // référentiel tel quel (un hexadécimal CSS) plutôt qu'une phrase.
    const couleurUnique = line.couleur_unique as unknown as { name: string; code: string } | null;
    let couleurLabel = "Couleur";
    let couleurs: OdfPdfColor[] = [];
    if (couleurUnique) {
      couleurs = [{ zone: null, name: couleurUnique.name, code: couleurUnique.code }];
    } else if (line.zone_colors && line.zone_colors.length > 0) {
      const zones = (zoneTemplatesAll ?? []).filter((z) => z.product_model_id === line.product_model_id);
      const zoneByKey = new Map(zones.map((z) => [z.zone_key, z]));
      couleurLabel = "Couleurs par zone";
      couleurs = line.zone_colors
        .map((zc) => {
          const color = zc.colors as unknown as { name: string; code: string } | null;
          const zone = zoneByKey.get(zc.zone_key);
          return {
            zone: zone?.zone_label ?? zc.zone_key,
            name: color?.name ?? "non renseignée",
            code: color?.code ?? null,
            ordre: zone?.display_order ?? Number.MAX_SAFE_INTEGER,
          };
        })
        // Les zones sortent dans l'ordre du gabarit du modèle (corps avant,
        // corps arrière, col…) et pas dans l'ordre d'insertion en base.
        .sort((a, b) => a.ordre - b.ordre)
        .map(({ zone, name, code }) => ({ zone, name, code }));
    }

    const ficheForLine = (fiches ?? []).find((f) => f.production_order_line_id === line.id);
    const visuels = visuelsByLine.get(line.id);
    const maquette = maquetteByLine.get(line.id);
    const maquetteBuffer = maquette ? maquetteBuffers.get(maquette.id) : undefined;
    const maquetteFormat: "png" | "jpg" | null =
      maquetteBuffer?.mimeType === "image/png"
        ? "png"
        : maquetteBuffer?.mimeType === "image/jpeg" || maquetteBuffer?.mimeType === "image/jpg"
          ? "jpg"
          : null;

    return {
      description: line.description,
      quantity: line.quantity,
      modele: productModel?.name ?? null,
      tissu: textile?.nom ?? null,
      composition: textile?.composition ?? null,
      grammageLaize:
        [textile?.grammage ? `${textile.grammage} g/m²` : null, textile?.laize_cm ? `laize ${textile.laize_cm} cm` : null]
          .filter(Boolean)
          .join(" · ") || null,
      couleurLabel,
      couleurs,
      sections:
        (line.line_sections ?? [])
          .slice()
          .sort((a, b) => a.ordre - b.ordre)
          .map((s) => (s.sections as unknown as { name: string } | null)?.name)
          .filter(Boolean)
          .join(", ") || null,
      fiche: ficheForLine
        ? `${ficheForLine.numero_ot} (${FICHE_STATUT_LABELS[ficheForLine.statut as StatutFiche] ?? ficheForLine.statut})`
        : null,
      visuels: visuels && visuels.length > 0 ? visuels.join(", ") : null,
      maquette:
        maquette && maquetteBuffer && maquetteFormat
          ? { fileName: maquette.file_name, bytes: maquetteBuffer.buffer, format: maquetteFormat }
          : null,
      sizes: (line.sizes ?? []).map((s) => ({ taille: s.taille, quantite: s.quantite_demandee })),
    };
  });

  // Sous-ODF générés à la validation de l'ODF : un QR par ligne, qui ouvre
  // le détail de CE sous-ODF (saisie au terminal depuis l'atelier).
  const sousOdf: OdfPdfData["sousOdf"] = (workOrders ?? []).map((wo) => ({
    reference: wo.reference,
    section: (wo.sections as unknown as { name: string } | null)?.name ?? "—",
    planned: wo.quantity_planned,
    done: wo.quantity_done,
    url: `${baseUrl}/atelier/production/${order.id}/ot/${wo.id}`,
  }));

  const lifecycle: OdfPdfData["lifecycle"] = [];
  if (order.launched_at) lifecycle.push({ event: "Lancé en production", date: formatFr(order.launched_at), by: nameOf(order.launched_by) });
  if (order.refuse_le) lifecycle.push({ event: "Validation refusée", date: formatFr(order.refuse_le), by: nameOf(order.refuse_par) });
  if (order.cloture_demandee_at)
    lifecycle.push({ event: "Clôture demandée", date: formatFr(order.cloture_demandee_at), by: nameOf(order.cloture_demandee_par) });
  if (order.closed_at) lifecycle.push({ event: "Clôturé", date: formatFr(order.closed_at), by: nameOf(order.closed_by) });

  const data: OdfPdfData = {
    reference: order.reference,
    statusLabel: PRODUCTION_ORDER_STATUS_LABELS[order.status as ProductionOrderStatus],
    sheetUrl: `${baseUrl}/atelier/production/${order.id}`,
    generatedAt: formatFr(new Date().toISOString()),
    client: company,
    devis: quote?.reference ?? null,
    totalQuantity: order.total_quantity,
    plannedStart: order.planned_start_date ? formatFr(order.planned_start_date) : null,
    plannedEnd: order.planned_end_date ? formatFr(order.planned_end_date) : null,
    articles,
    sousOdf,
    surplusTraces: order.mention_surplus_traces
      ? Object.entries(order.mention_surplus_traces as Record<string, number>)
      : [],
    lifecycle,
    clotureNote: order.cloture_note ?? null,
  };

  const pdfBytes = await buildOdfPdf(data);

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="odf-${order.reference}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Mêmes libellés que la pastille de statut de la fiche (fiche-patronnage-link.tsx). */
const FICHE_STATUT_LABELS: Record<StatutFiche, string> = {
  demande: "Demande",
  traces_deposes: "Tracés déposés",
  bon_pour_coupe: "Bon pour coupe",
  archive: "Archivé",
};

function formatFr(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
