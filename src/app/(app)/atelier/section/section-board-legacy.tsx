"use client";

import { useState } from "react";
import { WasteBagsPanel, PeseeQuickForm } from "./coupe-tools";
import type {
  ArticleLotOption,
  ProductionOrderOption,
  StockItemOption,
  WasteBagRow,
} from "./types";

/**
 * Écran du gestionnaire de stock — volontairement laissé à l'identique.
 *
 * La refonte du terminal de section (file de travail en accordéon, recherche,
 * scan, modales plein écran) ne concerne que `chef_section`,
 * `responsable_production` et `administrateur` : décision d'Ayman, le
 * gestionnaire de stock retrouve exactement l'outil qu'il connaît. Plutôt que
 * de faire cohabiter deux ergonomies dans un même composant — et de risquer
 * qu'une correction de la nouvelle file casse son quotidien — son chemin vit
 * dans ce fichier séparé, qui n'a aucune raison d'évoluer avec les lots
 * suivants.
 *
 * Il ne voit jamais la file de travail : clôturer un matelas ou générer un lot
 * reste le travail du chef de section (`stockManagerOnly` dans l'ancien
 * plateau).
 */
export function SectionBoardLegacy({
  isCoupe,
  lotsByProductionOrderId,
  productionOrderOptions,
  initialOpenWasteBags,
  stockItemOptions,
}: {
  /** Les pesées et les sacs n'existent qu'en catégorie Coupe (sections 16/17). */
  isCoupe: boolean;
  lotsByProductionOrderId: Record<string, ArticleLotOption[]>;
  productionOrderOptions: ProductionOrderOption[];
  initialOpenWasteBags: WasteBagRow[];
  stockItemOptions: StockItemOption[];
}) {
  const [bags, setBags] = useState(initialOpenWasteBags);

  if (!isCoupe) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-foreground-muted">
        Les pesées (sortie lot, retour stock) se saisissent depuis la section Coupe — changez de section ci-dessus.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <WasteBagsPanel bags={bags} setBags={setBags} productionOrderOptions={productionOrderOptions} />
      <PeseeQuickForm
        productionOrderOptions={productionOrderOptions}
        lotsByProductionOrderId={lotsByProductionOrderId}
        stockItemOptions={stockItemOptions}
      />
    </div>
  );
}
