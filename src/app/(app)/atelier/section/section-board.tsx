"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { recordWorkOrderQuantity } from "./actions";
import { toast } from "sonner";
import { CheckCircle2, Package, Plus } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";

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
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          À produire ({enCours.length})
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence initial={false}>
            {enCours.map((wo) => (
              <WorkOrderCard key={wo.id} wo={wo} setOrders={setOrders} />
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
              <WorkOrderCard key={wo.id} wo={wo} setOrders={setOrders} />
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
}: {
  wo: WorkOrderRow;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
}) {
  const [pending, startTransition] = useTransition();
  const [showAddForm, setShowAddForm] = useState(false);
  const [qty, setQty] = useState(Math.max(wo.quantity_planned - wo.quantity_done, 0));
  const atteinte = wo.quantity_done >= wo.quantity_planned;

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

        {wo.actual_start && (
          <p className="mt-2 text-[11px] text-foreground-muted">Démarré le {formatDateTime(wo.actual_start)}</p>
        )}

        {!showAddForm ? (
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
