"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Plus, Trash2, Send } from "lucide-react";
import { setProductionOrderSections, setProductionOrderSizes, submitProductionOrder } from "../actions";

/**
 * Édition d'un ODF en brouillon : sections retenues (remplace la gamme
 * opératoire figée par produit) et quantités par taille — nécessaires avant
 * soumission (submit_production_order() les exige, section 1 du cahier des
 * charges lot 1). Écriture directe sur production_order_sections/sizes,
 * autorisée par la RLS pour responsable_production/administrateur.
 */
export function SectionsSizesEditor({
  productionOrderId,
  allSections,
  initialSectionIds,
  initialSizes,
}: {
  productionOrderId: string;
  allSections: { id: string; name: string }[];
  initialSectionIds: string[];
  initialSizes: { taille: string; quantite_demandee: number }[];
}) {
  const [pending, startTransition] = useTransition();
  const [sectionIds, setSectionIds] = useState<string[]>(initialSectionIds);
  const [sizes, setSizes] = useState<{ taille: string; quantite_demandee: number }[]>(
    initialSizes.length > 0 ? initialSizes : [{ taille: "", quantite_demandee: 0 }]
  );

  function toggleSection(id: string) {
    setSectionIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function updateSize(i: number, patch: Partial<{ taille: string; quantite_demandee: number }>) {
    setSizes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function save(then?: () => void) {
    startTransition(async () => {
      const r1 = await setProductionOrderSections(productionOrderId, sectionIds);
      if (r1.error) {
        toast.error("Sections non enregistrées", { description: r1.error });
        return;
      }
      const r2 = await setProductionOrderSizes(productionOrderId, sizes);
      if (r2.error) {
        toast.error("Quantités par taille non enregistrées", { description: r2.error });
        return;
      }
      toast.success("Ordre de fabrication enregistré");
      then?.();
    });
  }

  function submit() {
    save(() => {
      startTransition(async () => {
        const res = await submitProductionOrder(productionOrderId);
        if (res.error) toast.error("Soumission refusée", { description: res.error });
        else toast.success("Ordre de fabrication soumis pour validation");
      });
    });
  }

  return (
    <Card>
      <CardHeader title="Composition de l'ODF" description="Sections retenues et quantités par taille." />
      <CardBody className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-medium text-foreground-muted">Sections</p>
          <div className="flex flex-wrap gap-2">
            {allSections.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs has-[:checked]:border-brand has-[:checked]:bg-brand-soft/40"
              >
                <input
                  type="checkbox"
                  checked={sectionIds.includes(s.id)}
                  onChange={() => toggleSection(s.id)}
                  className="accent-brand"
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-foreground-muted">Quantités par taille</p>
          <div className="space-y-2">
            {sizes.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  placeholder="Taille (ex. M)"
                  value={s.taille}
                  onChange={(e) => updateSize(i, { taille: e.target.value })}
                  className="w-28 rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
                />
                <input
                  type="number"
                  placeholder="Quantité"
                  value={s.quantite_demandee || ""}
                  onChange={(e) => updateSize(i, { quantite_demandee: Number(e.target.value) })}
                  className="w-32 rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSizes((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={sizes.length === 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSizes((prev) => [...prev, { taille: "", quantite_demandee: 0 }])}
            >
              <Plus className="h-3.5 w-3.5" /> Ajouter une taille
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => save()} loading={pending}>
            Enregistrer le brouillon
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={sectionIds.length === 0 || sizes.every((s) => !s.taille || !s.quantite_demandee)}
          >
            <Send className="h-3.5 w-3.5" /> Soumettre pour validation
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
