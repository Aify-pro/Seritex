"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Plus,
  QrCode,
  Scissors,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { recordWorkOrderQuantity, closeMatelas, createArticleLot } from "./actions";
import { reportAnomaly } from "../production/actions";
import { QrScanButton } from "./qr-scan-button";
import { QueueSearch, normalizeSearch, type Suggestion } from "./queue-search";
import { WasteBagsPanel, PeseeQuickForm } from "./coupe-tools";
import {
  SizesContext,
  useSizes,
  type ArticleLotOption,
  type MatelasRow,
  type ProductionOrderOption,
  type QuantityEventRow,
  type StockItemOption,
  type TraceOption,
  type WasteBagRow,
  type WorkOrderContext,
  type WorkOrderRow,
} from "./types";
import type { Size } from "@/lib/sizes";

/**
 * File de travail du terminal de section — `chef_section`,
 * `responsable_production`, `administrateur`.
 *
 * Refonte mobile-first : la cible est un téléphone d'atelier tenu à une main,
 * pas un poste de bureau. D'où l'accordéon (une seule ligne ouverte à la
 * fois, pour ne pas perdre le fil en défilant), la barre d'actions collante
 * (recherche et scan toujours atteignables au pouce) et les saisies en modale
 * plein écran plutôt qu'en blocs imbriqués — trois niveaux d'imbrication sont
 * illisibles sur un écran de 360 px.
 *
 * Le gestionnaire de stock, lui, garde son écran d'avant : voir
 * `section-board-legacy.tsx`.
 */
