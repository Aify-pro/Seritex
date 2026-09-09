"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";

export type RecordQuantityResult = { error?: string };

/**
 * Point d'entrée unique pour saisir une quantité produite sur un sous-ODF.
 * N'effectue AUCUNE vérification de rôle ici — c'est la fonction Postgres
 * `record_work_order_quantity` (SECURITY DEFINER) qui fait autorité et
 * refuse l'opération si l'utilisateur courant n'est ni responsable
 * production / administrateur, ni chef de la section exacte de cet OT (même
 * principe de défense en profondeur que l'ancien `transitionWorkOrder`,
 * section 9 du cahier des charges).
 *
 * Un sous-ODF ne porte plus de statut (section 5 du document de logique
 * consolidé) : la quantité se cumule librement, y compris au-delà de la
 * quantité demandée, tant que l'ODF n'est pas clôturé.
 */
export async function recordWorkOrderQuantity(
  workOrderId: string,
  quantity: number,
  comment?: string
): Promise<RecordQuantityResult> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.rpc("record_work_order_quantity", {
    p_work_order_id: workOrderId,
    p_quantity: quantity,
    p_comment: comment || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  revalidatePath("/dashboard");
  return {};
}

/**
 * Clôture d'un matelas (lot 4, section Coupe uniquement) — quantités
 * pré-remplies depuis le tracé Patronnage, jamais ressaisies. Comme pour
 * recordWorkOrderQuantity, aucune vérification de rôle ici : c'est
 * `close_matelas` (SECURITY DEFINER) qui fait autorité (chef de la section
 * Coupe exacte, ou responsable_production/administrateur) et qui refuse
 * toute quantité à la hausse ou tout manquant sans justification.
 */
export async function closeMatelas(
  workOrderId: string,
  traceId: string,
  quantitesObtenues: Record<string, number>,
  poidsDechetKg: number,
  justification?: string
): Promise<RecordQuantityResult> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_matelas", {
    p_work_order_id: workOrderId,
    p_trace_id: traceId,
    p_quantites_obtenues: quantitesObtenues,
    p_poids_dechet_kg: poidsDechetKg,
    p_justification: justification?.trim() || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  revalidatePath("/atelier/patronnage");
  revalidatePath("/dashboard");
  return {};
}

export type CreateLotResult = { error: string } | { code: string };

/**
 * Génération d'un lot article (QR + numéro de série, lot 6, section 15 du
 * document de logique) — granularité par lot, pas par pièce. Aucune
 * vérification de rôle ici : `create_article_lot` (SECURITY DEFINER) fait
 * autorité (chef de la section Coupe, ou responsable_production/
 * administrateur). Composition par taille en saisie libre, sans validation
 * contre les quantités du tracé — pas structurant (section 15).
 */
export async function createArticleLot(
  productionOrderId: string,
  categorie: "semi_fini" | "fini" | "dechet",
  compositionTaille: Record<string, number>,
  traceId?: string | null
): Promise<CreateLotResult> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("create_article_lot", {
      p_production_order_id: productionOrderId,
      p_trace_id: traceId || null,
      p_categorie: categorie,
      p_composition_taille: compositionTaille,
    })
    .single();

  if (error) return { error: error.message };

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  return { code: (data as { code: string }).code };
}

/* ============================================================
   Pesées & sacs de déchets (lot 7, sections 16/17 du document de logique)
============================================================ */

export type RecordPeseeResult = { error: string } | { id: string };

/**
 * Pesée générique — reception_tissu / sortie_lot / retour_stock. Aucune
 * vérification de rôle ici : `record_pesee` (SECURITY DEFINER) fait autorité
 * (chef de la section Coupe, ou responsable_production/administrateur), même
 * périmètre que create_article_lot/close_matelas. `sac_dechet` est exclu ici
 * volontairement — il passe par recordBagWeighing (mécanique par différence,
 * section 17).
 */
export async function recordPesee(
  type: "reception_tissu" | "sortie_lot" | "retour_stock",
  productionOrderId: string,
  poidsKg: number,
  referenceId?: string | null
): Promise<RecordPeseeResult> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_pesee", {
    p_type: type,
    p_production_order_id: productionOrderId,
    p_poids_kg: poidsKg,
    p_reference_id: referenceId || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  return { id: data as string };
}

export type CreateWasteBagResult = { error: string } | { id: string; code: string };

export async function createWasteBag(): Promise<CreateWasteBagResult> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_waste_bag").single();
  if (error) return { error: error.message };

  revalidatePath("/atelier/section");
  const bag = data as { id: string; code: string };
  return { id: bag.id, code: bag.code };
}

export type RecordBagWeighingResult = { error: string } | { deltaKg: number };

/**
 * Pesée incrémentale d'un sac de déchets — le delta (poids relevé − dernier
 * relevé) est calculé côté Postgres, jamais côté client (section 17 : "aucun
 * calcul mental requis côté atelier").
 */
export async function recordBagWeighing(
  sacId: string,
  poidsReleveKg: number,
  productionOrderId: string,
  traceId?: string | null
): Promise<RecordBagWeighingResult> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("record_bag_weighing", {
      p_sac_id: sacId,
      p_poids_releve_kg: poidsReleveKg,
      p_production_order_id: productionOrderId,
      p_trace_id: traceId || null,
    })
    .single();

  if (error) return { error: error.message };

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  return { deltaKg: (data as { delta_kg: number }).delta_kg };
}

/** Marque un sac "chargé" — poids_total_kg figé sur le dernier relevé. */
export async function closeWasteBag(sacId: string): Promise<RecordQuantityResult> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_waste_bag", { p_sac_id: sacId });
  if (error) return { error: error.message };

  revalidatePath("/atelier/section");
  revalidatePath("/dechets");
  return {};
}
