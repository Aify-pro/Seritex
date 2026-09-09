import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import {
  SectionBoard,
  type WorkOrderRow,
  type MatelasRow,
  type TraceOption,
  type ArticleLotOption,
  type ProductionOrderOption,
  type WasteBagRow,
  type StockItemOption,
} from "./section-board";
import { SectionSwitcher } from "./section-switcher";
import { Card, CardBody } from "@/components/ui/card";

export default async function SectionQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { profile } = await requireRole(["chef_section", "responsable_production", "administrateur"]);
  const supabase = await createClient();
  const params = await searchParams;

  let sectionId = profile.section_id;
  let sections: { id: string; name: string }[] = [];

  if (profile.role !== "chef_section") {
    const { data } = await supabase.from("sections").select("id,name").eq("active", true).order("display_order");
    sections = data ?? [];
    sectionId = params.section ?? sections[0]?.id ?? null;
  }

  if (!sectionId) {
    return (
      <Card>
        <CardBody>Aucune section disponible.</CardBody>
      </Card>
    );
  }

  const { data: section } = await supabase.from("sections").select("id,name").eq("id", sectionId).single();

  const { data: workOrders } = await supabase
    .from("work_orders")
    .select(
      "id,reference,quantity_planned,quantity_done,blocking_reason,planned_start,planned_end,actual_start,production_orders(id,reference,company_id,companies(name))"
    )
    .eq("section_id", sectionId)
    .order("planned_start", { ascending: true });

  // Lot 4 : section Coupe uniquement — un matelas = un tracé Patronnage
  // d'une fiche "Bon pour coupe" liée à l'ODF du sous-ODF. Pré-remplissage
  // des quantités depuis repartition_par_couche (section 13 du document de
  // logique) — jamais ressaisies par l'opérateur.
  const isCoupe = section?.name === "Coupe";
  const matelasByWorkOrderId: Record<string, MatelasRow[]> = {};
  const traceOptionsByWorkOrderId: Record<string, TraceOption[]> = {};
  const lotsByProductionOrderId: Record<string, ArticleLotOption[]> = {};
  let productionOrderOptions: ProductionOrderOption[] = [];
  let openWasteBags: WasteBagRow[] = [];
  let stockItemOptions: StockItemOption[] = [];

  if (isCoupe && workOrders && workOrders.length > 0) {
    const productionOrderIds = workOrders
      .map((wo) => (wo.production_orders as unknown as { id: string } | null)?.id)
      .filter((id): id is string => !!id);

    // Lot 7 : ODF disponibles pour rattacher une pesée (reception_tissu /
    // sortie_lot / retour_stock) ou la pesée incrémentale d'un sac —
    // circonscrit aux ODF réellement visibles dans cette file Coupe.
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
    // une pesée reception_tissu/retour_stock. Peut être vide (jamais
    // synchronisé, cf. Paramètres > Stock) : le formulaire reste utilisable
    // sans, comme avant ce lot.
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

    const { data: fiches } = await supabase
      .from("fiches_placement")
      .select(
        "id,numero_ot,odf_id,traces_placement(id,ordre,reference,repartition_par_couche,est_correctif,approuve_par,justification)"
      )
      .in("odf_id", productionOrderIds)
      .eq("statut", "bon_pour_coupe");

    const { data: closedEvents } = await supabase
      .from("work_order_events")
      .select("trace_id")
      .eq("event_type", "matelas_cloture")
      .in(
        "work_order_id",
        workOrders.map((wo) => wo.id)
      );
    const closedTraceIds = new Set((closedEvents ?? []).map((e) => e.trace_id as string));

    const matelasByOdfId: Record<string, MatelasRow[]> = {};
    const traceOptionsByOdfId: Record<string, TraceOption[]> = {};
    for (const fiche of fiches ?? []) {
      const traces = (fiche.traces_placement ?? []) as unknown as {
        id: string;
        ordre: number;
        reference: string;
        repartition_par_couche: Record<string, number>;
        est_correctif: boolean;
        approuve_par: string | null;
        justification: string | null;
      }[];
      const usable = traces.filter((t) => !t.est_correctif || t.approuve_par);
      matelasByOdfId[fiche.odf_id as string] = usable
        .filter((t) => !closedTraceIds.has(t.id))
        .sort((a, b) => a.ordre - b.ordre)
        .map((t) => ({
          id: t.id,
          reference: t.reference,
          repartitionParCouche: t.repartition_par_couche ?? {},
          estCorrectif: t.est_correctif,
          justification: t.justification,
        }));
      // Lot 6 : le tracé d'origine (optionnel) d'un lot article peut être
      // n'importe quel matelas de la fiche, clôturé ou non.
      traceOptionsByOdfId[fiche.odf_id as string] = usable
        .sort((a, b) => a.ordre - b.ordre)
        .map((t) => ({ id: t.id, reference: t.reference }));
    }

    for (const wo of workOrders) {
      const poId = (wo.production_orders as unknown as { id: string } | null)?.id;
      if (poId && matelasByOdfId[poId]) matelasByWorkOrderId[wo.id] = matelasByOdfId[poId];
      if (poId && traceOptionsByOdfId[poId]) traceOptionsByWorkOrderId[wo.id] = traceOptionsByOdfId[poId];
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`File de travail — ${section?.name ?? ""}`}
        description={
          isCoupe
            ? "Clôturez les matelas au fur et à mesure — quantités pré-remplies depuis le Patronnage."
            : "Ajoutez la quantité produite au fur et à mesure sur vos ordres de travail."
        }
        action={
          sections.length > 0 ? <SectionSwitcher sections={sections} value={sectionId} /> : undefined
        }
      />

      <SectionBoard
        key={sectionId}
        sectionId={sectionId}
        initialWorkOrders={(workOrders ?? []) as unknown as WorkOrderRow[]}
        matelasByWorkOrderId={matelasByWorkOrderId}
        traceOptionsByWorkOrderId={traceOptionsByWorkOrderId}
        isCoupe={isCoupe}
        lotsByProductionOrderId={lotsByProductionOrderId}
        productionOrderOptions={productionOrderOptions}
        initialOpenWasteBags={openWasteBags}
        stockItemOptions={stockItemOptions}
      />
    </div>
  );
}
