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
import {
  PRODUCTION_ORDER_STATUS_LABELS,
  SAMPLE_STATUS_LABELS,
  type ProductionOrderStatus,
  type SampleRequestStatus,
} from "@/lib/types/domain";

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
    .select("*,companies(name,address),quotes(reference,date_livraison_prevue)")
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
        "id,description,quantity,product_model_id,quote_line_id,couleur_unique_id,product_models(name,textiles(nom,composition,grammage,laize_cm)),couleur_unique:couleur_unique_id(name,code),zone_colors:production_order_line_zone_colors(zone_key,colors:color_id(name,code)),sizes:production_order_sizes(taille,quantite_demandee),line_sections:production_order_line_sections(ordre,sections(name,atelier_categories(requiert_visuel)))"
      )
      .eq("production_order_id", id)
      .order("created_at"),
    supabase
      .from("work_orders")
      .select("id,reference,quantity_planned,quantity_done,sections(name,display_order)")
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
  // par ODF entier) — récupérée après `lines` puisqu'elle s'y filtre. Seul
  // le numéro sert désormais (annoté à côté de « Coupe » dans Sections
  // retenues) : le statut de la fiche n'a plus de champ dédié sur le PDF.
  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: fiches } =
    lineIds.length > 0
      ? await supabase
          .from("fiches_placement")
          .select("numero_ot,production_order_line_id")
          .in("production_order_line_id", lineIds)
      : { data: [] as { numero_ot: string; production_order_line_id: string }[] };

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

  // Visuel(s) et maquette hérités du devis (migration 0041) : la maquette du
  // devis fait foi dès qu'elle existe (l'ODF ne propose la sienne, ci-dessus,
  // que pour rattraper une absence) ; le visuel s'y ajoute (union).
  const quoteLineIds = (lines ?? []).map((l) => l.quote_line_id).filter((v): v is string => !!v);
  const { data: quoteLineMedia } =
    quoteLineIds.length > 0
      ? await supabase
          .from("quote_line_media_files")
          .select("quote_line_id,media_file_id,media_files(file_name,category)")
          .in("quote_line_id", quoteLineIds)
      : { data: [] as { quote_line_id: string; media_file_id: string; media_files: { file_name: string; category: string } | null }[] };

  const visuelsByQuoteLine = new Map<string, string[]>();
  const maquetteByQuoteLine = new Map<string, { id: string; file_name: string }>();
  for (const m of quoteLineMedia ?? []) {
    const media = m.media_files as unknown as { file_name: string; category: string } | null;
    if (!media) continue;
    if (media.category === "maquette") {
      if (!maquetteByQuoteLine.has(m.quote_line_id)) maquetteByQuoteLine.set(m.quote_line_id, { id: m.media_file_id, file_name: media.file_name });
    } else if (media.category === "visuel") {
      const list = visuelsByQuoteLine.get(m.quote_line_id) ?? [];
      list.push(media.file_name);
      visuelsByQuoteLine.set(m.quote_line_id, list);
    }
  }

  // Résolution finale par article — la maquette côté devis prend le pas sur
  // celle éventuellement déposée directement sur l'ODF.
  const resolvedMaquetteByLine = new Map<string, { id: string; file_name: string }>();
  for (const line of lines ?? []) {
    const fromDevis = line.quote_line_id ? maquetteByQuoteLine.get(line.quote_line_id) : undefined;
    const resolved = fromDevis ?? maquetteByLine.get(line.id);
    if (resolved) resolvedMaquetteByLine.set(line.id, resolved);
  }

  // Octets des maquettes (migration 0040), une par article au plus — voir
  // src/lib/media/preview.ts. Récupérés ici (indépendants de la mise en
  // page), embarqués dans le PDF par odf-pdf.ts.
  const maquetteBuffers = await getMediaFileBuffers(Array.from(resolvedMaquetteByLine.values()).map((m) => m.id));

  const userIds = [
    order.launched_by,
    order.cloture_demandee_par,
    order.closed_by,
    order.comptabilite_validee_par,
    order.infographie_validee_par,
    order.soumis_par,
  ].filter((v): v is string => !!v);
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  const company = order.companies as unknown as { name: string; address: string | null } | null;
  const quote = order.quotes as unknown as { reference: string; date_livraison_prevue: string | null } | null;
  const baseUrl = await getBaseUrl();

  // Zones imprimables retenues par article (migration 0040), pour
  // l'annotation « Sérigraphie (zone1, zone2…) » dans Sections retenues
  // ci-dessous — même principe que les fiches Patronnage juste au-dessus :
  // récupérées après `lines` puisqu'elles s'y filtrent.
  const { data: printableZonesRows } =
    lineIds.length > 0
      ? await supabase
          .from("production_order_line_printable_zones")
          .select("production_order_line_id,product_printable_zones(zone_label,display_order)")
          .in("production_order_line_id", lineIds)
      : { data: [] as { production_order_line_id: string; product_printable_zones: { zone_label: string; display_order: number } | null }[] };
  const printableZonesByLine = new Map<string, string[]>();
  for (const row of (printableZonesRows ?? [])
    .slice()
    .sort((a, b) => {
      const za = a.product_printable_zones as unknown as { display_order: number } | null;
      const zb = b.product_printable_zones as unknown as { display_order: number } | null;
      return (za?.display_order ?? 0) - (zb?.display_order ?? 0);
    })) {
    const zone = row.product_printable_zones as unknown as { zone_label: string; display_order: number } | null;
    if (!zone) continue;
    const list = printableZonesByLine.get(row.production_order_line_id) ?? [];
    list.push(zone.zone_label);
    printableZonesByLine.set(row.production_order_line_id, list);
  }

  // Circuit de validation (migration 0050) : infographie requise seulement
  // si une section retenue, sur n'importe quel article, appartient à une
  // catégorie qui exige un visuel — même condition que submit_production_
  // order() côté serveur (voir aussi /atelier/production/[id]/page.tsx).
  const requiresInfographie = (lines ?? []).some((line) =>
    (line.line_sections ?? []).some(
      (s) => (s.sections as unknown as { atelier_categories: { requiert_visuel: boolean } | null } | null)?.atelier_categories?.requiert_visuel
    )
  );

  // Échantillons liés, tous statuts (migration 0050) : au moins un
  // 'valide' par article qui en porte un suffit — même règle que
  // submit_production_order().
  const { data: sampleRows } =
    lineIds.length > 0
      ? await supabase.from("sample_requests").select("production_order_line_id,status").in("production_order_line_id", lineIds)
      : { data: [] as { production_order_line_id: string | null; status: string }[] };
  const sampleStatusesByLine = new Map<string, string[]>();
  for (const s of sampleRows ?? []) {
    if (!s.production_order_line_id) continue;
    const list = sampleStatusesByLine.get(s.production_order_line_id) ?? [];
    list.push(s.status);
    sampleStatusesByLine.set(s.production_order_line_id, list);
  }

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
    const visuels = [
      ...(line.quote_line_id ? visuelsByQuoteLine.get(line.quote_line_id) ?? [] : []),
      ...(visuelsByLine.get(line.id) ?? []),
    ];
    const maquette = resolvedMaquetteByLine.get(line.id);
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
      // Coupe et Sérigraphie s'annotent entre parenthèses (demande Ayman
      // 17/09) : le numéro d'OT pour l'une (remplace le champ « Fiche
      // patronnage » séparé, désormais retiré), les zones imprimables
      // retenues pour l'autre. Comparaison par nom exact, même convention
      // que le reste du code (s.name = 'Coupe', migration 0010 et
      // suivantes) — pas de clé stable sur `sections`.
      sections:
        (line.line_sections ?? [])
          .slice()
          .sort((a, b) => a.ordre - b.ordre)
          .map((s) => (s.sections as unknown as { name: string; atelier_categories: { requiert_visuel: boolean } | null } | null)?.name)
          .filter((name): name is string => !!name)
          .map((name) => {
            if (name === "Coupe" && ficheForLine) return `${name} (${ficheForLine.numero_ot})`;
            if (name === "Sérigraphie") {
              const zones = printableZonesByLine.get(line.id) ?? [];
              return zones.length > 0 ? `${name} (${zones.join(", ")})` : name;
            }
            return name;
          })
          .join(", ") || null,
      visuels: visuels.length > 0 ? visuels.join(", ") : null,
      maquette:
        maquette && maquetteBuffer && maquetteFormat
          ? { fileName: maquette.file_name, bytes: maquetteBuffer.buffer, format: maquetteFormat }
          : null,
      sizes: (line.sizes ?? []).map((s) => ({ taille: s.taille, quantite: s.quantite_demandee })),
    };
  });

  // Sous-ODF générés à la validation de l'ODF, groupés par section dans le
  // PDF (demande Ayman, 17/09) — plus de QR par ligne : un chef de section
  // scanne le QR d'en-tête depuis /atelier/section, qui le redirige déjà
  // vers les sous-ODF de sa propre section.
  const sousOdf: OdfPdfData["sousOdf"] = (workOrders ?? []).map((wo) => {
    const section = wo.sections as unknown as { name: string; display_order: number } | null;
    return {
      reference: wo.reference,
      section: section?.name ?? "—",
      sectionDisplayOrder: section?.display_order ?? 0,
      planned: wo.quantity_planned,
      done: wo.quantity_done,
    };
  });

  // Circuit de validation avant soumission (migration 0050) — remplace la
  // traçabilité du cycle de vie sur le PDF (demande Ayman 18/09) : ce
  // document s'imprime avant le lancement en production, donc avant
  // qu'aucun événement de cycle de vie n'existe encore. Même forme
  // {event,date,by} que l'ancienne table lifecycle pour réutiliser le même
  // dessin (drawEventTable ci-dessous).
  const circuitValidation: OdfPdfData["circuitValidation"] = [
    {
      event: "Comptabilité — compte client",
      date: order.comptabilite_validee_le ? formatFr(order.comptabilite_validee_le) : "En attente",
      by: order.comptabilite_validee_par ? nameOf(order.comptabilite_validee_par) : "-",
    },
    {
      event: requiresInfographie ? "Infographie — visuels" : "Infographie — non requis",
      date: !requiresInfographie ? "-" : order.infographie_validee_le ? formatFr(order.infographie_validee_le) : "En attente",
      by: !requiresInfographie ? "-" : order.infographie_validee_par ? nameOf(order.infographie_validee_par) : "-",
    },
    ...(lines ?? [])
      .filter((line) => (sampleStatusesByLine.get(line.id) ?? []).length > 0)
      .map((line) => {
        const statuses = sampleStatusesByLine.get(line.id) ?? [];
        const validated = statuses.includes("valide");
        return {
          event: `Échantillon — ${line.description}`,
          date: validated ? "Validé" : statuses.map((s) => SAMPLE_STATUS_LABELS[s as SampleRequestStatus] ?? s).join(", "),
          by: "-",
        };
      }),
    {
      event: "Chef de production — soumission",
      date: order.soumis_le ? formatFr(order.soumis_le) : "En attente",
      by: order.soumis_par ? nameOf(order.soumis_par) : "-",
    },
  ];

  const data: OdfPdfData = {
    reference: order.reference,
    statusLabel: PRODUCTION_ORDER_STATUS_LABELS[order.status as ProductionOrderStatus],
    sheetUrl: `${baseUrl}/atelier/production/${order.id}`,
    generatedAt: formatFr(new Date().toISOString()),
    client: company,
    dateValidation: order.launched_at ? formatFr(order.launched_at) : null,
    dateLivraison: quote?.date_livraison_prevue ? formatFr(quote.date_livraison_prevue) : null,
    devis: quote?.reference ?? null,
    totalQuantity: order.total_quantity,
    plannedStart: order.planned_start_date ? formatFr(order.planned_start_date) : null,
    plannedEnd: order.planned_end_date ? formatFr(order.planned_end_date) : null,
    articles,
    sousOdf,
    surplusTraces: order.mention_surplus_traces
      ? Object.entries(order.mention_surplus_traces as Record<string, number>)
      : [],
    circuitValidation,
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

function formatFr(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
