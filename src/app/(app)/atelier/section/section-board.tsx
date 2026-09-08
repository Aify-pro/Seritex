"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { recordWorkOrderQuantity, closeMatelas } from "./actions";
import { toast } from "sonner";
import { CheckCircle2, Package, Plus, Scissors, AlertTriangle } from "lucide-react";
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

export function SectionBoard({
  sectionId,
  initialWorkOrders,
  matelasByWorkOrderId = {},
}: {
  sectionId: string;
  initialWorkOrders: WorkOrderRow[];
  matelasByWorkOrderId?: Record<string, MatelasRow[]>;
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
              <WorkOrderCard key={wo.id} wo={wo} setOrders={setOrders} matelas={matelasByWorkOrderId[wo.id]} />
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
              <WorkOrderCard key={wo.id} wo={wo} setOrders={setOrders} matelas={matelasByWorkOrderId[wo.id]} />
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
}: {
  wo: WorkOrderRow;
  setOrders: React.Dispatch<React.SetStateAction<WorkOrderRow[]>>;
  /** Présent (même vide) uniquement pour un sous-ODF de la section Coupe (lot 4). */
  matelas?: MatelasRow[];
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

        {matelas !== undefined ? (
          <MatelasList workOrderId={wo.id} matelas={matelas} />
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
