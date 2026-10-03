"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";

/**
 * Demandes pour le stock (SF-3, D4, D11) : créées par les commerciaux, la
 * production ou la Direction ; l'ODF de stock en est tiré en brouillon. Les
 * contrôles (rôle, quantités, tailles) sont faits par la base.
 */
export type StockLine = { product_model_id: string; description: string; couleur_unique_id: string | null; tailles: Record<string, number> };

export async function createStockRequest(description: string, lignes: StockLine[]) {
  await requireRole(["administrateur", "commercial", "responsable_production"]);
  const clean = lignes
    .map((l) => ({ ...l, tailles: Object.fromEntries(Object.entries(l.tailles).filter(([, q]) => Number.isInteger(q) && q > 0)) }))
    .filter((l) => l.product_model_id && Object.keys(l.tailles).length > 0);
  if (clean.length === 0) return { error: "Ajoutez au moins un article avec des quantités." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_request", { p_description: description, p_lignes: clean });
  if (error) return { error: error.message };
  revalidatePath("/demandes-stock");
  return { id: data as string };
}

export async function createStockProductionOrder(requestId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_stock_production_order", { p_request_id: requestId });
  if (error) return { error: error.message };
  revalidatePath("/demandes-stock");
  revalidatePath("/atelier/production");
  return { id: data as string };
}
