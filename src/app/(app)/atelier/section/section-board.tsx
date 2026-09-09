"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  recordWorkOrderQuantity,
  closeMatelas,
  createArticleLot,
  recordPesee,
  createWasteBag,
  recordBagWeighing,
  closeWasteBag,
} from "./actions";
import { reportAnomaly } from "../production/actions";
import { toast } from "sonner";
import { CheckCircle2, Package, Plus, Scissors, AlertTriangle, TriangleAlert, QrCode, Weight, Trash2 } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { REPARTITION_TAILLES_KEYS } from "@/lib/patronnage/types";
import type { RepartitionTailles } from "@/lib/patronnage/types";

export type WorkOrderRow = {
  id: string;
  reference: string;
  quantity_planned: number;
  quantity_done: number;
  blocking_reason: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  production_orders: {
    id: string;
    reference: string;
    company_id: string;
    companies?: { name: string } | null;
  } | null;
};

/** Lot 4 : un matelas = un tracé Patronnage d'une fiche "Bon pour coupe", pas encore clôturé. */
export type MatelasRow = {
  id: string;
  reference: string;
  repartitionParCouche: RepartitionTailles;
  estCorrectif: boolean;
  justification: string | null;
};

/** Lot 6 : tracé d'origine optionnel d'un lot article — clôturé ou non. */
export type TraceOption = { id: string; reference: string };

/** Lot 7 : ODF visible dans la file Coupe, pour rattacher une pesée. */
export type ProductionOrderOption = { id: string; reference: string; companyName: string | null };

/** Lot 7 : lot article disponible pour une pesée de sortie (type sortie_lot). */
export type ArticleLotOption = { id: string; code: string; categorie: string };

/** Lot 7 : sac de déchets ouvert (statut en_cours), avec son dernier relevé connu. */
export type WasteBagRow = { id: string; code: string; currentWeightKg: number; createdAt: string };

/** Lot 10 : article du miroir Sage (stock_item_view), pour rattacher une pesée reception_tissu/retour_stock. */
export type StockItemOption = { sageReference: string; designation: string };

