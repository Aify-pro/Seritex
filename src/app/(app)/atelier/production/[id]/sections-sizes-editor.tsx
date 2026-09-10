"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Plus, Trash2, Send, ChevronUp, ChevronDown } from "lucide-react";
import { setProductionOrderSections, setProductionOrderSizes, submitProductionOrder } from "../actions";
import { REPARTITION_TAILLES_KEYS } from "@/lib/patronnage/types";

/**
 * Édition d'un ODF en brouillon : sections retenues, DANS L'ORDRE où le
 * travail doit passer, et quantités par taille — nécessaires avant
 * soumission (submit_production_order() les exige, section 1 du cahier des
 * charges lot 1). Écriture directe sur production_order_sections/sizes,
 * autorisée par la RLS pour responsable_production/administrateur.
 *
 * Chaque ODF est unique (une commande peut suivre Coupe > Impression >
 * Montage, une autre n'a besoin que d'Impression si le support est déjà
 * acheté) : il n'y a plus de gamme opératoire figée par modèle de produit
 * (ancien module Paramètres > Gammes opératoires, retiré — routing_templates/
 * routing_steps ne pilotaient plus rien depuis le lot 1). L'ordre vient
 * uniquement de la position dans `sectionIds` ci-dessous, matérialisée par
 * une vraie liste réordonnable (flèches) plutôt que par l'ordre de clic sur
 * des cases à cocher — setProductionOrderSections() écrit `ordre = index+1`
 * exactement dans cet ordre.
 *
 * Lot 2 : la taille est choisie dans le même ensemble fixe que le Patronnage
 * (XS/S/M/L/XL/XXL/XXXL/Autre) plutôt que tapée en texte libre — le contrôle
 * de quantité tracée vs demandée (validate_production_order()) compare les
 * deux valeurs telles quelles, un texte libre les aurait rendues fragiles.
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

  const availableSections = allSections.filter((s) => !sectionIds.includes(s.id));

  function addSection(id: string) {
    setSectionIds((prev) => [...prev, id]);
  }

  function removeSection(id: string) {
    setSectionIds((prev) => prev.filter((s) => s !== id));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setSectionIds((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
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
          <p className="mb-1 text-xs font-medium text-foreground-muted">Sections concernées, dans l&apos;ordre de passage</p>
          <p className="mb-2 text-xs text-foreground-muted">
            Chaque commande est unique : ajoutez uniquement les sections nécessaires (ex. Coupe puis Impression puis
            Montage, ou Impression seule si le support est déjà acheté) et ordonnez-les avec les flèches.
          </p>

          {sectionIds.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
              Aucune section retenue pour l&apos;instant.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {sectionIds.map((id, i) => {
                const section = allSections.find((s) => s.id === id);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-foreground">{section?.name ?? "Section inconnue"}</span>
                    <button
                      type="button"
                      onClick={() => moveSection(i, -1)}
                      disabled={i === 0}
                      title="Monter"
                      className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(i, 1)}
                      disabled={i === sectionIds.length - 1}
                      title="Descendre"
                      className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => removeSection(id)} title="Retirer" className="text-foreground-muted hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {availableSections.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addSection(e.target.value);
              }}
              className="mt-2 w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
            >
              <option value="">+ Ajouter une section…</option>
              {availableSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-foreground-muted">Quantités par taille</p>
          <div className="space-y-2">
            {sizes.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={s.taille}
                  onChange={(e) => updateSize(i, { taille: e.target.value })}
                  className="w-28 rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
                >
                  <option value="">Taille…</option>
                  {REPARTITION_TAILLES_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
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
