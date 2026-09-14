"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Trash2, Send, ChevronUp, ChevronDown } from "lucide-react";
import { setProductionOrderSections, setProductionOrderSizes, submitProductionOrder } from "../actions";
import type { Size } from "@/lib/sizes";

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
 * Les tailles viennent du référentiel (Paramètres > Couleurs et tailles),
 * restreint à celles dans lesquelles le modèle existe. Elles ne sont jamais
 * tapées en texte libre : le contrôle de quantité tracée vs demandée
 * (validate_production_order(), lot 2) compare ces valeurs telles quelles, et
 * un texte libre les rendrait fragiles — « Large » ne vaudrait jamais « L ».
 *
 * La grille est affichée en entier plutôt que ligne à ligne : on saisit une
 * quantité en face d'une taille, sans avoir à l'ajouter d'abord. Le total
 * réparti est confronté en permanence à la quantité commandée, parce que
 * submit_production_order() refuse tout écart — autant le voir en saisissant
 * plutôt qu'au moment de soumettre.
 */
export function SectionsSizesEditor({
  productionOrderId,
  allSections,
  initialSectionIds,
  initialSizes,
  referentielTailles,
  totalQuantity,
  productConfigured,
}: {
  productionOrderId: string;
  allSections: { id: string; name: string }[];
  initialSectionIds: string[];
  initialSizes: { taille: string; quantite_demandee: number }[];
  /** Tailles proposables : le référentiel, restreint à la disponibilité du modèle. */
  referentielTailles: Size[];
  /** Quantité commandée, reprise du devis — la répartition doit la totaliser exactement. */
  totalQuantity: number;
  /**
   * Modèle de produit + couleur(s) déjà configurés — reflet côté client du
   * garde-fou serveur posé dans submit_production_order() (migration 0034).
   * Sert uniquement à désactiver le bouton avec un message clair avant
   * d'envoyer la requête ; le contrôle qui fait autorité reste le RPC.
   */
  productConfigured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [sectionIds, setSectionIds] = useState<string[]>(initialSectionIds);
  const [quantites, setQuantites] = useState<Record<string, number>>(
    Object.fromEntries(initialSizes.map((s) => [s.taille, s.quantite_demandee]))
  );

  const sizes = referentielTailles
    .filter((t) => (quantites[t.cle] ?? 0) > 0)
    .map((t) => ({ taille: t.cle, quantite_demandee: quantites[t.cle] }));

  const reparti = Object.values(quantites).reduce((somme, n) => somme + (n || 0), 0);
  const ecart = reparti - totalQuantity;

  const groupes = [...new Set(referentielTailles.map((t) => t.groupe))];

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

  function setQuantite(cle: string, valeur: number) {
    setQuantites((prev) => ({ ...prev, [cle]: Number.isFinite(valeur) && valeur > 0 ? valeur : 0 }));
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
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-foreground-muted">Quantités par taille</p>
            <p className="text-xs">
              <span className="text-foreground-muted">Réparti </span>
              <span className={ecart === 0 ? "font-semibold text-success" : "font-semibold text-warning"}>
                {reparti}
              </span>
              <span className="text-foreground-muted"> / {totalQuantity} commandées</span>
              {ecart !== 0 && (
                <span className="text-warning">
                  {" "}
                  — {ecart > 0 ? `${ecart} en trop` : `il manque ${-ecart}`}
                </span>
              )}
            </p>
          </div>

          {referentielTailles.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-muted">
              Aucune taille proposable : le référentiel est vide, ou ce modèle n&apos;a aucune taille déclarée
              disponible. Cela se règle dans Paramètres &gt; Couleurs et tailles, puis sur la carte du modèle.
            </p>
          ) : (
            <div className="space-y-3">
              {groupes.map((groupe) => (
                <div key={groupe}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                    {groupe}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {referentielTailles
                      .filter((t) => t.groupe === groupe)
                      .map((t) => {
                        const valeur = quantites[t.cle] ?? 0;
                        return (
                          <label
                            key={t.cle}
                            className={`flex w-20 flex-col gap-1 rounded-md border p-1.5 ${
                              valeur > 0 ? "border-brand bg-brand-soft/40" : "border-border"
                            }`}
                          >
                            <span className="text-center text-[11px] font-medium text-foreground">{t.libelle}</span>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              value={valeur || ""}
                              placeholder="0"
                              onChange={(e) => setQuantite(t.cle, Number(e.target.value))}
                              className="w-full rounded border border-border bg-surface p-1 text-center text-xs outline-none focus:ring-2 focus:ring-brand/30"
                            />
                          </label>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={() => save()} loading={pending}>
            Enregistrer le brouillon
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={sectionIds.length === 0 || reparti === 0 || ecart !== 0 || !productConfigured}
            title={
              !productConfigured
                ? "Renseignez d'abord la configuration produit (modèle + couleur) ci-dessus."
                : ecart !== 0
                  ? `La répartition doit totaliser exactement ${totalQuantity} pièces.`
                  : undefined
            }
          >
            <Send className="h-3.5 w-3.5" /> Soumettre pour validation
          </Button>
          {ecart !== 0 && reparti > 0 && (
            <p className="w-full text-xs text-warning">
              La soumission attend une répartition égale à la quantité commandée : {reparti} réparties contre{" "}
              {totalQuantity} demandées.
            </p>
          )}
          {ecart === 0 && reparti > 0 && !productConfigured && (
            <p className="w-full text-xs text-warning">
              La soumission attend un modèle de produit et sa couleur (par zone, ou « modèle uni ») — voir la carte
              « Configuration produit » ci-dessus.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