export function SectionBoard({
  sectionId,
  initialWorkOrders,
  matelasByWorkOrderId = {},
  traceOptionsByWorkOrderId = {},
  isCoupe = false,
  lotsByProductionOrderId = {},
  productionOrderOptions = [],
  initialOpenWasteBags = [],
  stockItemOptions = [],
}: {
  sectionId: string;
  initialWorkOrders: WorkOrderRow[];
  matelasByWorkOrderId?: Record<string, MatelasRow[]>;
  traceOptionsByWorkOrderId?: Record<string, TraceOption[]>;
  /** Lot 7 : section Coupe uniquement (sections 16/17 du document de logique). */
  isCoupe?: boolean;
  lotsByProductionOrderId?: Record<string, ArticleLotOption[]>;
  productionOrderOptions?: ProductionOrderOption[];
  initialOpenWasteBags?: WasteBagRow[];
  /** Lot 10 : miroir Sage — peut être vide si jamais synchronisé (Paramètres > Stock). */
  stockItemOptions?: StockItemOption[];
}) {
  // `initialWorkOrders` change (nouvelle section, ou re-rendu serveur après
  // revalidation) : le composant est remonté via `key={sectionId}` côté page
  // plutôt que resynchronisé ici, pour éviter un setState en cascade dans un
  // effet — les mises à jour ultérieures arrivent par le canal realtime.
  const [orders, setOrders] = useState(initialWorkOrders);

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

  const enCours = orders.filter((o) => o.quantity_done < o.quantity_planned);
  const termines = orders.filter((o) => o.quantity_done >= o.quantity_planned);

  return (
    <div className="space-y-6">
      {/* Lot 7 : pesées & sacs de déchets — au niveau section, pas par
          sous-ODF, puisqu'un sac n'appartient à aucun ODF en propre (mélange
          de productions accepté, section 17 du document de logique). */}
      {isCoupe && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <WasteBagsPanel initialBags={initialOpenWasteBags} productionOrderOptions={productionOrderOptions} />
          <PeseeQuickForm
            productionOrderOptions={productionOrderOptions}
            lotsByProductionOrderId={lotsByProductionOrderId}
            stockItemOptions={stockItemOptions}
          />
        </div>
      )}

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          À produire ({enCours.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {enCours.map((wo) => (
              <WorkOrderCard
                key={wo.id}
                wo={wo}
                setOrders={setOrders}
                matelas={matelasByWorkOrderId[wo.id]}
                traceOptions={traceOptionsByWorkOrderId[wo.id] ?? []}
                sectionId={sectionId}
              />
            ))}
          </AnimatePresence>
          {enCours.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-foreground-muted sm:col-span-2 lg:col-span-3">
              Aucun ordre en cours
            </div>
          )}
        </div>
      </div>

      {termines.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Quantité atteinte ({termines.length})
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {termines.map((wo) => (
              <WorkOrderCard
                key={wo.id}
                wo={wo}
                setOrders={setOrders}
                matelas={matelasByWorkOrderId[wo.id]}
                traceOptions={traceOptionsByWorkOrderId[wo.id] ?? []}
                sectionId={sectionId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkOrderCard({
  wo,
  setOrders,
  matelas,
  traceOptions,
  sectionId,
}: {
  wo: WorkOrderRow;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
  /** Présent (même vide) uniquement pour un sous-ODF de la section Coupe (lot 4). */
  matelas?: MatelasRow[];
  /** Lot 6 : tracés disponibles (clôturés ou non) pour lier un lot article. */
  traceOptions: TraceOption[];
  sectionId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [qty, setQty] = useState(Math.max(wo.quantity_planned - wo.quantity_done, 0));
  const [showAnomalyForm, setShowAnomalyForm] = useState(false);
  const [anomalyMessage, setAnomalyMessage] = useState("");
  const [anomalyPending, startAnomalyTransition] = useTransition();
  const atteinte = wo.quantity_done >= wo.quantity_planned;

  function submitAnomaly() {
    if (!anomalyMessage.trim() || !wo.production_orders) return;
    startAnomalyTransition(async () => {
      const res = await reportAnomaly(wo.production_orders!.id, anomalyMessage.trim(), {
        sectionId,
        workOrderId: wo.id,
      });
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success("Anomalie signalée");
        setAnomalyMessage("");
        setShowAnomalyForm(false);
      }
    });
  }

  function submitQuantity() {
    if (!qty) return;
    const previousDone = wo.quantity_done;
    setOrders((prev) => prev.map((o) => (o.id === wo.id ? { ...o, quantity_done: o.quantity_done + qty } : o)));
    startTransition(async () => {
      const res = await recordWorkOrderQuantity(wo.id, qty);
      if (res.error) {
        setOrders((prev) => prev.map((o) => (o.id === wo.id ? { ...o, quantity_done: previousDone } : o)));
        toast.error("Action refusée", { description: res.error });
      } else {
        toast.success(`${wo.reference} : +${qty} pièce(s)`);
      }
    });
    setShowAddForm(false);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
    >
      <Card className={cn("p-4", atteinte && "border-success/40")}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{wo.reference}</p>
            <p className="text-xs text-foreground-muted">
              {wo.production_orders?.companies?.name ?? "—"} · {wo.production_orders?.reference}
            </p>
          </div>
          {atteinte ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          ) : (
            <Package className="h-4 w-4 shrink-0 text-foreground-muted" />
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <span>
            {wo.quantity_done}/{wo.quantity_planned} pièces
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn("h-full rounded-full transition-all", atteinte ? "bg-success" : "bg-brand")}
            style={{ width: `${Math.min(100, (wo.quantity_done / wo.quantity_planned) * 100)}%` }}
          />
        </div>

        {wo.blocking_reason && (
          <p className="mt-2 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">⚠ {wo.blocking_reason}</p>
        )}

        {/* Lot 5 : signalement transverse, jamais bloquant — n'empêche pas de continuer le travail. */}
        {!showAnomalyForm ? (
          <button
            onClick={() => setShowAnomalyForm(true)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground-muted hover:text-warning"
          >
            <TriangleAlert className="h-3 w-3" /> Signaler une anomalie
          </button>
        ) : (
          <div className="mt-2 space-y-1.5 rounded-md border border-warning/30 bg-warning-soft/40 p-2">
            <textarea
              autoFocus
              rows={2}
              value={anomalyMessage}
              onChange={(e) => setAnomalyMessage(e.target.value)}
              placeholder="Décrire l'incident"
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex gap-1.5">
              <Button size="sm" loading={anomalyPending} disabled={!anomalyMessage.trim()} onClick={submitAnomaly}>
                Envoyer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAnomalyForm(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {wo.actual_start && (
          <p className="mt-2 text-[11px] text-foreground-muted">Démarré le {formatDateTime(wo.actual_start)}</p>
        )}

        {matelas !== undefined ? (
          <>
            <MatelasList workOrderId={wo.id} matelas={matelas} />
            {wo.production_orders && (
              <CreateLotButton productionOrderId={wo.production_orders.id} traceOptions={traceOptions} />
            )}
          </>
        ) : !showAddForm ? (
          <div className="mt-3">
            <Button size="sm" onClick={() => setShowAddForm(true)} loading={pending}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une quantité
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] text-foreground-muted">Quantité produite à ajouter</label>
            <input
              type="number"
              autoFocus
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={submitQuantity} disabled={!qty} loading={pending}>
                Valider
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

/* ============================================================
   Clôture de matelas (lot 4, section Coupe)
============================================================ */

function MatelasList({ workOrderId, matelas }: { workOrderId: string; matelas: MatelasRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (matelas.length === 0) {
    return <p className="mt-3 text-xs text-foreground-muted">Aucun matelas en attente de clôture.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {matelas.map((m) =>
        openId === m.id ? (
          <MatelasCloseForm key={m.id} workOrderId={workOrderId} matelas={m} onDone={() => setOpenId(null)} />
        ) : (
          <button
            key={m.id}
            onClick={() => setOpenId(m.id)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-xs hover:bg-surface-muted"
          >
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <Scissors className="h-3.5 w-3.5 text-foreground-muted" /> {m.reference}
              {m.estCorrectif && <span className="text-warning">(rattrapage)</span>}
            </span>
            <span className="text-foreground-muted">Clôturer</span>
          </button>
        )
      )}
    </div>
  );
}

function MatelasCloseForm({
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
  const tailles = REPARTITION_TAILLES_KEYS.filter((k) => (matelas.repartitionParCouche[k] ?? 0) > 0);
  const [quantites, setQuantites] = useState<Record<string, number>>(
    Object.fromEntries(tailles.map((k) => [k, matelas.repartitionParCouche[k] ?? 0]))
  );
  const [poidsDechet, setPoidsDechet] = useState("");
  const [justification, setJustification] = useState("");

  const manque = tailles.some((k) => (quantites[k] ?? 0) < (matelas.repartitionParCouche[k] ?? 0));

  function submit() {
    setError(null);
    if (poidsDechet.trim() === "" || Number(poidsDechet) < 0) {
      setError("Poids des déchets obligatoire (kg, ≥ 0).");
      return;
    }
    if (manque && !justification.trim()) {
      setError("Justification obligatoire : au moins une quantité est inférieure au pré-rempli.");
      return;
    }
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
    <div className="space-y-2 rounded-md border border-brand/30 bg-brand-soft/30 p-3">
      <p className="text-xs font-medium text-foreground">{matelas.reference}</p>
      {error && (
        <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {tailles.map((k) => (
          <div key={k}>
            <label className="block text-[10px] text-foreground-muted">{k}</label>
            <input
              type="number"
              min={0}
              max={matelas.repartitionParCouche[k] ?? 0}
              value={quantites[k] ?? 0}
              onChange={(e) => setQuantites((q) => ({ ...q, [k]: Number(e.target.value) }))}
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
        ))}
      </div>
      <div>
        <label className="block text-[10px] text-foreground-muted">Poids des déchets (kg)</label>
        <input
          type="number"
          min={0}
          step="0.01"
          value={poidsDechet}
          onChange={(e) => setPoidsDechet(e.target.value)}
          className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      {manque && (
        <div>
          <label className="block text-[10px] text-foreground-muted">
            Justification (obligatoire — quantité inférieure au pré-rempli)
          </label>
          <textarea
            rows={2}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="ex. erreur de ciseaux"
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      )}
      <div className="flex gap-1.5">
        <Button size="sm" onClick={submit} loading={pending}>
          Clôturer le matelas
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Génération d'un lot article (lot 6, section Coupe)
============================================================ */

const CATEGORIE_LABELS = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" } as const;

function CreateLotButton({
  productionOrderId,
  traceOptions,
}: {
  productionOrderId: string;
  traceOptions: TraceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [categorie, setCategorie] = useState<"semi_fini" | "fini" | "dechet">("fini");
  const [traceId, setTraceId] = useState("");
  const [composition, setComposition] = useState<Record<string, number>>({});
  const [lastCode, setLastCode] = useState<string | null>(null);

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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-foreground-muted hover:text-brand"
      >
        <QrCode className="h-3 w-3" /> Créer un lot
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-brand/30 bg-brand-soft/30 p-2">
      {lastCode && (
        <a
          href={`/lots/${lastCode}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-md border border-success/30 bg-success-soft px-2 py-1.5 text-xs text-success hover:underline"
        >
          Lot {lastCode} généré — voir le QR à imprimer →
        </a>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-foreground-muted">Catégorie</label>
          <select
            value={categorie}
            onChange={(e) => setCategorie(e.target.value as typeof categorie)}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
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
            <label className="block text-[10px] text-foreground-muted">Tracé d&apos;origine (optionnel)</label>
            <select
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
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
        <label className="block text-[10px] text-foreground-muted">
          Composition par taille (libre — pas de contrôle automatique)
        </label>
        <div className="grid grid-cols-4 gap-1.5">
          {REPARTITION_TAILLES_KEYS.map((k) => (
            <input
              key={k}
              type="number"
              min={0}
              placeholder={k}
              value={composition[k] ?? ""}
              onChange={(e) => setComposition((c) => ({ ...c, [k]: Number(e.target.value) }))}
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
          ))}
        </div>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={submit} loading={pending}>
          Générer le lot
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   Sacs de déchets — pesée incrémentale par différence (lot 7, section 17)
============================================================ */

function WasteBagsPanel({
  initialBags,
  productionOrderOptions,
}: {
  initialBags: WasteBagRow[];
  productionOrderOptions: ProductionOrderOption[];
}) {
  const [bags, setBags] = useState(initialBags);
  const [creating, startCreating] = useTransition();
  const [openWeighId, setOpenWeighId] = useState<string | null>(null);
  const [lastClosedCode, setLastClosedCode] = useState<string | null>(null);

  function handleCreate() {
    startCreating(async () => {
      const res = await createWasteBag();
      if ("error" in res) {
        toast.error("Action refusée", { description: res.error });
        return;
      }
      setBags((prev) => [{ id: res.id, code: res.code, currentWeightKg: 0, createdAt: new Date().toISOString() }, ...prev]);
      toast.success(`Sac ${res.code} créé`);
    });
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Sacs de déchets en cours ({bags.length})
        </h3>
        <Button size="sm" variant="secondary" onClick={handleCreate} loading={creating}>
          <Plus className="h-3.5 w-3.5" /> Nouveau sac
        </Button>
      </div>

      {lastClosedCode && (
        <a
          href={`/dechets/${lastClosedCode}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block rounded-md border border-success/30 bg-success-soft px-2 py-1.5 text-xs text-success hover:underline"
        >
          Sac {lastClosedCode} chargé — voir l&apos;étiquette à imprimer →
        </a>
      )}

      {bags.length === 0 ? (
        <p className="mt-3 text-xs text-foreground-muted">Aucun sac ouvert — créez-en un pour démarrer une pesée.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {bags.map((bag) =>
            openWeighId === bag.id ? (
              <WeighBagForm
                key={bag.id}
                bag={bag}
                productionOrderOptions={productionOrderOptions}
                onDone={(updated) => {
                  setOpenWeighId(null);
                  if (updated === null) {
                    setLastClosedCode(bag.code);
                    setBags((prev) => prev.filter((b) => b.id !== bag.id));
                  } else {
                    setBags((prev) => prev.map((b) => (b.id === bag.id ? { ...b, currentWeightKg: updated } : b)));
                  }
                }}
              />
            ) : (
              <li
                key={bag.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-xs"
              >
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <Trash2 className="h-3.5 w-3.5 text-foreground-muted" /> {bag.code}
                  <span className="text-foreground-muted">— {bag.currentWeightKg} kg</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => setOpenWeighId(bag.id)}>
                  <Weight className="h-3.5 w-3.5" /> Peser
                </Button>
              </li>
            )
          )}
        </ul>
      )}
    </Card>
  );
}

function WeighBagForm({
  bag,
  productionOrderOptions,
  onDone,
}: {
  bag: WasteBagRow;
  productionOrderOptions: ProductionOrderOption[];
  /** null = le sac a été chargé (retiré de la liste des sacs ouverts), sinon nouveau poids courant. */
  onDone: (updatedWeightKg: number | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [closing, startClosing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [poidsReleve, setPoidsReleve] = useState("");
  const [productionOrderId, setProductionOrderId] = useState(productionOrderOptions[0]?.id ?? "");

  function submitWeighing() {
    setError(null);
    if (!productionOrderId) {
      setError("Choisissez l'ordre de fabrication concerné par cet ajout.");
      return;
    }
    if (poidsReleve.trim() === "" || Number(poidsReleve) < 0) {
      setError("Poids relevé invalide (kg, ≥ 0).");
      return;
    }
    startTransition(async () => {
      const res = await recordBagWeighing(bag.id, Number(poidsReleve), productionOrderId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success(`+${res.deltaKg} kg ajoutés au sac ${bag.code}`);
      onDone(Number(poidsReleve));
    });
  }

  function submitClose() {
    startClosing(async () => {
      const res = await closeWasteBag(bag.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.success(`Sac ${bag.code} chargé`);
      onDone(null);
    });
  }

  return (
    <li className="space-y-2 rounded-md border border-brand/30 bg-brand-soft/30 p-3">
      <p className="text-xs font-medium text-foreground">
        {bag.code} — dernier relevé : {bag.currentWeightKg} kg
      </p>
      {error && (
        <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-foreground-muted">Ordre de fabrication</label>
          <select
            value={productionOrderId}
            onChange={(e) => setProductionOrderId(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          >
            {productionOrderOptions.length === 0 && <option value="">Aucun ODF disponible</option>}
            {productionOrderOptions.map((po) => (
              <option key={po.id} value={po.id}>
                {po.reference}
                {po.companyName ? ` · ${po.companyName}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-foreground-muted">Nouveau poids total du sac (kg)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            autoFocus
            value={poidsReleve}
            onChange={(e) => setPoidsReleve(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={submitWeighing} loading={pending}>
          Enregistrer le relevé
        </Button>
        <Button size="sm" variant="danger" onClick={submitClose} loading={closing}>
          Marquer chargé
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(bag.currentWeightKg)}>
          Annuler
        </Button>
      </div>
    </li>
  );
}

/* ============================================================
   Pesée rapide — reception_tissu / sortie_lot / retour_stock (lot 7, section 16)
============================================================ */

const PESEE_TYPE_LABELS = {
  reception_tissu: "Réception tissu",
  sortie_lot: "Sortie lot article",
  retour_stock: "Retour stock",
} as const;

function PeseeQuickForm({
  productionOrderOptions,
  lotsByProductionOrderId,
  stockItemOptions,
}: {
  productionOrderOptions: ProductionOrderOption[];
  lotsByProductionOrderId: Record<string, ArticleLotOption[]>;
  stockItemOptions: StockItemOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<keyof typeof PESEE_TYPE_LABELS>("reception_tissu");
  const [productionOrderId, setProductionOrderId] = useState(productionOrderOptions[0]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [poidsKg, setPoidsKg] = useState("");
  // Lot 10 : article Sage concerné (reception_tissu/retour_stock uniquement)
  // — optionnel, alimente le mouvement de stock sortie_mp/retour_mp sans
  // bloquer la pesée si le miroir Sage n'est pas encore synchronisé.
  const [articleRef, setArticleRef] = useState("");

  const availableLots = lotsByProductionOrderId[productionOrderId] ?? [];

  function submit() {
    setError(null);
    if (!productionOrderId) {
      setError("Choisissez l'ordre de fabrication concerné.");
      return;
    }
    if (poidsKg.trim() === "" || Number(poidsKg) <= 0) {
      setError("Poids invalide (kg, > 0).");
      return;
    }
    if (type === "sortie_lot" && !lotId) {
      setError("Choisissez le lot article pesé en sortie.");
      return;
    }
    startTransition(async () => {
      const res = await recordPesee(
        type,
        productionOrderId,
        Number(poidsKg),
        type === "sortie_lot" ? lotId : null,
        type !== "sortie_lot" ? articleRef || null : null
      );
      if ("error" in res) {
        setError(res.error);
        return;
      }
      toast.success(`Pesée enregistrée — ${PESEE_TYPE_LABELS[type].toLowerCase()}`);
      setPoidsKg("");
      setLotId("");
      setArticleRef("");
    });
  }

  return (
    <Card className="space-y-2 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Pesée</h3>
      {error && (
        <div className="flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2 py-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-foreground-muted">Type</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as typeof type);
              setLotId("");
            }}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          >
            {Object.entries(PESEE_TYPE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-foreground-muted">Ordre de fabrication</label>
          <select
            value={productionOrderId}
            onChange={(e) => {
              setProductionOrderId(e.target.value);
              setLotId("");
            }}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          >
            {productionOrderOptions.length === 0 && <option value="">Aucun ODF disponible</option>}
            {productionOrderOptions.map((po) => (
              <option key={po.id} value={po.id}>
                {po.reference}
                {po.companyName ? ` · ${po.companyName}` : ""}
              </option>
            ))}
          </select>
        </div>
        {type === "sortie_lot" && (
          <div>
            <label className="block text-[10px] text-foreground-muted">Lot article</label>
            <select
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">— choisir —</option>
              {availableLots.map((lot) => (
                <option key={lot.id} value={lot.id}>
                  {lot.code}
                </option>
              ))}
            </select>
          </div>
        )}
        {type !== "sortie_lot" && (
          <div>
            <label className="block text-[10px] text-foreground-muted">
              Article Sage <span className="normal-case text-foreground-muted">(optionnel)</span>
            </label>
            <select
              value={articleRef}
              onChange={(e) => setArticleRef(e.target.value)}
              className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">
                {stockItemOptions.length === 0 ? "Aucun article synchronisé" : "— non renseigné —"}
              </option>
              {stockItemOptions.map((item) => (
                <option key={item.sageReference} value={item.sageReference}>
                  {item.designation} ({item.sageReference})
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-[10px] text-foreground-muted">Poids (kg)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={poidsKg}
            onChange={(e) => setPoidsKg(e.target.value)}
            className="w-full rounded-md border border-border bg-surface p-1.5 text-xs outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>
      <Button size="sm" onClick={submit} loading={pending}>
        Enregistrer la pesée
      </Button>
    </Card>
  );
}
