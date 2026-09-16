import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { getMediaFileBuffers } from "@/lib/media/preview";
import { PRODUCTION_ORDER_STATUS_LABELS, type ProductionOrderStatus } from "@/lib/types/domain";

/**
 * Génération du bon imprimable de l'ordre de fabrication — même principe
 * que la fiche échantillon (api/echantillons/[id]/pdf) : construit à la
 * demande, jamais mis en cache, reflète toujours l'état courant de l'ODF.
 *
 * Refonte (demande Ayman, 16/09) : en-tête client/commande structuré en
 * deux colonnes, un bloc par article reprenant toute sa « Configuration
 * produit » (modèle, tissu, couleur, sections, fiche Patronnage, visuels —
 * même détail que /atelier/production/[id] depuis les migrations
 * 0035/0037), et un QR code par sous-ODF pour ouvrir directement son détail
 * depuis un téléphone en atelier (au même titre que le QR de la fiche
 * échantillon) — le point explicitement demandé pour la saisie terminal.
 *
 * Porte toujours les mentions du document de logique consolidée (section
 * 4) : le nom de la personne qui a validé le lancement et celui qui a
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
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label"),
    // Visuels ET maquettes joints par article (migrations 0037/0040) —
    // distingués par catégorie, contrairement à avant la migration 0040 où
    // seul le visuel pouvait être scopé par article.
    supabase
      .from("production_order_media_files")
      .select("production_order_line_id,media_file_id,media_files(file_name,category)")
      .eq("production_order_id", id)
      .not("production_order_line_id", "is", null),
  ]);

  // Une fiche par article passant en Coupe (migration 0037, plus une seule
  // par ODF entier) — récupérée après `lines` puisqu'elle s'y filtre.
  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: fiches } =
    lineIds.length > 0
      ? await supabase.from("fiches_placement").select("numero_ot,statut,production_order_line_id").in("production_order_line_id", lineIds)
      : { data: [] as { numero_ot: string; statut: string; production_order_line_id: string }[] };

  const visuelsByLine = new Map<string, string[]>();
  const maquettesByLine = new Map<string, { id: string; file_name: string }[]>();
  for (const m of mediaFiles ?? []) {
    const lineId = m.production_order_line_id as string;
    const media = m.media_files as unknown as { file_name: string; category: string } | null;
    if (!media) continue;
    if (media.category === "maquette") {
      const list = maquettesByLine.get(lineId) ?? [];
      list.push({ id: m.media_file_id as string, file_name: media.file_name });
      maquettesByLine.set(lineId, list);
    } else if (media.category === "visuel") {
      const list = visuelsByLine.get(lineId) ?? [];
      list.push(media.file_name);
      visuelsByLine.set(lineId, list);
    }
  }

  // Octets des maquettes (migration 0040) — récupérés ici, avant la création
  // du PDF, car indépendants de `pdfDoc` ; embarqués dans le document plus
  // bas, aux côtés des QR codes : même convention pour ne jamais entrelacer
  // un await avec le dessin synchrone des pages.
  const maquetteIds = Array.from(maquettesByLine.values())
    .flat()
    .map((m) => m.id);
  const maquetteBuffers = await getMediaFileBuffers(maquetteIds);

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
  const sheetUrl = `${baseUrl}/atelier/production/${order.id}`;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Ordre de fabrication ${order.reference}`);
  pdfDoc.setProducer("Seritex");

  const PAGE_WIDTH = 595.28; // A4 portrait, points
  const PAGE_HEIGHT = 841.89;
  const MARGIN = 50;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  const COL_WIDTH = (CONTENT_WIDTH - 20) / 2;
  const COL2_X = MARGIN + COL_WIDTH + 20;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // QR d'en-tête (ODF entier) + un par sous-ODF (saisie terminal, demande
  // explicite) — tous embarqués avant le rendu pour ne pas mélanger await
  // et dessin au fil de l'eau.
  const headerQrPng = await QRCode.toBuffer(sheetUrl, { type: "png", width: 260, margin: 1 });
  const headerQrImage = await pdfDoc.embedPng(headerQrPng);
  const workOrderQrImages = new Map<string, PDFImage>();
  for (const wo of workOrders ?? []) {
    const woUrl = `${baseUrl}/atelier/production/${order.id}/ot/${wo.id}`;
    const png = await QRCode.toBuffer(woUrl, { type: "png", width: 160, margin: 1 });
    workOrderQrImages.set(wo.id, await pdfDoc.embedPng(png));
  }

  // Maquettes (migration 0040) : embarquées elles aussi avant le rendu. Un
  // type MIME ni PNG ni JPEG, ou un fichier corrompu que pdf-lib refuse
  // malgré un type déclaré correct, laisse simplement ce média absent de la
  // map — la boucle de rendu affiche alors une mention texte à la place.
  const maquetteImages = new Map<string, PDFImage>();
  for (const [mediaFileId, { buffer, mimeType }] of maquetteBuffers) {
    try {
      if (mimeType === "image/png") maquetteImages.set(mediaFileId, await pdfDoc.embedPng(buffer));
      else if (mimeType === "image/jpeg" || mimeType === "image/jpg") maquetteImages.set(mediaFileId, await pdfDoc.embedJpg(buffer));
    } catch {
      // format non pris en charge par pdf-lib — géré par l'absence dans la map
    }
  }

  const brand = rgb(0.059, 0.298, 0.361); // #0f4c5c
  const ink = rgb(0.11, 0.09, 0.09);
  const muted = rgb(0.42, 0.4, 0.38);
  const rule = rgb(0.9, 0.88, 0.85);
  const boxFill = rgb(0.97, 0.965, 0.955);

  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function wrap(str: string, maxWidth: number, size: number, useFont: PDFFont): string[] {
    const words = str.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (useFont.widthOfTextAtSize(attempt, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  /** Dimensions maximales d'une image dans une boîte donnée, en conservant ses proportions (jamais déformée) — utilisé pour imprimer une maquette au format le plus grand possible. */
  function fitImage(image: PDFImage, maxWidth: number, maxHeight: number) {
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
    return { width: image.width * ratio, height: image.height * ratio };
  }

  function drawField(label: string, value: string, opts: { x?: number; width?: number } = {}) {
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? CONTENT_WIDTH;
    ensureSpace(30);
    page.drawText(label.toUpperCase(), { x, y, size: 8, font: fontBold, color: muted });
    y -= 12;
    for (const line of wrap(value || "—", width, 11, font)) {
      ensureSpace(15);
      page.drawText(line, { x, y, size: 11, font, color: ink });
      y -= 15;
    }
    y -= 6;
  }

  function drawSectionTitle(str: string) {
    ensureSpace(30);
    y -= 6;
    page.drawText(str, { x: MARGIN, y, size: 12, font: fontBold, color: brand });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: rule });
    y -= 16;
  }

  /** Hauteur qu'occupera drawField pour cette valeur, sans rien dessiner. */
  function fieldHeight(value: string, width: number): number {
    return 12 + wrap(value || "—", width, 11, font).length * 15 + 6;
  }

  /**
   * Deux colonnes de champs (client à gauche, commande à droite) sur un
   * cadre dessiné une seule fois : la hauteur du bloc est calculée AVANT de
   * tracer quoi que ce soit (pdf-lib ne permet pas d'intercaler un
   * rectangle derrière du texte déjà posé), puis chaque colonne est
   * dessinée avec son propre curseur — les deux listes n'ont pas besoin du
   * même nombre de lignes, le cadre couvre la plus haute des deux.
   */
  function drawTwoColumnBox(left: [string, string][], right: [string, string][]) {
    const colWidth = COL_WIDTH - 24;
    const leftHeight = left.reduce((sum, [, value]) => sum + fieldHeight(value, colWidth), 0);
    const rightHeight = right.reduce((sum, [, value]) => sum + fieldHeight(value, colWidth), 0);
    const padding = 12;
    const boxHeight = Math.max(leftHeight, rightHeight) + padding * 2;

    ensureSpace(boxHeight + 10);
    const boxTop = y;
    const boxBottom = boxTop - boxHeight;
    page.drawRectangle({
      x: MARGIN,
      y: boxBottom,
      width: CONTENT_WIDTH,
      height: boxHeight,
      color: boxFill,
      borderColor: rule,
      borderWidth: 1,
    });

    y = boxTop - padding;
    for (const [label, value] of left) drawField(label, value, { x: MARGIN + 12, width: colWidth });
    const leftEndY = y;

    y = boxTop - padding;
    for (const [label, value] of right) drawField(label, value, { x: COL2_X, width: colWidth });
    const rightEndY = y;

    y = Math.min(leftEndY, rightEndY, boxBottom) - 20;
  }

  // En-tête
  page.drawText("SERITEX", { x: MARGIN, y, size: 20, font: fontBold, color: brand });
  y -= 22;
  page.drawText("Ordre de fabrication", { x: MARGIN, y, size: 12, font, color: muted });
  y -= 14;
  page.drawText(PRODUCTION_ORDER_STATUS_LABELS[order.status as ProductionOrderStatus], {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
    color: ink,
  });

  // QR d'en-tête en haut à droite, aligné sur le bloc "SERITEX".
  const headerQrTop = PAGE_HEIGHT - MARGIN;
  const headerQrSize = 78;
  page.drawImage(headerQrImage, {
    x: PAGE_WIDTH - MARGIN - headerQrSize,
    y: headerQrTop - headerQrSize,
    width: headerQrSize,
    height: headerQrSize,
  });
  page.drawText(order.reference, {
    x: PAGE_WIDTH - MARGIN - headerQrSize,
    y: headerQrTop - headerQrSize - 11,
    size: 8,
    font: fontBold,
    color: ink,
  });

  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: rule });
  y -= 20;

  // Bloc client (gauche) / commande (droite), sur fond légèrement teinté —
  // "infos du client, en passant par le devis, jusqu'à la commande" en un
  // seul coup d'œil plutôt qu'empilées.
  const clientRows: [string, string][] = [
    ["Client", company?.name ?? "—"],
    ["Adresse", company?.address ?? "—"],
    ["Téléphone · Email", [company?.phone, company?.email].filter(Boolean).join(" · ") || "—"],
  ];
  const commandeRows: [string, string][] = [
    ["Référence ODF", order.reference],
    ["Devis d'origine", quote?.reference ?? "—"],
    ["Quantité totale", `${order.total_quantity} pièces`],
    ["Début - fin planifiés", `${order.planned_start_date ? formatFr(order.planned_start_date) : "—"} - ${order.planned_end_date ? formatFr(order.planned_end_date) : "—"}`],
  ];
  drawTwoColumnBox(clientRows, commandeRows);

  // Articles — reprend le détail de "Configuration produit" (écran ODF) :
  // modèle/tissu/couleur/sections/tailles/fiche/visuels, article par
  // article plutôt qu'une ligne "Composition" globale.
  drawSectionTitle(`Articles (${(lines ?? []).length})`);
  if (lines && lines.length > 0) {
    lines.forEach((l, index) => {
      ensureSpace(40);
      page.drawText(`Article ${index + 1} — ${l.description} (${l.quantity} pièces)`, {
        x: MARGIN,
        y,
        size: 11,
        font: fontBold,
        color: brand,
      });
      y -= 18;

      const productModel = l.product_models as unknown as {
        name: string;
        textiles: { nom: string; composition: string | null; grammage: number | null; laize_cm: number | null } | null;
      } | null;
      if (productModel) {
        const textile = productModel.textiles;
        drawField(
          "Modèle · Tissu",
          `${productModel.name}${textile ? ` — ${textile.nom}${textile.composition ? ` (${textile.composition})` : ""}${textile.grammage ? ` · ${textile.grammage} g/m²` : ""}${textile.laize_cm ? ` · laize ${textile.laize_cm} cm` : ""}` : ""}`
        );
      } else {
        drawField("Modèle", "non renseigné");
      }

      const couleurUnique = l.couleur_unique as unknown as { name: string; code: string } | null;
      if (couleurUnique) {
        drawField("Couleur", `${couleurUnique.name} (${couleurUnique.code})`);
      } else if (l.zone_colors && l.zone_colors.length > 0) {
        const zoneLabelByKey = new Map(
          (zoneTemplatesAll ?? [])
            .filter((z) => z.product_model_id === l.product_model_id)
            .map((z) => [z.zone_key, z.zone_label])
        );
        drawField(
          "Couleurs par zone",
          l.zone_colors
            .map((zc) => {
              const color = zc.colors as unknown as { name: string; code: string } | null;
              const label = zoneLabelByKey.get(zc.zone_key) ?? zc.zone_key;
              return color ? `${label} : ${color.name} (${color.code})` : `${label} : —`;
            })
            .join(" · ")
        );
      } else {
        drawField("Couleur", "non renseignée");
      }

      const sectionNames =
        (l.line_sections ?? [])
          .slice()
          .sort((a, b) => a.ordre - b.ordre)
          .map((s) => (s.sections as unknown as { name: string } | null)?.name)
          .filter(Boolean)
          .join(", ") || "aucune";
      drawField("Sections retenues", sectionNames);

      drawField(
        "Dispatching des tailles",
        (l.sizes ?? []).map((s) => `${s.taille} : ${s.quantite_demandee}`).join(" · ") || "non renseigné"
      );

      const ficheForLine = (fiches ?? []).find((f) => f.production_order_line_id === l.id);
      if (ficheForLine) {
        drawField("Fiche Patronnage liée", `${ficheForLine.numero_ot} (${ficheForLine.statut})`);
      }

      const visuels = visuelsByLine.get(l.id);
      if (visuels && visuels.length > 0) {
        drawField("Visuel(s) joint(s)", visuels.join(", "));
      }

      y -= 6;
      ensureSpace(1);
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: rule });
      y -= 16;

      // Maquette(s) (migration 0040) : imprimée telle quelle, sur sa propre
      // page pour pouvoir occuper le format le plus grand possible sans
      // être compressée dans la mise en page à deux colonnes du texte —
      // demande explicite ("garder un format maximal"). Un fichier sans
      // rendu embarqué (format non pris en charge, copie manquante) se
      // signale par une simple mention texte plutôt que de bloquer le PDF.
      for (const maquette of maquettesByLine.get(l.id) ?? []) {
        const embedded = maquetteImages.get(maquette.id);
        if (!embedded) {
          drawField("Maquette", `${maquette.file_name} (aperçu non disponible dans ce PDF)`);
          continue;
        }

        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
        page.drawText(`Article ${index + 1} — ${l.description} — Maquette`, {
          x: MARGIN,
          y,
          size: 12,
          font: fontBold,
          color: brand,
        });
        y -= 16;
        page.drawText(maquette.file_name, { x: MARGIN, y, size: 9, font, color: muted });
        y -= 20;

        const maxWidth = CONTENT_WIDTH;
        const maxHeight = y - MARGIN;
        const { width: imgWidth, height: imgHeight } = fitImage(embedded, maxWidth, maxHeight);
        page.drawImage(embedded, {
          x: MARGIN + (maxWidth - imgWidth) / 2,
          y: y - imgHeight,
          width: imgWidth,
          height: imgHeight,
        });

        // Marque la page comme épuisée : le prochain ensureSpace() (titre de
        // la maquette suivante, ou reprise du texte) ouvrira naturellement
        // une nouvelle page plutôt que de dessiner sous l'image.
        y = MARGIN;
      }
    });
  } else {
    drawField("Articles", "aucun");
  }

  if (order.mention_surplus_traces) {
    drawField(
      "Surplus tracé vs quantité demandée",
      Object.entries(order.mention_surplus_traces as Record<string, number>)
        .map(([taille, surplus]) => `${taille} : +${surplus}`)
        .join(" · ")
    );
  }

  // Sous-ODF — un QR par ligne (demande explicite, "important pour la
  // saisie par terminal") : scanné depuis un téléphone en atelier, ouvre
  // directement le détail de CE sous-ODF plutôt que de le chercher dans la
  // file de la section.
  if (workOrders && workOrders.length > 0) {
    drawSectionTitle("Avancement des sous-ODF");
    for (const wo of workOrders) {
      const rowHeight = 46;
      ensureSpace(rowHeight);
      const sectionName = (wo.sections as unknown as { name: string } | null)?.name ?? "—";
      const qrSize = 40;
      const qrImage = workOrderQrImages.get(wo.id);
      if (qrImage) {
        page.drawImage(qrImage, { x: MARGIN, y: y - qrSize + 10, width: qrSize, height: qrSize });
      }
      const textX = MARGIN + qrSize + 12;
      page.drawText(`${sectionName} — ${wo.reference}`, { x: textX, y, size: 10, font: fontBold, color: ink });
      y -= 14;
      page.drawText(`${wo.quantity_done} / ${wo.quantity_planned} pièces`, { x: textX, y, size: 9, font, color: muted });
      y -= rowHeight - 14;
    }
  }

  drawSectionTitle("Cycle de vie");
  if (order.launched_at) {
    drawField("Lancé le", `${formatFr(order.launched_at)} par ${nameOf(order.launched_by)}`);
  }
  if (order.cloture_demandee_at) {
    drawField("Clôture demandée le", `${formatFr(order.cloture_demandee_at)} par ${nameOf(order.cloture_demandee_par)}`);
  }
  if (order.closed_at) {
    drawField("Clôturé le", `${formatFr(order.closed_at)} par ${nameOf(order.closed_by)}`);
  }
  if (order.cloture_note) {
    drawField("Note de clôture", order.cloture_note);
  }

  page.drawText(`Document généré le ${formatFr(new Date().toISOString())} — ${sheetUrl}`, {
    x: MARGIN,
    y: MARGIN / 2,
    size: 7,
    font,
    color: muted,
  });

  const pdfBytes = await pdfDoc.save();

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
