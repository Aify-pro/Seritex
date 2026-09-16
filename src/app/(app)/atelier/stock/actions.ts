"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";

export type GenerateStockExportFicheResult = { error: string } | { id: string; numero: string };

/**
 * Même RPC que generateStockExportFiche (atelier/production/actions.ts),
 * appelée sans ODF (p_production_order_id null côté Postgres) : regroupe
 * dans une fiche numérotée TOUS les mouvements de stock pas encore
 * exportés, toutes ODF confondues (migration 0038). Séparée de l'action
 * ODF plutôt que de lui ajouter un paramètre optionnel : les deux écrans
 * appelants (ODF, gestion de stock globale) n'ont pas le même chemin à
 * revalider.
 */
export async function generateGlobalStockExportFiche(): Promise<GenerateStockExportFicheResult> {
  await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_stock_export_fiche", {
    p_production_order_id: null,
  }).single();

  if (error) return { error: error.message };
  revalidatePath("/atelier/stock");
  const fiche = data as { id: string; numero: string };
  return { id: fiche.id, numero: fiche.numero };
}

export type RecordSageReconciliationResult = { error: string } | { ok: true };

/**
 * Rapprochement Sage (migration 0038) : le gestionnaire de stock reporte le
 * numéro de fiche de mouvement que Sage lui a renvoyé après import du CSV.
 * Aucune connexion Sage réelle aujourd'hui — saisie manuelle, remplacée par
 * un rapprochement automatique le jour où la connexion SQL existera, sans
 * changement de ce contrat (même RPC, même colonnes).
 */
export async function recordSageReconciliation(ficheId: string, sageNumero: string): Promise<RecordSageReconciliationResult> {
  await requireRole(["administrateur", "responsable_production", "gestionnaire_stock"]);
  const supabase = await createClient();

  const { error } = await supabase.rpc("record_sage_reconciliation", {
    p_fiche_id: ficheId,
    p_sage_numero: sageNumero,
  });

  if (error) return { error: error.message };
  revalidatePath("/atelier/stock");
  return { ok: true };
}
