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
