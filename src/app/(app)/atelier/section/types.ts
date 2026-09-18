"use client";

import { createContext, useContext } from "react";
import type { Size } from "@/lib/sizes";
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
  production_order_line_id: string | null;
  production_orders: {
    id: string;
    reference: string;
    company_id: string;
    companies?: { name: string } | null;
  } | null;
};

/** Pesée de sac déjà rattachée à un matelas — ses déchets, delta calculé par la base. */
export type MatelasDechetRow = { id: string; bagCode: string; deltaKg: number; occurredAt: string };

/**
 * Lot 4 : un matelas = un tracé Patronnage d'une fiche "Bon pour coupe", pas
 * encore clôturé. Porte le théorique du tracé (dimensions, plis) et de sa
 * fiche (tissu, couleur) : c'est la référence en regard de laquelle le chef
 * de section saisit le réel à la clôture (migration 0053).
 */
export type MatelasRow = {
  id: string;
  reference: string;
  referencePatron: string | null;
  repartitionParCouche: RepartitionTailles;
  nbPlis: number | null;
  longueurM: number | null;
  laizeCm: number | null;
  tissu: string | null;
  couleur: string | null;
  grammage: number | null;
  estCorrectif: boolean;
  justification: string | null;
  /** Pesées de sac déjà faites pour ce matelas, de la plus ancienne à la plus récente. */
  dechets: MatelasDechetRow[];
};

/** Lot 6 : tracé d'origine optionnel d'un lot article — clôturé ou non. */
export type TraceOption = { id: string; reference: string };

/** Lot 7 : ODF visible dans la file Coupe, pour rattacher une pesée. */
export type ProductionOrderOption = { id: string; reference: string; companyName: string | null };

/** Lot 7 : lot article disponible pour une pesée de sortie (type sortie_lot). */
export type ArticleLotOption = { id: string; code: string; categorie: string };

/** Lot 7 : sac de déchets ouvert (statut en_cours), avec son dernier relevé connu. */
export type WasteBagRow = { id: string; code: string; currentWeightKg: number; createdAt: string };

/** Lot 10 : article du miroir Sage (stock_item_view), pour rattacher une pesée. */
export type StockItemOption = { sageReference: string; designation: string };

/**
 * Ce que la file de travail sait d'un sous-ODF au-delà de sa propre ligne :
 * le numéro d'OT et la description de l'article (recherche et en-tête
 * déplié). `articleDescription` peut être null pour un chef de section tant
 * que la policy de lecture de `production_order_lines` ne lui est pas
 * ouverte (lot B) — l'écran fonctionne sans, la recherche est simplement
 * moins riche pour lui.
 */
export type WorkOrderContext = {
  numeroOt: string | null;
  articleDescription: string | null;
};

/**
 * Historique des saisies de quantité d'un sous-ODF (sections hors Coupe).
 * `authorName` vient de `app_users`, lisible par tout le personnel.
 */
export type QuantityEventRow = {
  id: string;
  occurredAt: string;
  quantity: number | null;
  comment: string | null;
  authorName: string | null;
};

/**
 * Grille de tailles du référentiel, partagée par tout l'écran. Passée par
 * contexte et non de proche en proche : plusieurs niveaux de composants
 * séparent la file du formulaire de clôture d'un matelas, et l'enfilade de
 * props n'aurait rien appris à personne en chemin.
 */
export const SizesContext = createContext<Size[]>([]);
export const useSizes = () => useContext(SizesContext);
