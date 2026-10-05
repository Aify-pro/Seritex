"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";

/**
 * Demande pour le stock (SF-3, D4, D11) : l'ODF de stock en est tiré en
 * brouillon, par la production ou la Direction. La demande elle-même se crée
 * depuis « Nouvelle demande », case « Pour le stock » (createRequest).
 */
export async function createStockProductionOrder(requestId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_production_order", { p_request_id: requestId });
  if (error) return { error: error.message };
  revalidatePath("/commercial/demandes", "layout");
  revalidatePath("/atelier/production");
  return { id: data as string };
}
