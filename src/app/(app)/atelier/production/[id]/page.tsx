import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import { formatDate, formatDateTime } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { ArchiveButton } from "./archive-button";
import { LifecycleActions } from "./lifecycle-actions";
import { ReplacementOrderPicker } from "./replacement-order-picker";
import { getSizesForProductModel } from "@/lib/sizes";
import { SubmitOdfPanel } from "./submit-odf-panel";
import { AnomaliesPanel } from "./anomalies-panel";
import { ProductionOrderLines, type LineData } from "./production-order-lines";
import { ProductionOrderMediaFiles, type AttachableMediaFile } from "./production-order-media-files";
import { getMediaFilePreviewUrls } from "@/lib/media/preview";
import { StockMovementsPanel } from "./stock-movements-panel";
import type { StatutFiche } from "@/lib/patronnage/types";
import type { DownloadableMediaFile, MaquetteFile, StockMovement, StockExportFiche } from "@/lib/types/domain";
import { CheckCircle2, ChevronRight, Package, QrCode } from "lucide-react";
import Link from "next/link";

const LOT_CATEGORIE_LABELS: Record<string, string> = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" };

export default async function ProductionOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireRole(["responsable_production", "administrateur", "gestionnaire_stock"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("production_orders")
    .select("*,companies(name),quotes(reference)")
    .eq("id", id)
    .single();

  if (!order) notFound();

  const [
    { data: workOrders },
    { data: allSections },
    { data: chosenLineSections },
    { data: productionOrderLines },
    { data: fiches },
    { data: anomalies },
    { data: articleLots },
    { data: reconciliation },
    { data: rendement },
    { data: rendementTraces },
    { data: productModels },
    { data: activeColors },
    { data: zoneTemplatesAll },
    { data: printableZonesAll },
    { data: chosenLinePrintableZones },
    { data: attachedGeneralMedia },
    { data: attachedLineMedia },
    { data: availableMedia },
    { data: stockMovements },
    { data: stockExportFiches },
  ] = await Promise.all([
    supabase.from("work_orders").select("*,sections(name)").eq("production_order_id", id).order("planned_start", { ascending: true }),
    supabase
      .from("sections")
      .select("id,name,atelier_categories(cle,requiert_fiche_trace,requiert_visuel)")
      .eq("active", true)
      .order("display_order"),
    // Sections retenues par article (migration 0037, plus par ODF entier) —
    // jointure vers production_order_lines pour filtrer par ODF, ces deux
    // tables n'ayant pas de production_order_id en commun.
    supabase
      .from("production_order_line_sections")
      .select("production_order_line_id,section_id,ordre,production_order_lines!inner(production_order_id)")
      .eq("production_order_lines.production_order_id", id)
      .order("ordre"),
    // ODF multi-lignes : une ligne par article du devis accepté, avec sa
    // configuration (modèle/tissu/couleur héritée du devis, immuable sauf
    // ligne de devis sans modèle) et son propre dispatching de tailles.
    supabase
      .from("production_order_lines")
      .select(
        "id,description,quantity,product_model_id,quote_line_id,couleur_unique_id,product_models(id,name,textile_id,textiles(nom,composition,grammage,laize_cm)),couleur_unique:couleur_unique_id(id,name,code),zone_colors:production_order_line_zone_colors(zone_key,colors:color_id(id,name,code)),sizes:production_order_sizes(taille,quantite_demandee),quote_lines(product_model_id)"
      )
      .eq("production_order_id", id)
      .order("created_at"),
    // Une fiche par article passant en Coupe (migration 0037, plus une seule
    // par ODF entier) — même jointure que ci-dessus pour filtrer par ODF.
    supabase
      .from("fiches_placement")
      .select("id,numero_ot,statut,production_order_line_id,production_order_lines!inner(production_order_id)")
      .eq("production_order_lines.production_order_id", id),
    supabase
      .from("production_order_anomalies")
      .select("id,message,created_at,resolved_at,resolved_by,sections(name)")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("article_lots")
      .select("id,code,categorie,created_at")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    // Lot 7 : réconciliation poids entrant / sortant (section 16 du document
    // de logique) — fonction plutôt que vue, voir migration 0017.
    supabase.rpc("get_production_order_reconciliation", { p_production_order_id: id }).single(),
    // Lot 8 : rendement matière — vue calculée à partir des lots 4 et 7,
    // voir migration 0018. maybeSingle() : la vue n'a une ligne pour cet ODF
    // que si au moins un matelas y a déjà été clôturé.
    supabase.from("rendement_par_odf").select("*").eq("odf_id", id).maybeSingle(),
    // Détail par matelas, pour le lien direct vers chaque tracé dans le
    // module Patronnage (voir carte "Rendement matière" plus bas).
    supabase
      .from("rendement_par_trace")
      .select("trace_id,fiche_id,reference,cloture_le,pieces_obtenues,rendement_estime_pieces_par_kg")
      .eq("odf_id", id)
      .order("cloture_le", { ascending: false }),
    // Lot 9 : configurateur couleur par zone (section 8/9 du document de logique).
    supabase.from("product_models").select("id,name").eq("active", true).order("name"),
    supabase.from("colors").select("id,name,code").eq("active", true).order("name"),
    // Gabarits de zones de tous les modèles — chaque ligne peut avoir un
    // modèle différent (ODF multi-lignes), un seul aller-retour plutôt
    // qu'une requête par ligne.
    supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label,display_order"),
    // Zones imprimables de tous les modèles (migration 0039), même
    // principe que le gabarit de zones couleur ci-dessus — un aller-retour
    // pour toutes les lignes plutôt qu'un par ligne.
    supabase.from("product_printable_zones").select("id,product_model_id,zone_key,zone_label,display_order"),
    // Zones imprimables cochées par article (migration 0040) — même
    // jointure que chosenLineSections pour filtrer par ODF.
    supabase
      .from("production_order_line_printable_zones")
      .select("production_order_line_id,printable_zone_id,production_order_lines!inner(production_order_id)")
      .eq("production_order_lines.production_order_id", id),
    supabase
      .from("production_order_media_files")
      .select("media_file_id,media_files(id,file_name,category)")
      .eq("production_order_id", id)
      .is("production_order_line_id", null),
    // Visuel + maquette par article (migrations 0037/0040, plus par ODF entier).
    supabase
      .from("production_order_media_files")
      .select("production_order_line_id,media_file_id,media_files(id,file_name,category)")
      .eq("production_order_id", id)
      .not("production_order_line_id", "is", null),
    supabase.from("media_files").select("id,file_name,category").eq("company_id", order.company_id),
    // Lot 10 : mouvements de stock & fiches d'import Sage (section 19 du
    // document de logique) — dérivés de record_pesee/create_article_lot,
    // jamais saisis directement (migration 0020).
    supabase
      .from("stock_movements")
      .select("id,production_order_id,type,article_ref,quantite_ou_poids,unite,exported_in_fiche_id,created_by,created_at")
      .eq("production_order_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("stock_export_fiches")
      .select("id,numero,production_order_id,generated_at,generated_by")
      .eq("production_order_id", id)
      .order("generated_at", { ascending: false }),
  ]);

  // Lot 2, généralisé migration 0036, puis par article migration 0037 : la
  // fiche Patronnage n'est pertinente pour un article que si une section de
  // catégorie Coupe (cle='coupe') est retenue SUR CET ARTICLE — obligatoire
  // pour valider (section 10 du document de logique) — ou si une fiche est
  // déjà liée alors que Coupe a depuis été décochée, pour ne pas faire
  // disparaître un lien existant sans prévenir. Même principe pour le
  // visuel (migration 0036), symétrique, contrôlé côté serveur par
  // validate_production_order() — et, depuis la migration 0040, pour la
  // maquette et les zones imprimables (non bloquantes, mais pertinentes
  // pour le même article Impression).
  const coupeSectionIds = new Set(
    (allSections ?? [])
      .filter((s) => (s.atelier_categories as unknown as { cle: string } | null)?.cle === "coupe")
      .map((s) => s.id)
  );
  const impressionSectionIds = new Set(
    (allSections ?? [])
      .filter((s) => (s.atelier_categories as unknown as { requiert_visuel: boolean } | null)?.requiert_visuel)
      .map((s) => s.id)
  );
  type ChosenLineSection = { production_order_line_id: string; section_id: string; ordre: number };
  const sectionIdsByLine: Record<string, string[]> = {};
  const coupeSelectedByLine: Record<string, boolean> = {};
  const impressionSectionSelectedByLine: Record<string, boolean> = {};
  for (const s of (chosenLineSections ?? []) as unknown as ChosenLineSection[]) {
    (sectionIdsByLine[s.production_order_line_id] ??= []).push(s.section_id);
    if (coupeSectionIds.has(s.section_id)) coupeSelectedByLine[s.production_order_line_id] = true;
    if (impressionSectionIds.has(s.section_id)) impressionSectionSelectedByLine[s.production_order_line_id] = true;
  }
  const anySectionChosen = Object.values(sectionIdsByLine).some((ids) => ids.length > 0);

  type ChosenLinePrintableZone = { production_order_line_id: string; printable_zone_id: string };
  const printableZoneIdsByLine: Record<string, string[]> = {};
  for (const z of (chosenLinePrintableZones ?? []) as unknown as ChosenLinePrintableZone[]) {
    (printableZoneIdsByLine[z.production_order_line_id] ??= []).push(z.printable_zone_id);
  }

  // Noms des personnes ayant validé le lancement / demandé ou confirmé la
  // clôture — doivent apparaître à l'écran (et sur le PDF, hors périmètre de
  // cet écran) au même titre qu'archived_at/archived_by (section 4 du
  // document de logique).
  const userIds = [
    order.launched_by,
    order.cloture_demandee_par,
    order.closed_by,
    order.refuse_par,
    ...(anomalies ?? []).map((a) => a.resolved_by),
  ].filter((v): v is string => !!v);
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => users?.find((u) => u.id === userId)?.full_name ?? "—";

  // Lot 1 — chaîne de remplacement d'un ODF annulé. Les deux sens sont
  // chargés : la fiche annulée montre vers quoi elle a été relancée, et la
  // fiche qui remplace montre ce qu'elle remplace. Les candidats ne sont
  // proposés que sur un ODF annulé, et le serveur revérifie à l'écriture.
  const [{ data: replacedBy }, { data: replaces }, { data: replacementCandidates }] = await Promise.all([
    order.replaced_by_production_order_id
      ? supabase
          .from("production_orders")
          .select("id,reference")
          .eq("id", order.replaced_by_production_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("production_orders")
      .select("id,reference")
      .eq("replaced_by_production_order_id", id)
      .order("created_at"),
    order.status === "annulee"
      ? supabase
          .from("production_orders")
          .select("id,reference,status")
          .eq("company_id", order.company_id)
          .neq("id", id)
          .neq("status", "annulee")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);

  // Un refus de validation n'est pas une annulation : il sanctionne souvent
  // une faute de frappe, et l'ODF doit redevenir modifiable puis resoumis
  // (submit_production_order accepte les deux statuts depuis 0028).
  const modifiable = order.status === "brouillon" || order.status === "refuse";

  // Verrouillage visuel/maquette (migration 0042, demande Ayman 16/09) : un
  // point plus tardif que `modifiable` — reste modifiable pendant
  // en_attente_validation, pas seulement brouillon/refusé, car
  // validate_production_order() exige un visuel pour toute section
  // Impression retenue : le verrouiller dès la soumission interdirait de
  // corriger un visuel manquant avant la validation. Figé à partir de
  // en_production, comme fiches_placement/traces_placement (0037).
  const mediaEditable =
    order.status === "brouillon" || order.status === "en_attente_validation" || order.status === "refuse";

  // ODF multi-lignes (une ligne par article du devis) : construit les
  // données d'affichage de chaque ligne — tailles proposables restreintes
  // au modèle de CETTE ligne (getSizesForProductModel, convention 0029),
  // gabarit de zones de son modèle (zoneTemplatesAll, chargé une fois pour
  // toutes les lignes), et si son modèle/sa couleur viennent du devis
  // (sourceHadModel) donc non modifiables ici.
  type RawLine = NonNullable<typeof productionOrderLines>[number];
  type LineConfig = Omit<
    LineData,
    | "sectionIds"
    | "coupeSelected"
    | "fiche"
    | "impressionSectionSelected"
    | "visuelsFromDevis"
    | "visuelAttached"
    | "maquetteFromDevis"
    | "maquetteAttached"
    | "printableZoneOptions"
    | "printableZoneIdsSelected"
  >;
  const lines: LineConfig[] = await Promise.all(
    (productionOrderLines ?? []).map(async (l: RawLine) => {
      const productModel = l.product_models as unknown as {
        id: string;
        name: string;
        textile_id: string | null;
        textiles: { nom: string; composition: string | null; grammage: number | null; laize_cm: number | null } | null;
      } | null;
      const quoteLine = l.quote_lines as unknown as { product_model_id: string | null } | null;
      return {
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        productModelId: l.product_model_id,
        productModelName: productModel?.name ?? null,
        sourceHadModel: !!quoteLine?.product_model_id,
        textileNom: productModel?.textiles?.nom ?? null,
        textileComposition: productModel?.textiles?.composition ?? null,
        textileGrammage: productModel?.textiles?.grammage ?? null,
        textileLaizeCm: productModel?.textiles?.laize_cm ?? null,
        couleurUniqueId: l.couleur_unique_id,
        zoneColors: (l.zone_colors ?? []).map((z) => ({ zone_key: z.zone_key, color_id: (z.colors as unknown as { id: string } | null)?.id ?? "" })),
        zoneTemplate: (zoneTemplatesAll ?? [])
          .filter((z) => z.product_model_id === l.product_model_id)
          .map((z) => ({ zone_key: z.zone_key, zone_label: z.zone_label, display_order: z.display_order })),
        referentielTailles: await getSizesForProductModel(l.product_model_id),
        initialSizes: (l.sizes ?? []) as { taille: string; quantite_demandee: number }[],
      };
    })
  );

  // Même logique que le garde-fou serveur de submit_production_order()
  // (migration 0035) : sert uniquement à désactiver le bouton côté client
  // avec un message clair — le contrôle qui fait autorité reste le RPC.
  const linesConfigured =
    lines.length > 0 &&
    lines.every((line) => {
      if (!line.productModelId) return false;
      const zoneCount = line.zoneTemplate.length;
      const colorsConfigured = !!line.couleurUniqueId || (zoneCount > 0 && line.zoneColors.length >= zoneCount);
      if (!colorsConfigured) return false;
      const reparti = line.initialSizes.reduce((sum, s) => sum + s.quantite_demandee, 0);
      return reparti === line.quantity;
    });

  const anomalyRows = (anomalies ?? []).map((a) => ({
    id: a.id,
    message: a.message,
    sectionName: (a.sections as unknown as { name: string } | null)?.name ?? null,
    createdAt: a.created_at,
    resolvedAt: a.resolved_at,
    resolvedByName: a.resolved_by ? nameOf(a.resolved_by) : null,
  }));

  const recon = reconciliation as {
    poids_entrant_kg: number;
    poids_sortie_lots_kg: number;
    poids_dechets_kg: number;
    poids_retour_kg: number;
    poids_sortant_total_kg: number;
    ecart_kg: number;
  } | null;
  const hasReconciliationData = !!recon && (recon.poids_entrant_kg > 0 || recon.poids_sortant_total_kg > 0);

  const rend = rendement as {
    pieces_obtenues: number;
    poids_tissu_theorique_kg: number | null;
    theorique_complet: boolean;
    poids_tissu_reel_mesure_kg: number;
    rendement_theorique_pieces_par_kg: number | null;
    rendement_mesure_pieces_par_kg: number | null;
  } | null;

  const company = order.companies as unknown as { name: string } | null;
  const quote = order.quotes as unknown as { reference: string } | null;

  // Lot 9, par article depuis la migration 0037 pour le visuel : documents
  // généraux de l'ODF entier + visuels/maquettes déjà joints à chaque
  // article, en plus de ceux encore disponibles dans la médiathèque du
  // client pour le sélecteur d'ajout.
  const attachedGeneralMediaFiles = (attachedGeneralMedia ?? [])
    .map((m) => m.media_files as unknown as AttachableMediaFile | null)
    .filter((f): f is AttachableMediaFile => !!f);
  const availableMediaFiles = (availableMedia ?? []) as AttachableMediaFile[];
  const visuelByLine: Record<string, AttachableMediaFile[]> = {};
  const maquetteByLine: Record<string, AttachableMediaFile[]> = {};
  for (const m of (attachedLineMedia ?? []) as unknown as { production_order_line_id: string; media_files: AttachableMediaFile | null }[]) {
    if (!m.media_files) continue;
    if (m.media_files.category === "maquette") (maquetteByLine[m.production_order_line_id] ??= []).push(m.media_files);
    else (visuelByLine[m.production_order_line_id] ??= []).push(m.media_files);
  }

  // Visuel(s) et maquette hérités du devis (migration 0041) : la maquette
  // fait foi dès qu'elle existe côté devis (l'ODF ne propose la sienne que
  // pour rattraper une absence), le visuel s'y ajoute simplement (union).
  // Un seul aller-retour pour tous les articles plutôt qu'un par ligne.
  const quoteLineIds = (productionOrderLines ?? []).map((l) => l.quote_line_id).filter((v): v is string => !!v);
  const { data: quoteLineMedia } =
    quoteLineIds.length > 0
      ? await supabase
          .from("quote_line_media_files")
          .select("quote_line_id,media_file_id,media_files(file_name,category)")
          .in("quote_line_id", quoteLineIds)
      : { data: [] as { quote_line_id: string; media_file_id: string; media_files: { file_name: string; category: string } | null }[] };

  const visuelsByQuoteLine: Record<string, AttachableMediaFile[]> = {};
  const maquetteByQuoteLine: Record<string, AttachableMediaFile> = {};
  for (const m of quoteLineMedia ?? []) {
    const media = m.media_files as unknown as { file_name: string; category: string } | null;
    if (!media) continue;
    const file: AttachableMediaFile = { id: m.media_file_id, file_name: media.file_name, category: media.category as AttachableMediaFile["category"] };
    if (media.category === "maquette") {
      maquetteByQuoteLine[m.quote_line_id] ??= file;
    } else if (media.category === "visuel") {
      (visuelsByQuoteLine[m.quote_line_id] ??= []).push(file);
    }
  }
  const quoteLineIdByLine: Record<string, string> = {};
  for (const l of productionOrderLines ?? []) {
    if (l.quote_line_id) quoteLineIdByLine[l.id] = l.quote_line_id;
  }

  // Aperçu/téléchargement : une URL signée par fichier, résolue une seule
  // fois pour tout l'ODF (devis + ODF confondus) plutôt qu'un aller-retour
  // par article.
  const maquettePreviewUrls = await getMediaFilePreviewUrls([
    ...Object.values(maquetteByLine).flat().map((f) => f.id),
    ...Object.values(maquetteByQuoteLine).map((f) => f.id),
  ]);
  const visuelDownloadUrls = await getMediaFilePreviewUrls([
    ...Object.values(visuelByLine).flat().map((f) => f.id),
    ...Object.values(visuelsByQuoteLine).flat().map((f) => f.id),
  ]);
  const maquetteWithUrlByLine: Record<string, MaquetteFile[]> = {};
  for (const [lineId, files] of Object.entries(maquetteByLine)) {
    maquetteWithUrlByLine[lineId] = files.map((f) => ({ ...f, previewUrl: maquettePreviewUrls.get(f.id) ?? null }));
  }
  const visuelWithUrlByLine: Record<string, DownloadableMediaFile[]> = {};
  for (const [lineId, files] of Object.entries(visuelByLine)) {
    visuelWithUrlByLine[lineId] = files.map((f) => ({ ...f, downloadUrl: visuelDownloadUrls.get(f.id) ?? null }));
  }

  const fichesByLine: Record<string, { id: string; numeroOt: string; statut: StatutFiche }> = {};
  for (const f of (fiches ?? []) as unknown as { id: string; numero_ot: string; statut: StatutFiche; production_order_line_id: string }[]) {
    fichesByLine[f.production_order_line_id] = { id: f.id, numeroOt: f.numero_ot, statut: f.statut };
  }

  // Sections retenues, fiche Patronnage, visuel, maquette et zones
  // imprimables intégrés à la carte de chaque article (« Configuration
  // produit ») plutôt qu'en cartes séparées en bas de page (demande Ayman,
  // 15/09, étendue 16/09) — regroupe ici les données calculées ci-dessus
  // par article.
  const linesWithConfig: LineData[] = lines.map((line) => {
    const quoteLineId = quoteLineIdByLine[line.id];
    const maquetteFromDevisFile = quoteLineId ? maquetteByQuoteLine[quoteLineId] : undefined;
    return {
      ...line,
      sectionIds: sectionIdsByLine[line.id] ?? [],
      coupeSelected: !!coupeSelectedByLine[line.id],
      fiche: fichesByLine[line.id] ?? null,
      impressionSectionSelected: !!impressionSectionSelectedByLine[line.id],
      visuelsFromDevis: (quoteLineId ? visuelsByQuoteLine[quoteLineId] : undefined)?.map((f) => ({
        ...f,
        downloadUrl: visuelDownloadUrls.get(f.id) ?? null,
      })) ?? [],
      visuelAttached: visuelWithUrlByLine[line.id] ?? [],
      maquetteFromDevis: maquetteFromDevisFile
        ? { ...maquetteFromDevisFile, previewUrl: maquettePreviewUrls.get(maquetteFromDevisFile.id) ?? null }
        : null,
      maquetteAttached: maquetteWithUrlByLine[line.id] ?? [],
      printableZoneOptions: (printableZonesAll ?? [])
        .filter((z) => z.product_model_id === line.productModelId)
        .map((z) => ({ id: z.id, zone_key: z.zone_key, zone_label: z.zone_label, display_order: z.display_order })),
      printableZoneIdsSelected: printableZoneIdsByLine[line.id] ?? [],
    };
  });

  const canArchive = await can("ordres_fabrication", "archive");
  const canValidate = await can("ordres_fabrication", "validate");
  const canRequestClosure = profile.role === "responsable_production" || profile.role === "administrateur";
  const isAdmin = profile.role === "administrateur";
  // Génération des fiches d'export Sage — l'ODF n'affiche plus que la
  // consultation des mouvements (saisie déplacée vers /atelier/stock,
  // demande Ayman 16/09 : mouvements visibles sur l'ODF, gérés ailleurs).
  const canManageStock = isAdmin || profile.role === "responsable_production" || profile.role === "gestionnaire_stock";

  return (
    <div className="space-y-6">
      <PageHeader
        title={order.reference}
        description={`${company?.name ?? ""} · ${order.total_quantity} pièces · devis ${quote?.reference ?? "—"}`}
        action={
          <div className="flex items-center gap-2">
            {order.archived_at && <Badge tone="neutral">Archivé le {formatDate(order.archived_at)}</Badge>}
            <StatusBadge status={order.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
            {canArchive && <ArchiveButton productionOrderId={order.id} archived={!!order.archived_at} />}
          </div>
        }
      />

      {(replaces ?? []).length > 0 && (
        <p className="text-sm text-foreground-muted">
          Remplace{" "}
          {(replaces ?? []).map((r, i) => (
            <span key={r.id}>
              {i > 0 && ", "}
              <Link href={`/atelier/production/${r.id}`} className="text-brand hover:underline">
                {r.reference}
              </Link>
            </span>
          ))}{" "}
          — ordre de fabrication annulé.
        </p>
      )}

      {order.status === "refuse" && (
        <Card className="border-danger/30 bg-danger-soft/40">
          <CardBody>
            <p className="text-xs font-medium text-foreground-muted">
              Validation refusée{order.refuse_le ? ` le ${formatDate(order.refuse_le)}` : ""}
              {order.refuse_par ? ` par ${nameOf(order.refuse_par)}` : ""}
            </p>
            <p className="text-sm text-foreground">
              {order.refus_motif ?? "Aucun motif précisé."}
            </p>
            <p className="mt-1 text-xs text-foreground-muted">
              Corrigez ce qui doit l&apos;être ci-dessous, puis soumettez à nouveau : le motif sera soldé.
            </p>
          </CardBody>
        </Card>
      )}

      {order.cloture_note && (
        <Card className="border-warning/30 bg-warning-soft/40">
          <CardBody>
            <p className="text-xs font-medium text-foreground-muted">Note de clôture</p>
            <p className="text-sm text-foreground">{order.cloture_note}</p>
          </CardBody>
        </Card>
      )}

      <AnomaliesPanel productionOrderId={order.id} anomalies={anomalyRows} canResolve={isAdmin || profile.role === "responsable_production"} />

      {order.mention_surplus_traces && (
        <Card className="border-info/30 bg-info-soft/40">
          <CardBody>
            <p className="text-xs font-medium text-foreground-muted">Surplus tracé vs quantité demandée</p>
            <p className="text-sm text-foreground">
              {Object.entries(order.mention_surplus_traces as Record<string, number>)
                .map(([taille, surplus]) => `${taille} : +${surplus}`)
                .join(" · ")}
            </p>
          </CardBody>
        </Card>
      )}

      <ProductionOrderLines
        productionOrderId={order.id}
        companyId={order.company_id}
        editable={modifiable}
        mediaEditable={mediaEditable}
        lines={linesWithConfig}
        productModels={productModels ?? []}
        colors={activeColors ?? []}
        allSections={allSections ?? []}
        availableMediaFiles={availableMediaFiles}
        initialNote={order.note_disponibilite_couleurs}
      />

      {modifiable && (
        <SubmitOdfPanel productionOrderId={order.id} anySectionChosen={anySectionChosen} linesConfigured={linesConfigured} />
      )}

      <ProductionOrderMediaFiles
        productionOrderId={order.id}
        attached={attachedGeneralMediaFiles}
        available={availableMediaFiles}
      />

      {order.status === "annulee" && (
        <ReplacementOrderPicker
          productionOrderId={order.id}
          current={replacedBy ?? null}
          candidates={replacementCandidates ?? []}
          editable={isAdmin || profile.role === "responsable_production"}
        />
      )}

      <LifecycleActions
        productionOrderId={order.id}
        status={order.status}
        canValidate={canValidate}
        canRequestClosure={canRequestClosure}
        isAdmin={isAdmin}
      />

      <Card>
        <CardHeader
          title="Ordres de travail"
          description="Un sous-ODF par section retenue, généré à la validation de l'ODF. Cliquez sur un sous-ODF pour son détail."
        />
        <CardBody className="p-0">
          {!workOrders || workOrders.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">
              Aucun ordre de travail généré pour le moment — les sous-ODF sont créés à la validation de l&apos;ODF.
            </p>
          ) : (
            <ol className="divide-y divide-border">
              {workOrders.map((wo, i) => {
                const atteinte = wo.quantity_done >= wo.quantity_planned;
                return (
                  <li key={wo.id}>
                    <Link
                      href={`/atelier/production/${order.id}/ot/${wo.id}`}
                      className="flex items-center gap-4 px-5 py-4 hover:bg-surface-muted"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-foreground-muted">
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {(wo.sections as unknown as { name: string } | null)?.name} — {wo.reference}
                        </p>
                        <p className="text-xs text-foreground-muted">
                          {wo.quantity_done}/{wo.quantity_planned} pièces
                          {wo.actual_start ? ` · démarré le ${formatDateTime(wo.actual_start)}` : ""}
                          {wo.actual_end ? ` · quantité atteinte le ${formatDateTime(wo.actual_end)}` : ""}
                        </p>
                        {wo.blocking_reason && (
                          <p className="mt-1 text-xs text-danger">⚠ {wo.blocking_reason}</p>
                        )}
                      </div>
                      {atteinte ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <Package className="h-4 w-4 shrink-0 text-foreground-muted" />
                      )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>

      {articleLots && articleLots.length > 0 && (
        <Card>
          <CardHeader title="Lots générés" description="Sérialisation par lot (lot 6) — QR à imprimer par étiquette dédiée." />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {articleLots.map((lot) => (
                <li key={lot.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-3.5 w-3.5 text-foreground-muted" />
                    <span className="font-mono text-xs text-foreground">{lot.code}</span>
                    <Badge tone="brand">{LOT_CATEGORIE_LABELS[lot.categorie] ?? lot.categorie}</Badge>
                  </div>
                  <Link href={`/lots/${lot.code}`} target="_blank" className="text-xs font-medium text-brand hover:underline">
                    Voir le QR →
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {hasReconciliationData && (
        <Card>
          <CardHeader
            title="Réconciliation matière"
            description="Poids entrant (tissu reçu) vs poids sortant (lots + déchets + retours) — lot 7, section 16 du document de logique."
          />
          <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-foreground-muted">Entrant (tissu)</p>
              <p className="font-medium text-foreground">{recon!.poids_entrant_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Sortie lots</p>
              <p className="font-medium text-foreground">{recon!.poids_sortie_lots_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Déchets</p>
              <p className="font-medium text-foreground">{recon!.poids_dechets_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Retour stock</p>
              <p className="font-medium text-foreground">{recon!.poids_retour_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Sortant total</p>
              <p className="font-medium text-foreground">{recon!.poids_sortant_total_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Écart</p>
              <p className={Math.abs(recon!.ecart_kg) > 0.01 ? "font-medium text-warning" : "font-medium text-foreground"}>
                {recon!.ecart_kg} kg
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {canManageStock && (
        <p className="text-xs text-foreground-muted">
          Mouvements de stock consultables ci-dessous — pour en enregistrer un nouveau, direction{" "}
          <Link href={`/atelier/stock?odf=${order.id}`} className="font-medium text-brand hover:underline">
            Gestion de stock
          </Link>
          .
        </p>
      )}

      <StockMovementsPanel
        productionOrderId={order.id}
        movements={(stockMovements ?? []) as StockMovement[]}
        fiches={(stockExportFiches ?? []) as StockExportFiche[]}
        canGenerate={canManageStock}
      />

      {rend && (
        <Card>
          <CardHeader
            title="Rendement matière"
            description="Pièces obtenues par kg de tissu engagé (lot 8) — théorique (dimensions des matelas) vs mesuré (pesées réelles, lot 7)."
          />
          <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs text-foreground-muted">Pièces obtenues</p>
              <p className="font-medium text-foreground">{rend.pieces_obtenues}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Tissu engagé (théorique)</p>
              <p className="font-medium text-foreground">
                {rend.theorique_complet ? `${rend.poids_tissu_theorique_kg} kg` : "incomplet"}
              </p>
              {!rend.theorique_complet && (
                <p className="text-xs text-foreground-muted">dimension ou grammage manquant sur un matelas</p>
              )}
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Tissu engagé (mesuré)</p>
              <p className="font-medium text-foreground">{rend.poids_tissu_reel_mesure_kg} kg</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Rendement (théorique / mesuré)</p>
              <p className="font-medium text-foreground">
                {rend.rendement_theorique_pieces_par_kg ?? "—"} / {rend.rendement_mesure_pieces_par_kg ?? "—"} pièces/kg
              </p>
            </div>
          </CardBody>
          {rendementTraces && rendementTraces.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {rendementTraces.map((rt) => (
                <li key={rt.trace_id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm text-foreground">{rt.reference}</p>
                    <p className="text-xs text-foreground-muted">
                      {rt.pieces_obtenues} pièces · {rt.rendement_estime_pieces_par_kg ?? "—"} pièces/kg ·
                      {" "}clôturé le {formatDateTime(rt.cloture_le)}
                    </p>
                  </div>
                  <Link
                    href={`/atelier/patronnage/${rt.fiche_id}?trace=${rt.trace_id}`}
                    className="shrink-0 text-xs font-medium text-brand hover:underline"
                  >
                    Voir le tracé →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Historique du cycle de vie" />
        <CardBody className="grid grid-cols-1 gap-3 text-sm text-foreground-muted sm:grid-cols-2">
          <p>Début planifié : {formatDate(order.planned_start_date)}</p>
          <p>Fin planifiée : {formatDate(order.planned_end_date)}</p>
          {order.launched_at && (
            <p>
              Lancé le {formatDateTime(order.launched_at)} par {nameOf(order.launched_by)}
            </p>
          )}
          {order.cloture_demandee_at && (
            <p>
              Clôture demandée le {formatDateTime(order.cloture_demandee_at)} par{" "}
              {nameOf(order.cloture_demandee_par)}
            </p>
          )}
          {order.closed_at && (
            <p>
              Clôturé le {formatDateTime(order.closed_at)} par {nameOf(order.closed_by)}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
