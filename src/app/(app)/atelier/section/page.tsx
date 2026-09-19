import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getSizes } from "@/lib/sizes";
import { PageHeader } from "@/components/shell/page-header";
import { SectionQueue } from "./section-queue";
import { SectionBoardLegacy } from "./section-board-legacy";
import type {
  WorkOrderRow,
  WorkOrderContext,
  MatelasRow,
  MatelasDechetRow,
  TraceOption,
  ArticleLotOption,
  ProductionOrderOption,
  QuantityEventRow,
  WasteBagRow,
  StockItemOption,
} from "./types";
import { SectionSwitcher } from "./section-switcher";
import { Card, CardBody } from "@/components/ui/card";
import Link from "next/link";

export default async function SectionQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; odf?: string }>;
}) {
  const { profile } = await requireRole(["chef_section", "responsable_production", "administrateur", "gestionnaire_stock"]);
  const supabase = await createClient();
  const params = await searchParams;
  const odfFilterId = params.odf ?? null;

  let sectionId = profile.section_id;
  let sections: { id: string; name: string }[] = [];
  const isStockManager = profile.role === "gestionnaire_stock";

  if (profile.role !== "chef_section") {
    const { data } = await supabase
      .from("sections")
      .select("id,name,atelier_categories(cle)")
      .eq("active", true)
      .order("display_order");
    sections = (data ?? []).map((s) => ({ id: s.id, name: s.name }));
    // Le gestionnaire de stock n'a qu'un outil ici (pesées, section Coupe) —
    // autant l'y amener directement plutôt que sur la première section de la
    // liste, qui n'a souvent rien à lui montrer.
    const defaultSectionId = isStockManager
      ? (data ?? []).find((s) => (s.atelier_categories as unknown as { cle: string } | null)?.cle === "coupe")?.id
      : undefined;
    sectionId = params.section ?? defaultSectionId ?? sections[0]?.id ?? null;
  }

  if (!sectionId) {
    return (
      <Card>
        <CardBody>Aucune section disponible.</CardBody>
      </Card>
    );
  }

  const { data: section } = await supabase
    .from("sections")
    .select("id,name,atelier_categories(cle)")
    .eq("id", sectionId)
    .single();

  // Filtre `?odf=` posé par le lecteur QR (QrScanButton) : l'opérateur scanne
  // le QR d'en-tête de l'ODF (qui pointe vers /atelier/production/[id], une
  // page interdite au chef de section) et se retrouve ici avec uniquement les
  // sous-ODF de SA section pour cet ODF.
  let odfReference: string | null = null;
  if (odfFilterId) {
    const { data: odf } = await supabase.from("production_orders").select("reference").eq("id", odfFilterId).maybeSingle();
    odfReference = odf?.reference ?? null;
  }

  let workOrdersQuery = supabase
    .from("work_orders")
    .select(
      "id,reference,quantity_planned,quantity_done,blocking_reason,planned_start,planned_end,actual_start,production_order_id,production_order_line_id,production_orders(id,reference,company_id,companies(name))"
    )
    .eq("section_id", sectionId);
  if (odfFilterId) workOrdersQuery = workOrdersQuery.eq("production_order_id", odfFilterId);
  const { data: workOrders } = await workOrdersQuery
    .order("planned_start", { ascending: true });

  // Lot 4, généralisé migration 0036 : section de catégorie Coupe uniquement
  // (cle='coupe', plus seulement le nom "Coupe") — un matelas = un tracé
  // Patronnage d'une fiche "Bon pour coupe" liée à l'ODF du sous-ODF.
  // Totaux pré-remplis depuis repartition_par_couche × couches réelles
  // (migration 0053) — l'opérateur ne corrige que ce qui manque.
  const isCoupe = (section?.atelier_categories as unknown as { cle: string } | null)?.cle === "coupe";
  const contextByWorkOrderId: Record<string, WorkOrderContext> = {};
  const matelasByWorkOrderId: Record<string, MatelasRow[]> = {};
  const traceOptionsByWorkOrderId: Record<string, TraceOption[]> = {};
  const eventsByWorkOrderId: Record<string, QuantityEventRow[]> = {};
  const lotsByProductionOrderId: Record<string, ArticleLotOption[]> = {};
  let productionOrderOptions: ProductionOrderOption[] = [];
  let openWasteBags: WasteBagRow[] = [];
  let stockItemOptions: StockItemOption[] = [];

  const lineIds = (workOrders ?? [])
    .map((wo) => wo.production_order_line_id)
    .filter((lineId): lineId is string => !!lineId);

  if (isCoupe && workOrders && workOrders.length > 0) {
    const productionOrderIds = workOrders
      .map((wo) => (wo.production_orders as unknown as { id: string } | null)?.id)
      .filter((id): id is string => !!id);

    // Lot 7 : ODF disponibles pour rattacher une pesée (sortie_lot /
    // retour_stock) ou la pesée incrémentale d'un sac — circonscrit aux ODF
    // réellement visibles dans cette file Coupe.
    const seenPoIds = new Set<string>();
    productionOrderOptions = workOrders.reduce<ProductionOrderOption[]>((acc, wo) => {
      const po = wo.production_orders as unknown as { id: string; reference: string; companies?: { name: string } | null } | null;
      if (po && !seenPoIds.has(po.id)) {
        seenPoIds.add(po.id);
        acc.push({ id: po.id, reference: po.reference, companyName: po.companies?.name ?? null });
      }
      return acc;
    }, []);

    // Lot 10 : miroir Sage (stock_item_view) — pour rattacher un article à
    // une pesée retour_stock. Peut être vide (jamais synchronisé, cf.
    // Paramètres > Stock) : le formulaire reste utilisable sans.
    const { data: stockItems } = await supabase
      .from("stock_item_view")
      .select("sage_reference,designation")
      .order("designation");
    stockItemOptions = (stockItems ?? []).map((i) => ({ sageReference: i.sage_reference, designation: i.designation }));

    const { data: articleLots } = await supabase
      .from("article_lots")
      .select("id,code,categorie,production_order_id")
      .in("production_order_id", productionOrderIds)
      .order("created_at", { ascending: false });
    for (const lot of articleLots ?? []) {
      (lotsByProductionOrderId[lot.production_order_id] ??= []).push({
        id: lot.id,
        code: lot.code,
        categorie: lot.categorie,
      });
    }

    // Migration 0037 : une fiche par article (production_order_line_id),
    // plus une seule par ODF entier — les matelas d'un OT se retrouvent
    // désormais directement via l'article de CET OT précis, plus besoin de
    // passer par l'ODF entier (deux OT Coupe du même ODF, un par article, ne
    // se mélangent plus).
    const { data: fiches } = await supabase
      .from("fiches_placement")
      .select(
        "id,numero_ot,production_order_line_id,tissu_type,couleur,grammage,traces_placement(id,ordre,reference,reference_patron,longueur_matelas_cm,largeur_matelas_cm,nb_plis,repartition_par_couche,est_correctif,approuve_par,justification)"
      )
      .in("production_order_line_id", lineIds)
      .eq("statut", "bon_pour_coupe");

    const { data: closedEvents } = await supabase
      .from("work_order_events")
      .select("trace_id,occurred_at,quantites_obtenues")
      .eq("event_type", "matelas_cloture")
      .in(
        "work_order_id",
        workOrders.map((wo) => wo.id)
      );
    const closedTraceIds = new Set((closedEvents ?? []).map((e) => e.trace_id as string));
    const clotureByTraceId = new Map(
      (closedEvents ?? []).map((e) => [
        e.trace_id as string,
        {
          occurredAt: e.occurred_at as string,
          quantitesObtenues: (e.quantites_obtenues ?? {}) as Record<string, number>,
        },
      ])
    );

    // Déchets déjà pesés pour les matelas encore ouverts : le chef de section
    // peut peser (scan du sac), fermer la fiche et revenir clôturer plus tard
    // — ce qui a été pesé doit réapparaître, c'est ce total que
    // close_matelas retiendra (migration 0053).
    const openTraceIds = (fiches ?? [])
      .flatMap((f) => ((f.traces_placement ?? []) as unknown as { id: string }[]).map((t) => t.id))
      .filter((id) => !closedTraceIds.has(id));
    const dechetsByTraceId: Record<string, MatelasDechetRow[]> = {};
    if (openTraceIds.length > 0) {
      const { data: dechets } = await supabase
        .from("sacs_dechets_pesees")
        .select("id,trace_id,delta_kg,occurred_at,sacs_dechets(code)")
        .in("trace_id", openTraceIds)
        .order("occurred_at", { ascending: true });
      for (const d of dechets ?? []) {
        (dechetsByTraceId[d.trace_id as string] ??= []).push({
          id: d.id as string,
          bagCode: (d.sacs_dechets as unknown as { code: string } | null)?.code ?? "—",
          deltaKg: Number(d.delta_kg),
          occurredAt: d.occurred_at as string,
        });
      }
    }

    const matelasByLineId: Record<string, MatelasRow[]> = {};
    const traceOptionsByLineId: Record<string, TraceOption[]> = {};
    const numeroOtByLineId: Record<string, string> = {};
    for (const fiche of fiches ?? []) {
      const lineId = fiche.production_order_line_id as string;
      numeroOtByLineId[lineId] = fiche.numero_ot as string;
      const traces = (fiche.traces_placement ?? []) as unknown as {
        id: string;
        ordre: number;
        reference: string;
        reference_patron: string | null;
        longueur_matelas_cm: number | null;
        largeur_matelas_cm: number | null;
        nb_plis: number | null;
        repartition_par_couche: Record<string, number>;
        est_correctif: boolean;
        approuve_par: string | null;
        justification: string | null;
      }[];
      const usable = traces.filter((t) => !t.est_correctif || t.approuve_par);
      // Un matelas clôturé reste dans la liste, marqué terminé (étiquettes du lot).
      matelasByLineId[lineId] = usable
        .sort((a, b) => a.ordre - b.ordre)
        .map((t) => ({
          id: t.id,
          reference: t.reference,
          referencePatron: t.reference_patron,
          repartitionParCouche: t.repartition_par_couche ?? {},
          nbPlis: t.nb_plis,
          longueurCm: t.longueur_matelas_cm,
          laizeCm: t.largeur_matelas_cm,
          tissu: (fiche.tissu_type as string | null) ?? null,
          couleur: (fiche.couleur as string | null) ?? null,
          grammage: (fiche.grammage as number | null) ?? null,
          estCorrectif: t.est_correctif,
          justification: t.justification,
          dechets: dechetsByTraceId[t.id] ?? [],
          cloture: clotureByTraceId.get(t.id) ?? null,
        }));
      // Lot 6 : le tracé d'origine (optionnel) d'un lot article peut être
      // n'importe quel matelas de la fiche, clôturé ou non.
      traceOptionsByLineId[lineId] = usable
        .sort((a, b) => a.ordre - b.ordre)
        .map((t) => ({ id: t.id, reference: t.reference }));
    }

    for (const wo of workOrders) {
      const lineId = wo.production_order_line_id;
      if (lineId && matelasByLineId[lineId]) matelasByWorkOrderId[wo.id] = matelasByLineId[lineId];
      if (lineId && traceOptionsByLineId[lineId]) traceOptionsByWorkOrderId[wo.id] = traceOptionsByLineId[lineId];
      if (lineId && numeroOtByLineId[lineId]) {
        contextByWorkOrderId[wo.id] = {
          numeroOt: numeroOtByLineId[lineId],
          articleDescription: null,
        };
      }
    }
  }

  // Sacs ouverts : chargés même quand la file est vide — on prépare souvent
  // ses sacs avant le premier matelas.
  if (isCoupe) {
    // Sacs de déchets ouverts — indépendants de tout ODF en propre (mélange
    // de productions accepté, section 17), donc listés au niveau section,
    // pas par sous-ODF.
    const { data: bags } = await supabase
      .from("sacs_dechets")
      .select("id,code,created_at")
      .eq("statut", "en_cours")
      .order("created_at", { ascending: false })
      .limit(20);

    const bagIds = (bags ?? []).map((b) => b.id);
    const lastWeightBySacId: Record<string, number> = {};
    if (bagIds.length > 0) {
      const { data: weighings } = await supabase
        .from("sacs_dechets_pesees")
        .select("sac_id,poids_releve_kg,occurred_at")
        .in("sac_id", bagIds)
        .order("occurred_at", { ascending: true });
      for (const w of weighings ?? []) {
        lastWeightBySacId[w.sac_id] = w.poids_releve_kg;
      }
    }
    openWasteBags = (bags ?? []).map((b) => ({
      id: b.id,
      code: b.code,
      currentWeightKg: lastWeightBySacId[b.id] ?? 0,
      createdAt: b.created_at,
    }));
  }

  if (!isStockManager && workOrders && workOrders.length > 0) {
    // Description de l'article, pour l'en-tête du sous-ODF déplié et pour la
    // recherche. `production_order_lines` n'est aujourd'hui lisible que par
    // le responsable de production, l'administrateur et le commercial : pour
    // un chef de section la requête ne renvoie rien et l'écran s'en passe —
    // c'est le lot B qui lui ouvre cette lecture.
    if (lineIds.length > 0) {
      const { data: lines } = await supabase
        .from("production_order_lines")
        .select("id,description")
        .in("id", lineIds);
      const descriptionByLineId = Object.fromEntries((lines ?? []).map((l) => [l.id, l.description as string | null]));
      for (const wo of workOrders) {
        const lineId = wo.production_order_line_id;
        const existing = contextByWorkOrderId[wo.id];
        contextByWorkOrderId[wo.id] = {
          numeroOt: existing?.numeroOt ?? null,
          articleDescription: (lineId && descriptionByLineId[lineId]) || null,
        };
      }
    }

    // Historique des saisies de quantité (sections hors Coupe) : savoir ce
    // qui a déjà été compté, et par qui, évite la double saisie quand deux
    // chefs d'équipe se relaient sur le même ordre.
    if (!isCoupe) {
      const { data: events } = await supabase
        .from("work_order_events")
        .select("id,work_order_id,quantity,comment,occurred_at,app_users(full_name)")
        .in(
          "work_order_id",
          workOrders.map((wo) => wo.id)
        )
        .eq("event_type", "quantite_ajoutee")
        .order("occurred_at", { ascending: false })
        .limit(100);
      for (const e of events ?? []) {
        const rows = (eventsByWorkOrderId[e.work_order_id as string] ??= []);
        // Cinq lignes suffisent sur un téléphone : au-delà, l'historique
        // repousse le bouton de saisie hors de l'écran.
        if (rows.length >= 5) continue;
        rows.push({
          id: e.id as string,
          occurredAt: e.occurred_at as string,
          quantity: e.quantity as number | null,
          comment: e.comment as string | null,
          authorName: (e.app_users as unknown as { full_name: string } | null)?.full_name ?? null,
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isStockManager ? `Pesées — ${section?.name ?? ""}` : `File de travail — ${section?.name ?? ""}`}
        description={
          isStockManager
            ? "Sortie lot et retour stock — changez de section ci-contre si besoin."
            : isCoupe
              ? "Ouvrez un matelas pour voir son tracé et saisir le réel — déchets pesés par scan du sac."
              : "Ajoutez la quantité produite au fur et à mesure sur vos ordres de travail."
        }
        action={sections.length > 0 ? <SectionSwitcher sections={sections} value={sectionId} /> : undefined}
      />

      {odfFilterId && (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Filtré sur l&rsquo;ODF <strong>{odfReference ?? odfFilterId}</strong> — sous-ODF de votre section
              uniquement.
            </span>
            <Link href={`/atelier/section?section=${sectionId}`} className="font-medium text-brand hover:underline">
              Voir toute la file
            </Link>
          </CardBody>
        </Card>
      )}

      {isStockManager ? (
        <SectionBoardLegacy
          key={sectionId}
          isCoupe={isCoupe}
          lotsByProductionOrderId={lotsByProductionOrderId}
          productionOrderOptions={productionOrderOptions}
          initialOpenWasteBags={openWasteBags}
          stockItemOptions={stockItemOptions}
        />
      ) : (
        <SectionQueue
          key={sectionId}
          sectionId={sectionId}
          initialWorkOrders={(workOrders ?? []) as unknown as WorkOrderRow[]}
          contextByWorkOrderId={contextByWorkOrderId}
          matelasByWorkOrderId={matelasByWorkOrderId}
          traceOptionsByWorkOrderId={traceOptionsByWorkOrderId}
          eventsByWorkOrderId={eventsByWorkOrderId}
          isCoupe={isCoupe}
          initialOpenWasteBags={openWasteBags}
          sizes={await getSizes()}
        />
      )}
    </div>
  );
}