export function SectionQueue({
  sectionId,
  initialWorkOrders,
  contextByWorkOrderId,
  matelasByWorkOrderId,
  traceOptionsByWorkOrderId,
  eventsByWorkOrderId,
  isCoupe,
  lotsByProductionOrderId,
  productionOrderOptions,
  initialOpenWasteBags,
  stockItemOptions,
  sizes,
}: {
  sectionId: string;
  initialWorkOrders: WorkOrderRow[];
  contextByWorkOrderId: Record<string, WorkOrderContext>;
  matelasByWorkOrderId: Record<string, MatelasRow[]>;
  traceOptionsByWorkOrderId: Record<string, TraceOption[]>;
  eventsByWorkOrderId: Record<string, QuantityEventRow[]>;
  isCoupe: boolean;
  lotsByProductionOrderId: Record<string, ArticleLotOption[]>;
  productionOrderOptions: ProductionOrderOption[];
  initialOpenWasteBags: WasteBagRow[];
  stockItemOptions: StockItemOption[];
  sizes: Size[];
}) {
  // `initialWorkOrders` change (nouvelle section, ou re-rendu serveur après
  // revalidation) : le composant est remonté via `key={sectionId}` côté page
  // plutôt que resynchronisé ici, pour éviter un setState en cascade dans un
  // effet — les mises à jour ultérieures arrivent par le canal realtime.
  const [orders, setOrders] = useState(initialWorkOrders);
  /**
   * Ligne dépliée. La recherche en désigne une d'elle-même (voir
   * `autoExpand`) ; ce qui est mémorisé ici, c'est le choix explicite de
   * l'opérateur — attaché à la recherche pour laquelle il a été fait, de sorte
   * qu'une nouvelle recherche reprenne la main sans avoir à être « annulée ».
   */
  const [manualExpansion, setManualExpansion] = useState<{
    query: string;
    workOrderId: string | null;
    matelasId: string | null;
  } | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [bagsOpen, setBagsOpen] = useState(false);
  // Détenu ici et non dans le panneau : le compteur de la barre collante en
  // dépend, et la fenêtre des sacs n'est pas montée tant qu'elle est fermée.
  const [wasteBags, setWasteBags] = useState(initialOpenWasteBags);
  const [query, setQuery] = useState("");
  // La frappe reste fluide même quand la file est longue : le filtrage est
  // recalculé en arrière-plan plutôt qu'à chaque touche.
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`work_orders_section_${sectionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `section_id=eq.${sectionId}` },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            setOrders((prev) =>
              prev.map((o) => (o.id === payload.new.id ? { ...o, ...(payload.new as Partial<WorkOrderRow>) } : o))
            );
          } else if (payload.eventType === "INSERT") {
            setOrders((prev) =>
              prev.some((o) => o.id === payload.new.id) ? prev : [...prev, payload.new as WorkOrderRow]
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sectionId]);

  /**
   * Un index de recherche par sous-ODF, construit une fois : référence du
   * sous-ODF, de l'ODF, nom du client, description de l'article, numéro d'OT
   * et référence de chaque matelas. Tout est normalisé d'avance — le coût
   * ne doit pas être payé à chaque frappe.
   */
  const index = useMemo(
    () =>
      orders.map((wo) => {
        const ctx = contextByWorkOrderId[wo.id];
        const matelas = matelasByWorkOrderId[wo.id] ?? [];
        return {
          id: wo.id,
          fields: {
            sousOdf: wo.reference,
            odf: wo.production_orders?.reference ?? null,
            client: wo.production_orders?.companies?.name ?? null,
            article: ctx?.articleDescription ?? null,
            ot: ctx?.numeroOt ?? null,
          },
          normalized: {
            sousOdf: normalizeSearch(wo.reference),
            odf: normalizeSearch(wo.production_orders?.reference ?? ""),
            client: normalizeSearch(wo.production_orders?.companies?.name ?? ""),
            article: normalizeSearch(ctx?.articleDescription ?? ""),
            ot: normalizeSearch(ctx?.numeroOt ?? ""),
          },
          matelas: matelas.map((m) => ({ id: m.id, reference: m.reference, normalized: normalizeSearch(m.reference) })),
        };
      }),
    [orders, contextByWorkOrderId, matelasByWorkOrderId]
  );

  const needle = normalizeSearch(deferredQuery);
  const searching = needle !== "";

  /** Sous-ODF retenus, et pour chacun les matelas qui ont fait la correspondance. */
  const matches = useMemo(() => {
    if (!searching) return null;
    const result = new Map<string, Set<string>>();
    for (const entry of index) {
      const matelasHits = entry.matelas.filter((m) => m.normalized.includes(needle));
      const selfHit = Object.values(entry.normalized).some((v) => v !== "" && v.includes(needle));
      if (selfHit || matelasHits.length > 0) {
        result.set(entry.id, new Set(matelasHits.map((m) => m.id)));
      }
    }
    return result;
  }, [index, needle, searching]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!searching) return [];
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const push = (s: Suggestion) => {
      const key = `${s.kind}|${s.label}|${s.workOrderId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };
    for (const entry of index) {
      const odfHint = entry.fields.odf ?? null;
      if (entry.normalized.sousOdf.includes(needle)) {
        push({ workOrderId: entry.id, kind: "Sous-ODF", label: entry.fields.sousOdf, hint: entry.fields.client });
      }
      if (entry.fields.odf && entry.normalized.odf.includes(needle)) {
        push({ workOrderId: entry.id, kind: "ODF", label: entry.fields.odf, hint: entry.fields.client });
      }
      if (entry.fields.client && entry.normalized.client.includes(needle)) {
        push({ workOrderId: entry.id, kind: "Client", label: entry.fields.client, hint: odfHint });
      }
      if (entry.fields.article && entry.normalized.article.includes(needle)) {
        push({ workOrderId: entry.id, kind: "Article", label: entry.fields.article, hint: odfHint });
      }
      if (entry.fields.ot && entry.normalized.ot.includes(needle)) {
        push({ workOrderId: entry.id, kind: "OT", label: entry.fields.ot, hint: odfHint });
      }
      for (const m of entry.matelas) {
        if (m.normalized.includes(needle)) {
          push({ workOrderId: entry.id, matelasId: m.id, kind: "Matelas", label: m.reference, hint: odfHint });
        }
      }
    }
    return out;
  }, [index, needle, searching]);

  const visibleOrders = matches ? orders.filter((o) => matches.has(o.id)) : orders;
  const enCours = visibleOrders.filter((o) => o.quantity_done < o.quantity_planned);
  const termines = visibleOrders.filter((o) => o.quantity_done >= o.quantity_planned);

  /**
   * Une recherche qui tombe sur un matelas doit montrer ce matelas, pas
   * seulement son sous-ODF : la ligne parente s'ouvre d'elle-même et le
   * matelas est surligné. Sans cela, l'opérateur qui tape « T3 » devrait
   * encore deviner laquelle des lignes filtrées déplier. Une recherche qui
   * ne ramène qu'un seul sous-ODF le déplie aussi — il n'y a rien d'autre à
   * choisir.
   */
  const autoExpand = useMemo(() => {
    if (!matches) return null;
    const hit = [...matches.entries()].find(([, matelasIds]) => matelasIds.size > 0);
    if (hit) return { workOrderId: hit[0], matelasId: [...hit[1]][0] ?? null };
    if (matches.size === 1) return { workOrderId: [...matches.keys()][0], matelasId: null };
    return null;
  }, [matches]);

  const manual = manualExpansion?.query === needle ? manualExpansion : null;
  const expandedId = manual ? manual.workOrderId : (autoExpand?.workOrderId ?? null);
  const highlightMatelasId = manual ? manual.matelasId : (autoExpand?.matelasId ?? null);

  const pickSuggestion = useCallback(
    (s: Suggestion) => {
      setManualExpansion({ query: needle, workOrderId: s.workOrderId, matelasId: s.matelasId ?? null });
      // Le rendu du déplié doit avoir eu lieu avant le défilement, sinon la
      // cible n'a pas encore sa position définitive.
      requestAnimationFrame(() => {
        document.getElementById(`wo-${s.workOrderId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [needle]
  );

  const toggle = useCallback(
    (id: string) => {
      setManualExpansion({ query: needle, workOrderId: expandedId === id ? null : id, matelasId: null });
    },
    [needle, expandedId]
  );

  return (
    <SizesContext.Provider value={sizes}>
      <div className="space-y-4">
        {/* Barre d'actions collante : sur un téléphone, la file défile mais
            la recherche et le scan doivent rester sous le pouce. Les marges
            négatives compensent le padding du gabarit pour que le fond
            opaque aille bien d'un bord à l'autre. */}
        <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-background px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:-mx-8 md:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <QueueSearch
              value={query}
              onChange={setQuery}
              suggestions={suggestions}
              onPick={pickSuggestion}
              resultCount={visibleOrders.length}
              totalCount={orders.length}
            />
            <div className="flex shrink-0 gap-2">
              <QrScanButton sectionId={sectionId} />
              {isCoupe && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setBagsOpen(true)}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4" />
                  Sacs ({wasteBags.length})
                </Button>
              )}
            </div>
          </div>
        </div>

        {searching && visibleOrders.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm text-foreground-muted">
              Aucun sous-ODF ne correspond à « {query.trim()} ».
            </p>
            <Button variant="secondary" onClick={() => setQuery("")}>
              Voir toute la file
            </Button>
          </div>
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                À produire ({enCours.length})
              </h3>
              <div className="overflow-hidden rounded-md border border-border">
                <AnimatePresence initial={false}>
                  {enCours.map((wo) => (
                    <WorkOrderAccordionRow
                      key={wo.id}
                      wo={wo}
                      context={contextByWorkOrderId[wo.id]}
                      expanded={expandedId === wo.id}
                      onToggle={() => toggle(wo.id)}
                      setOrders={setOrders}
                      matelas={matelasByWorkOrderId[wo.id]}
                      traceOptions={traceOptionsByWorkOrderId[wo.id] ?? []}
                      events={eventsByWorkOrderId[wo.id] ?? []}
                      highlightMatelasId={highlightMatelasId}
                      sectionId={sectionId}
                    />
                  ))}
                </AnimatePresence>
                {enCours.length === 0 && (
                  <p className="p-4 text-center text-xs text-foreground-muted">Aucun ordre en cours</p>
                )}
              </div>
            </section>

            {termines.length > 0 && (
              <section>
                <button
                  type="button"
                  onClick={() => setShowDone((v) => !v)}
                  className="mb-2 flex min-h-11 w-full items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showDone && "rotate-180")} />
                  Quantité atteinte ({termines.length})
                </button>
                {showDone && (
                  <div className="overflow-hidden rounded-md border border-border">
                    {termines.map((wo) => (
                      <WorkOrderAccordionRow
                        key={wo.id}
                        wo={wo}
                        context={contextByWorkOrderId[wo.id]}
                        expanded={expandedId === wo.id}
                        onToggle={() => toggle(wo.id)}
                        setOrders={setOrders}
                        matelas={matelasByWorkOrderId[wo.id]}
                        traceOptions={traceOptionsByWorkOrderId[wo.id] ?? []}
                        events={eventsByWorkOrderId[wo.id] ?? []}
                        highlightMatelasId={highlightMatelasId}
                        sectionId={sectionId}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* Lot 7 : sacs & pesées au niveau section, pas par sous-ODF — un sac
            n'appartient à aucun ODF en propre (mélange de productions accepté,
            section 17). Ils passent en fenêtre pour libérer le haut de l'écran,
            que la file de travail doit occuper seule. */}
        {isCoupe && (
          <Dialog
            open={bagsOpen}
            onOpenChange={setBagsOpen}
            title="Sacs de déchets et pesées"
            description="Section Coupe — un sac peut mélanger plusieurs ordres de fabrication."
            size="lg"
          >
            <div className="space-y-4">
              <WasteBagsPanel bags={wasteBags} setBags={setWasteBags} productionOrderOptions={productionOrderOptions} />
              <PeseeQuickForm
                productionOrderOptions={productionOrderOptions}
                lotsByProductionOrderId={lotsByProductionOrderId}
                stockItemOptions={stockItemOptions}
              />
            </div>
          </Dialog>
        )}
      </div>
    </SizesContext.Provider>
  );
}

/* ============================================================
   Une ligne de la file = un sous-ODF
============================================================ */

function WorkOrderAccordionRow({
  wo,
  context,
  expanded,
  onToggle,
  setOrders,
  matelas,
  traceOptions,
  events,
  highlightMatelasId,
  sectionId,
}: {
  wo: WorkOrderRow;
  context?: WorkOrderContext;
  expanded: boolean;
  onToggle: () => void;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
  /** Présent (même vide) uniquement pour un sous-ODF de la section Coupe (lot 4). */
  matelas?: MatelasRow[];
  traceOptions: TraceOption[];
  events: QuantityEventRow[];
  highlightMatelasId: string | null;
  sectionId: string;
}) {
  const [quantityOpen, setQuantityOpen] = useState(false);
  const [lotOpen, setLotOpen] = useState(false);
  const [anomalyOpen, setAnomalyOpen] = useState(false);
  const [closingMatelas, setClosingMatelas] = useState<MatelasRow | null>(null);

  const atteinte = wo.quantity_done >= wo.quantity_planned;
  const progress = wo.quantity_planned > 0 ? Math.min(100, (wo.quantity_done / wo.quantity_planned) * 100) : 0;
  const client = wo.production_orders?.companies?.name;
  const article = context?.articleDescription;

  return (
    <motion.div layout id={`wo-${wo.id}`} className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 bg-surface px-3 py-3 text-left hover:bg-surface-muted"
      >
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-foreground-muted transition-transform", expanded && "rotate-180")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{wo.reference}</span>
            {atteinte && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
          </span>
          <span className="mt-0.5 block truncate text-xs text-foreground-muted">
            {[client, wo.production_orders?.reference, article].filter(Boolean).join(" · ") || "—"}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <span
                className={cn("block h-full rounded-full transition-all", atteinte ? "bg-success" : "bg-brand")}
                style={{ width: `${progress}%` }}
              />
            </span>
            <span className="shrink-0 text-xs tabular-nums text-foreground-muted">
              {wo.quantity_done}/{wo.quantity_planned} pièces
            </span>
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden bg-background"
          >
            <div className="space-y-3 px-3 py-3">
              {wo.blocking_reason && (
                <p className="rounded-md bg-danger-soft px-2.5 py-2 text-xs text-danger">⚠ {wo.blocking_reason}</p>
              )}
              {context?.numeroOt && (
                <p className="text-xs text-foreground-muted">
                  Ordre de traçage <span className="font-mono">{context.numeroOt}</span>
                </p>
              )}
              {wo.actual_start && (
                <p className="text-xs text-foreground-muted">Démarré le {formatDateTime(wo.actual_start)}</p>
              )}

              {matelas !== undefined ? (
                <MatelasList
                  matelas={matelas}
                  highlightMatelasId={highlightMatelasId}
                  onCloturer={(m) => setClosingMatelas(m)}
                />
              ) : (
                <>
                  <QuantityHistory events={events} />
                  <Button size="md" className="w-full" onClick={() => setQuantityOpen(true)}>
                    <Plus className="h-4 w-4" /> Ajouter une quantité
                  </Button>
                </>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {matelas !== undefined && wo.production_orders && (
                  <Button size="md" variant="secondary" className="w-full sm:w-auto" onClick={() => setLotOpen(true)}>
                    <QrCode className="h-4 w-4" /> Créer un lot
                  </Button>
                )}
                {/* Lot 5 : signalement transverse, jamais bloquant — n'empêche pas de continuer le travail. */}
                <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => setAnomalyOpen(true)}>
                  <TriangleAlert className="h-4 w-4" /> Signaler une anomalie
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {closingMatelas && (
        <MatelasCloseDialog
          workOrderId={wo.id}
          matelas={closingMatelas}
          onDone={() => setClosingMatelas(null)}
        />
      )}
      <QuantityDialog
        open={quantityOpen}
        onOpenChange={setQuantityOpen}
        wo={wo}
        setOrders={setOrders}
      />
      {wo.production_orders && (
        <CreateLotDialog
          open={lotOpen}
          onOpenChange={setLotOpen}
          productionOrderId={wo.production_orders.id}
          traceOptions={traceOptions}
        />
      )}
      <AnomalyDialog
        open={anomalyOpen}
        onOpenChange={setAnomalyOpen}
        productionOrderId={wo.production_orders?.id ?? null}
        workOrderId={wo.id}
        sectionId={sectionId}
      />
    </motion.div>
  );
}

/* ============================================================
   Section Coupe — matelas d'un sous-ODF
============================================================ */

function MatelasList({
  matelas,
  highlightMatelasId,
  onCloturer,
}: {
  matelas: MatelasRow[];
  highlightMatelasId: string | null;
  onCloturer: (matelas: MatelasRow) => void;
}) {
  if (matelas.length === 0) {
    return <p className="text-xs text-foreground-muted">Aucun matelas en attente de clôture.</p>;
  }

  return (
    <ul className="space-y-2">
      {matelas.map((m) => (
        <li
          key={m.id}
          className={cn(
            "rounded-md border border-border bg-surface p-2.5",
            highlightMatelasId === m.id && "border-brand ring-2 ring-brand/30"
          )}
        >
          <div className="flex items-center gap-2">
            <Scissors className="h-4 w-4 shrink-0 text-foreground-muted" />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{m.reference}</span>
            {m.estCorrectif && (
              <span className="shrink-0 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning">
                rattrapage
              </span>
            )}
          </div>
          <Button size="md" className="mt-2 w-full" onClick={() => onCloturer(m)}>
            Clôturer
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Clôture d'un matelas — en modale plein écran plutôt qu'en accordéon
 * imbriqué : le formulaire compte déjà plusieurs champs, et l'imbriquer sous
 * une ligne déjà dépliée donnait trois niveaux illisibles sur un téléphone.
 *
 * Le contenu du formulaire (quantités par couche, poids déchet, justification)
 * est celui d'aujourd'hui, sans changement de mécanique : les totaux en
 * pièces, le nombre de couches réelles et les mesures du matelas arrivent
 * avec le lot C, en même temps que la nouvelle signature de `close_matelas`.
 */
function MatelasCloseDialog({
  workOrderId,
  matelas,
  onDone,
}: {
  workOrderId: string;
  matelas: MatelasRow;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Tailles réellement posées sur ce matelas, présentées dans l'ordre du
  // référentiel plutôt que dans celui, arbitraire, des clés du JSON.
  const referentiel = useSizes();
  const tailles = referentiel.filter((t) => (matelas.repartitionParCouche[t.cle] ?? 0) > 0).map((t) => t.cle);
  const libelleDe = (cle: string) => referentiel.find((t) => t.cle === cle)?.libelle ?? cle;
  const [quantites, setQuantites] = useState<Record<string, number>>(
    Object.fromEntries(tailles.map((k) => [k, matelas.repartitionParCouche[k] ?? 0]))
  );
  const [poidsDechet, setPoidsDechet] = useState("");
  const [justification, setJustification] = useState("");

  const manque = tailles.some((k) => (quantites[k] ?? 0) < (matelas.repartitionParCouche[k] ?? 0));
  const poidsManquant = poidsDechet.trim() === "" || Number(poidsDechet) < 0;
  const justificationManquante = manque && !justification.trim();
  // Le bouton désactivé dit pourquoi il l'est : un bouton muet sur un écran
  // d'atelier, c'est un appel au chef de production.
  const blocage = poidsManquant
    ? "Renseignez le poids des déchets (kg, ≥ 0) pour clôturer."
    : justificationManquante
      ? "Justification obligatoire : au moins une quantité est inférieure au pré-rempli."
      : null;

  function submit() {
    setError(null);
    if (blocage) return;
    startTransition(async () => {
      const res = await closeMatelas(workOrderId, matelas.id, quantites, Number(poidsDechet), justification);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.success(`${matelas.reference} clôturé`);
      onDone();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
      title={`Clôturer ${matelas.reference}`}
      description={matelas.estCorrectif ? "Tracé de rattrapage" : undefined}
      size="lg"
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Quantités obtenues par couche
          </legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tailles.map((k) => (
              <div key={k}>
                <label htmlFor={`qte-${matelas.id}-${k}`} className="block text-xs text-foreground-muted">
                  {libelleDe(k)}
                </label>
                <input
                  id={`qte-${matelas.id}-${k}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={matelas.repartitionParCouche[k] ?? 0}
                  value={quantites[k] ?? 0}
                  onChange={(e) => setQuantites((q) => ({ ...q, [k]: Number(e.target.value) }))}
                  className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
                />
                <p className="mt-0.5 text-[11px] text-foreground-muted">
                  pré-rempli {matelas.repartitionParCouche[k] ?? 0}
                </p>
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`dechet-${matelas.id}`} className="block text-xs text-foreground-muted">
            Poids des déchets (kg)
          </label>
          <input
            id={`dechet-${matelas.id}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={poidsDechet}
            onChange={(e) => setPoidsDechet(e.target.value)}
            className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>

        {manque && (
          <div>
            <label htmlFor={`justif-${matelas.id}`} className="block text-xs text-foreground-muted">
              Justification (obligatoire — quantité inférieure au pré-rempli)
            </label>
            <textarea
              id={`justif-${matelas.id}`}
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="ex. erreur de ciseaux"
              className="w-full rounded-md border border-border bg-surface p-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
            />
            <p className="mt-1 text-[11px] text-foreground-muted">
              Un tracé de rattrapage sera demandé automatiquement.
            </p>
          </div>
        )}

        {/* Barre d'action en bas de la modale : c'est là que le pouce tombe. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-border bg-surface px-5 py-3">
          {blocage && <p className="text-xs text-warning">{blocage}</p>}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button size="md" className="w-full sm:w-auto" onClick={submit} loading={pending} disabled={!!blocage}>
              Clôturer le matelas
            </Button>
            <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={onDone}>
              Annuler
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* ============================================================
   Sections hors Coupe — saisie de quantité et historique
============================================================ */

function QuantityHistory({ events }: { events: QuantityEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-foreground-muted">Aucune saisie enregistrée pour l&apos;instant.</p>;
  }

  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        Dernières saisies
      </h4>
      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {events.map((e) => (
          <li key={e.id} className="flex items-baseline gap-2 px-2.5 py-2 text-xs">
            <span className="shrink-0 font-medium tabular-nums text-foreground">+{e.quantity ?? 0}</span>
            <span className="min-w-0 flex-1 truncate text-foreground-muted">
              {e.authorName ?? "—"}
              {e.comment ? ` · ${e.comment}` : ""}
            </span>
            <span className="shrink-0 text-foreground-muted">{formatDateTime(e.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuantityDialog({
  open,
  onOpenChange,
  wo,
  setOrders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wo: WorkOrderRow;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
}) {
  const [pending, startTransition] = useTransition();
  const reste = Math.max(wo.quantity_planned - wo.quantity_done, 0);
  // `null` = « pas encore touché », et le champ affiche alors le reste à
  // faire. Stocker la saisie plutôt que la valeur affichée évite d'avoir à
  // resynchroniser le pré-remplissage quand le reste bouge (realtime, saisie
  // d'un collègue) tant que la modale est fermée.
  const [saisie, setSaisie] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const qty = saisie ?? reste;

  function submit() {
    if (!qty) return;
    const previousDone = wo.quantity_done;
    const commentaire = comment.trim();
    setOrders((prev) => prev.map((o) => (o.id === wo.id ? { ...o, quantity_done: o.quantity_done + qty } : o)));
    onOpenChange(false);
    startTransition(async () => {
      const res = await recordWorkOrderQuantity(wo.id, qty, commentaire || undefined);
      if (res.error) {
        setOrders((prev) => prev.map((o) => (o.id === wo.id ? { ...o, quantity_done: previousDone } : o)));
        toast.error("Action refusée", { description: res.error });
      } else {
        toast.success(`${wo.reference} : +${qty} pièce(s)`);
        setSaisie(null);
        setComment("");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Ajouter une quantité — ${wo.reference}`}
      description={`${wo.quantity_done}/${wo.quantity_planned} pièces produites, reste ${reste}.`}
      size="md"
    >
      <div className="space-y-4">
        <div>
          <label htmlFor={`qty-${wo.id}`} className="block text-xs text-foreground-muted">
            Quantité produite à ajouter
          </label>
          <input
            id={`qty-${wo.id}`}
            type="number"
            inputMode="numeric"
            min={0}
            autoFocus
            value={qty}
            onChange={(e) => setSaisie(Number(e.target.value))}
            className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div>
          <label htmlFor={`comment-${wo.id}`} className="block text-xs text-foreground-muted">
            Commentaire <span className="text-foreground-muted">(facultatif)</span>
          </label>
          <textarea
            id={`comment-${wo.id}`}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="md" className="w-full sm:w-auto" onClick={submit} disabled={!qty} loading={pending}>
            Valider
          </Button>
          <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ============================================================
   Lot article (lot 6, section Coupe) et signalement d'anomalie
============================================================ */

const CATEGORIE_LABELS = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" } as const;

function CreateLotDialog({
  open,
  onOpenChange,
  productionOrderId,
  traceOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productionOrderId: string;
  traceOptions: TraceOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [categorie, setCategorie] = useState<"semi_fini" | "fini" | "dechet">("fini");
  const [traceId, setTraceId] = useState("");
  const [composition, setComposition] = useState<Record<string, number>>({});
  const [lastCode, setLastCode] = useState<string | null>(null);
  const tailleOptions = useSizes();

  function submit() {
    const nonZero = Object.fromEntries(Object.entries(composition).filter(([, v]) => v > 0));
    startTransition(async () => {
      const res = await createArticleLot(productionOrderId, categorie, nonZero, traceId || null);
      if ("error" in res) {
        toast.error("Action refusée", { description: res.error });
        return;
      }
      setLastCode(res.code);
      setComposition({});
      toast.success(`Lot ${res.code} généré`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Créer un lot article" size="lg">
      <div className="space-y-4">
        {lastCode && (
          <a
            href={`/lots/${lastCode}`}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border border-success/30 bg-success-soft px-2.5 py-2 text-sm text-success hover:underline"
          >
            Lot {lastCode} généré — voir le QR à imprimer →
          </a>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lot-categorie" className="block text-xs text-foreground-muted">
              Catégorie
            </label>
            <select
              id="lot-categorie"
              value={categorie}
              onChange={(e) => setCategorie(e.target.value as typeof categorie)}
              className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
            >
              {Object.entries(CATEGORIE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {traceOptions.length > 0 && (
            <div>
              <label htmlFor="lot-trace" className="block text-xs text-foreground-muted">
                Tracé d&apos;origine (optionnel)
              </label>
              <select
                id="lot-trace"
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">Aucun</option>
                {traceOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.reference}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs text-foreground-muted">
            Composition par taille (libre — pas de contrôle automatique)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tailleOptions.map((t) => (
              <input
                key={t.cle}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder={t.libelle}
                aria-label={`Quantité taille ${t.libelle}`}
                value={composition[t.cle] ?? ""}
                onChange={(e) => setComposition((c) => ({ ...c, [t.cle]: Number(e.target.value) }))}
                className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="md" className="w-full sm:w-auto" onClick={submit} loading={pending}>
            Générer le lot
          </Button>
          <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AnomalyDialog({
  open,
  onOpenChange,
  productionOrderId,
  workOrderId,
  sectionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productionOrderId: string | null;
  workOrderId: string;
  sectionId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function submit() {
    if (!message.trim() || !productionOrderId) return;
    startTransition(async () => {
      const res = await reportAnomaly(productionOrderId, message.trim(), { sectionId, workOrderId });
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success("Anomalie signalée");
        setMessage("");
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Signaler une anomalie"
      description="Le signalement n'interrompt pas votre travail — continuez la production."
      size="md"
    >
      <div className="space-y-4">
        {!productionOrderId && (
          <p className="text-sm text-warning">
            Ce sous-ODF n&apos;est rattaché à aucun ordre de fabrication lisible — impossible de signaler ici.
          </p>
        )}
        <div>
          <label htmlFor={`anomalie-${workOrderId}`} className="block text-xs text-foreground-muted">
            Décrire l&apos;incident
          </label>
          <textarea
            id={`anomalie-${workOrderId}`}
            rows={4}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            size="md"
            className="w-full sm:w-auto"
            loading={pending}
            disabled={!message.trim() || !productionOrderId}
            onClick={submit}
          >
            Envoyer
          </Button>
          <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
