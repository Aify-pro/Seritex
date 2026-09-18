"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AlertTriangle, Plus, Weight, Trash2 } from "lucide-react";
import { createWasteBag, recordBagWeighing, closeWasteBag, recordPesee } from "./actions";
import type { ArticleLotOption, ProductionOrderOption, StockItemOption, WasteBagRow } from "./types";

/* ============================================================
   Sacs de déchets — pesée incrémentale par différence (lot 7, section 17)

   Déplacé tel quel depuis `section-board.tsx` lors de la refonte du terminal
   de section : la mécanique est inchangée, mais le panneau sert désormais
   deux écrans — l'ancien plateau conservé pour le gestionnaire de stock, et
   la nouvelle file de travail.
============================================================ */

/**
 * Liste contrôlée : c'est l'écran appelant qui détient les sacs ouverts, parce
 * qu'il en affiche aussi le nombre dans sa barre d'actions — un compteur figé
 * pendant qu'on crée ou qu'on charge des sacs serait pire que pas de compteur.
 */
export function WasteBagsPanel({
  bags,
  setBags,
  productionOrderOptions,
}: {
  bags: WasteBagRow[];
  setBags: React.Dispatch<React.SetStateAction<WasteBagRow[]>>;
  productionOrderOptions: ProductionOrderOption[];
}) {
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
            inputMode="decimal"
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
   Pesée rapide — sortie_lot / retour_stock (lot 7, section 16)
============================================================ */

// Réception tissu retirée (migrations 0022/0023) : ce n'est plus le rôle de
// la section Coupe, mais celui du gestionnaire de stock, depuis la partie
// Stock de la fiche ODF (`/atelier/production/[id]`).
const PESEE_TYPE_LABELS = {
  sortie_lot: "Sortie lot article",
  retour_stock: "Retour stock",
} as const;

export function PeseeQuickForm({
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
  const [type, setType] = useState<keyof typeof PESEE_TYPE_LABELS>("sortie_lot");
  const [productionOrderId, setProductionOrderId] = useState(productionOrderOptions[0]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [poidsKg, setPoidsKg] = useState("");
  // Lot 10 : article Sage concerné (retour_stock uniquement) — optionnel,
  // alimente le mouvement de stock retour_mp sans bloquer la pesée si le
  // miroir Sage n'est pas encore synchronisé.
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
            inputMode="decimal"
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
