"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";

export async function launchProductionOrder(productionOrderId: string) {
  await requireRole(["responsable_production", "administrateur"]);
  const supabase = await createClient();

  const { error } = await supabase.rpc("generate_work_orders", {
    p_production_order_id: productionOrderId,
  });

  if (error) return { error: error.message };

  revalidatePath(`/atelier/production/${productionOrderId}`);
  revalidatePath("/atelier/production");
  revalidatePath("/atelier/transverse");
  return {};
}

/**
 * Archive/désarchive un ordre de fabrication (ODF) — distinct du statut
 * d'avancement, retire l'ODF des vues actives sans toucher à ses données.
 * L'autorisation vient de `archive_production_order()`/`unarchive_...()`
 * côté Postgres (module `ordres_fabrication`, action `archive`), pas d'un
 * rôle codé en dur ici — réglable depuis Paramètres > Rôles & permissions.
 */
export async function archiveProductionOrder(productionOrderId: string, reason?: string) {
  await requireRole(["administrateur", "responsable_production", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_production_order", {
    p_production_order_id: productionOrderId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/atelier/production/${productionOrderId}`);
  revalidatePath("/atelier/production");
  return {};
}

export async function unarchiveProductionOrder(productionOrderId: string) {
  await requireRole(["administrateur", "responsable_production", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("unarchive_production_order", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/atelier/production/${productionOrderId}`);
  revalidatePath("/atelier/production");
  return {};
}

export async function reassignSectionChief(workOrderId: string, userId: string | null) {
  await requireRole(["responsable_production", "administrateur"]);
  const supabase = await createClient();

  // Écriture directe autorisée par la RLS pour ce rôle (voir
  // work_orders_update dans 0002_rls.sql) — action de gestion, distincte des
  // transitions de statut quotidiennes qui passent par transition_work_order().
  const { error } = await supabase
    .from("work_orders")
    .update({ assigned_section_chief_id: userId })
    .eq("id", workOrderId);

  if (error) return { error: error.message };
  revalidatePath("/atelier/production");
  return {};
}
