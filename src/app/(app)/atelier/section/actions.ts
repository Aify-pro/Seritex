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
  revalidatePath("/atelier/transverse");
  revalidatePath("/dashboard");
  return {};
}
