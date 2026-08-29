"use server";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";
import type { WorkOrderStatus } from "@/lib/types/domain";
import { revalidatePath } from "next/cache";

export type TransitionResult = { error?: string };

/**
 * Point d'entrée unique pour changer le statut d'un ordre de travail.
 * N'effectue AUCUNE vérification de rôle ici — c'est la fonction Postgres
 * `transition_work_order` (SECURITY DEFINER) qui fait autorité et refuse
 * l'opération si l'utilisateur courant n'est ni responsable production /
 * administrateur, ni chef de la section exacte de cet OT. Ce doublon
 * volontaire (page filtrée par section + RPC qui revérifie) illustre le
 * principe de défense en profondeur demandé en section 9 du cahier des
 * charges : le contrôle réel est côté serveur/DB, jamais seulement dans
 * l'écran.
 */
export async function transitionWorkOrder(
  workOrderId: string,
  newStatus: WorkOrderStatus,
  options?: { quantity?: number; comment?: string }
): Promise<TransitionResult> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.rpc("transition_work_order", {
    p_work_order_id: workOrderId,
    p_new_status: newStatus,
    p_quantity: options?.quantity ?? null,
    p_comment: options?.comment ?? null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/atelier/section");
  revalidatePath("/atelier/production");
  revalidatePath("/atelier/transverse");
  revalidatePath("/dashboard");
  return {};
}
