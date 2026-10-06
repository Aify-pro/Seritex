"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

/**
 * Rouleaux de tissu (migration 0096) : réception, sortie vers un ODF, retour
 * pesé, rebut. Les droits sont vérifiés par la base (gestion de stock).
 */
const STOCK_ROLES = ["administrateur", "responsable_production", "gestionnaire_stock"] as const;
type Result = { error?: string; codes?: string[]; consomme?: number };

const rowSchema = z.object({
  sage_reference: z.string().trim().max(40).optional().default(""),
  bain: z.string().trim().max(40).optional().default(""),
  numero_fournisseur: z.string().trim().max(60).optional().default(""),
  laize_cm: z.union([z.number(), z.string()]).optional().default(""),
  poids_kg: z.union([z.number(), z.string()]),
  emplacement: z.string().trim().max(60).optional().default(""),
});

function done() {
  revalidatePath("/atelier/stock");
  revalidatePath("/articles", "layout");
  revalidatePath("/atelier/production", "layout");
}

export async function receiveRolls(textileId: string, rows: z.input<typeof rowSchema>[], source: "saisie" | "import"): Promise<Result> {
  await requireRole([...STOCK_ROLES]);
  const parsed = z.array(rowSchema).min(1, "Aucun rouleau").safeParse(rows);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const clean = parsed.data.map((r) => ({
    ...r,
    laize_cm: String(r.laize_cm).replace(",", ".").trim(),
    poids_kg: String(r.poids_kg).replace(",", ".").trim(),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_rolls", { p_textile_id: textileId, p_rows: clean, p_source: source });
  if (error) return { error: error.message };
  done();
  return { codes: ((data ?? []) as { code: string }[]).map((r) => r.code) };
}

export async function issueRoll(code: string, productionOrderId: string, motif: string): Promise<Result> {
  await requireRole([...STOCK_ROLES]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_roll_to_odf", { p_code: code, p_production_order_id: productionOrderId, p_motif: motif.trim() || null });
  if (error) return { error: error.message };
  done();
  return {};
}

export async function returnRoll(code: string, poidsRestant: number, motif: string): Promise<Result> {
  await requireRole([...STOCK_ROLES]);
  if (!Number.isFinite(poidsRestant) || poidsRestant < 0) return { error: "Poids restant invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("return_roll", { p_code: code, p_poids_restant: poidsRestant, p_motif: motif.trim() || null });
  if (error) return { error: error.message };
  done();
  return { consomme: Number(data) };
}

export async function scrapRoll(code: string, motif: string): Promise<Result> {
  await requireRole([...STOCK_ROLES]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("scrap_roll", { p_code: code, p_motif: motif });
  if (error) return { error: error.message };
  done();
  return {};
}
