"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { setProductionOrderLineSections } from "../actions";

/**
 * Sections retenues pour UN article de l'ODF, dans l'ordre où le travail
 * doit passer (migration 0037 : par article, plus par ODF entier — une
 * commande peut mêler un article à imprimer et un autre non). Écriture
 * directe sur production_order_line_sections, autorisée par la RLS pour
 * responsable_production/administrateur.
 *
 * Auto-enregistré à chaque changement (ajout/retrait/réordonnancement), pas
 * de bouton "brouillon" séparé — `router.refresh()` ensuite pour que la
 * fiche Patronnage / le visuel apparaissent immédiatement si une section
 * Coupe/Impression vient d'être ajoutée, sans naviguer.
 */
export function LineSectionsPicker({
  lineId,
  productionOrderId,
  lineLabel,
  allSections,
  initialSectionIds,
}: {
  lineId: string;
  productionOrderId: string;
  lineLabel: string;
  allSections: { id: string; name: string }[];
  initialSectionIds: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sectionIds, setSectionIds] = useState<string[]>(initialSectionIds);

  const availableSections = allSections.filter((s) => !sectionIds.includes(s.id));

  function persist(next: string[]) {
    setSectionIds(next);
    startTransition(async () => {
      const res = await setProductionOrderLineSections(lineId, productionOrderId, next);
      if (res.error) {
        toast.error("Sections non enregistrées", { description: res.error });
        return;
      }
      router.refresh();
    });
  }

  function addSection(id: string) {
    persist([...sectionIds, id]);
  }

  function removeSection(id: string) {
    persist(sectionIds.filter((s) => s !== id));
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sectionIds.length) return;
    const next = [...sectionIds];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  }

  return (
    <Card>
      <CardHeader title={`Sections retenues — ${lineLabel}`} description="Dans l'ordre de passage de cet article." />
      <CardBody className="space-y-2">
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
                    disabled={pending || i === 0}
                    title="Monter"
                    className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(i, 1)}
                    disabled={pending || i === sectionIds.length - 1}
                    title="Descendre"
                    className="text-foreground-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(id)}
                    disabled={pending}
                    title="Retirer"
                    className="text-foreground-muted hover:text-danger disabled:opacity-30"
                  >
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
            disabled={pending}
            onChange={(e) => {
              if (e.target.value) addSection(e.target.value);
            }}
            className="mt-2 w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          >
            <option value="">+ Ajouter une section…</option>
            {availableSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </CardBody>
    </Card>
  );
}
