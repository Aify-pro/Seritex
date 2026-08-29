"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WORK_ORDER_STATUS_LABELS, type WorkOrderStatus } from "@/lib/types/domain";
import { transitionWorkOrder } from "./actions";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Pause, Play, RotateCcw, Package } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

export type WorkOrderRow = {
  id: string;
  reference: string;
  status: WorkOrderStatus;
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

const COLUMNS: { status: WorkOrderStatus; title: string }[] = [
  { status: "planifie", title: "À démarrer" },
  { status: "en_cours", title: "En cours" },
  { status: "bloque", title: "Bloqué" },
  { status: "termine", title: "Terminé" },
];

export function SectionBoard({
  sectionId,
  initialWorkOrders,
}: {
  sectionId: string;
  initialWorkOrders: WorkOrderRow[];
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
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sectionId]);

  const enAttente = orders.filter((o) => o.status === "en_attente");

  return (
    <div className="space-y-4">
      {enAttente.length > 0 && (
        <p className="text-xs text-foreground-muted">
          {enAttente.length} ordre(s) en attente de l&apos;étape précédente (non affichés ci-dessous).
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.status} className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                {col.title}
              </h3>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
                {orders.filter((o) => o.status === col.status).length}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {orders
                  .filter((o) => o.status === col.status)
                  .map((wo) => (
                    <WorkOrderCard key={wo.id} wo={wo} setOrders={setOrders} />
                  ))}
              </AnimatePresence>
              {orders.filter((o) => o.status === col.status).length === 0 && (
                <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-foreground-muted">
                  Aucun ordre
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkOrderCard({
  wo,
  setOrders,
}: {
  wo: WorkOrderRow;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
}) {
  const [pending, startTransition] = useTransition();
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState(wo.quantity_planned - wo.quantity_done);

  function applyOptimistic(status: WorkOrderStatus, patch: Partial<WorkOrderRow> = {}) {
    setOrders((prev) => prev.map((o) => (o.id === wo.id ? { ...o, status, ...patch } : o)));
  }

  function run(status: WorkOrderStatus, options?: { quantity?: number; comment?: string }) {
    const previous = wo.status;
    applyOptimistic(status, {
      blocking_reason: status === "bloque" ? options?.comment ?? null : null,
      quantity_done: options?.quantity !== undefined ? wo.quantity_done + options.quantity : wo.quantity_done,
    });
    startTransition(async () => {
      const res = await transitionWorkOrder(wo.id, status, options);
      if (res.error) {
        applyOptimistic(previous);
        toast.error("Action refusée", { description: res.error });
      } else {
        toast.success(`${wo.reference} → ${WORK_ORDER_STATUS_LABELS[status]}`);
      }
    });
    setShowBlockForm(false);
    setShowFinishForm(false);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={cn(
          "p-4",
          wo.status === "bloque" && "border-danger/40",
          wo.status === "en_cours" && "border-brand/40"
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground">{wo.reference}</p>
            <p className="text-xs text-foreground-muted">
              {wo.production_orders?.companies?.name ?? "—"} · {wo.production_orders?.reference}
            </p>
          </div>
          <Package className="h-4 w-4 shrink-0 text-foreground-muted" />
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-foreground-muted">
          <span>
            {wo.quantity_done}/{wo.quantity_planned} pièces
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${Math.min(100, (wo.quantity_done / wo.quantity_planned) * 100)}%` }}
          />
        </div>

        {wo.status === "bloque" && wo.blocking_reason && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {wo.blocking_reason}
          </p>
        )}

        {wo.actual_start && (
          <p className="mt-2 text-[11px] text-foreground-muted">Démarré le {formatDateTime(wo.actual_start)}</p>
        )}

        {!showBlockForm && !showFinishForm && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {wo.status === "planifie" && (
              <Button size="sm" onClick={() => run("en_cours")} loading={pending}>
                <Play className="h-3.5 w-3.5" /> Démarrer
              </Button>
            )}
            {wo.status === "en_cours" && (
              <>
                <Button size="sm" variant="secondary" onClick={() => run("pause")} loading={pending}>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </Button>
                <Button size="sm" variant="danger" onClick={() => setShowBlockForm(true)} disabled={pending}>
                  <AlertTriangle className="h-3.5 w-3.5" /> Bloquer
                </Button>
                <Button size="sm" variant="success" onClick={() => setShowFinishForm(true)} disabled={pending}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Terminer
                </Button>
              </>
            )}
            {wo.status === "pause" && (
              <Button size="sm" onClick={() => run("en_cours")} loading={pending}>
                <RotateCcw className="h-3.5 w-3.5" /> Reprendre
              </Button>
            )}
            {wo.status === "bloque" && (
              <Button size="sm" onClick={() => run("en_cours")} loading={pending}>
                <RotateCcw className="h-3.5 w-3.5" /> Débloquer
              </Button>
            )}
          </div>
        )}

        {showBlockForm && (
          <div className="mt-3 space-y-2">
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motif du blocage (matière manquante, défaut qualité, panne...)"
              className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
              rows={2}
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="danger" onClick={() => run("bloque", { comment: reason })} disabled={!reason}>
                Confirmer le blocage
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowBlockForm(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {showFinishForm && (
          <div className="mt-3 space-y-2">
            <label className="block text-[11px] text-foreground-muted">Quantité réalisée à ajouter</label>
            <input
              type="number"
              autoFocus
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex gap-1.5">
              <Button size="sm" variant="success" onClick={() => run("termine", { quantity: qty })}>
                Confirmer la fin
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowFinishForm(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
