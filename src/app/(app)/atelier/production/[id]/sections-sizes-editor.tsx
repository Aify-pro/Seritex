"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Trash2, Send, ChevronUp, ChevronDown } from "lucide-react";
import { setProductionOrderSections, submitProductionOrder } from "../actions";

/**
 * Édition des sections d'un ODF en brouillon, DANS L'ORDRE où le travail
 * doit passer — nécessaire avant soumission (submit_production_order() les
 * exige, section 1 du cahier des charges lot 1). Écriture directe sur
 * production_order_sections, autorisée par la RLS pour
 * responsable_production/administrateur.
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
 * Le dispatching des tailles (un par article) vit désormais dans
 * ProductionOrderLines, pas ici (chantier ODF multi-lignes) — cet écran ne
 * porte plus que les sections, et le bouton de soumission final.
 */
export function SectionsSizesEditor({
  productionOrderId,
  allSections,
  initialSectionIds,
  linesConfigured,
}: {
  productionOrderId: string;
  allSections: { id: string; name: string }[];
  initialSectionIds: string[];
  /**
   * Chaque article a son modèle, sa couleur et son dispatching des tailles
   * au complet — reflet côté client du garde-fou serveur posé dans
   * submit_production_order() (migration 0035). Sert uniquement à
   * désactiver le bouton avec un message clair avant d'envoyer la requête ;
   * le contrôle qui fait autorité reste le RPC.
   */
  linesConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [sectionIds, setSectionIds] = useState<string[]>(initialSectionIds);

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

  function save(then?: () => void) {
    startTransition(async () => {
      const res = await setProductionOrderSections(productionOrderId, sectionIds);
      if (res.error) {
        toast.error("Sections non enregistrées", { description: res.error });
        return;
      }
      toast.success("Sections enregistrées");
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
      <CardHeader title="Sections retenues" description="Sections de l'ODF, dans l'ordre de passage." />
      <CardBody className="space-y-5">
        <div>
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

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => save()} loading={pending}>
            Enregistrer le brouillon
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={sectionIds.length === 0 || !linesConfigured}
            title={
              !linesConfigured
                ? "Chaque article doit avoir son modèle, sa couleur et son dispatching des tailles au complet (voir Configuration produit ci-dessus)."
                : undefined
            }
          >
            <Send className="h-3.5 w-3.5" /> Soumettre pour validation
          </Button>
          {sectionIds.length > 0 && !linesConfigured && (
            <p className="w-full text-xs text-warning">
              La soumission attend, pour chaque article : un modèle, une couleur (par zone, ou « modèle uni ») et un
              dispatching des tailles totalisant exactement sa quantité — voir « Configuration produit » ci-dessus.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
