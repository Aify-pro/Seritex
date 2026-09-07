"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";

function revalidateOdf(productionOrderId: string) {
  revalidatePath(`/atelier/production/${productionOrderId}`);
  revalidatePath("/atelier/production");
  revalidatePath("/dashboard");
}

/**
 * Sections retenues pour un ODF en brouillon — remplace la dépendance à une
 * gamme opératoire figée par produit (routing_templates/routing_steps) :
 * les sections sont choisies à la saisie, pas figées à l'avance. Écriture
 * directe autorisée par la RLS (is_production_manager()), même pattern que
 * `reassignSectionChief` ci-dessous.
 */
export async function setProductionOrderSections(productionOrderId: string, sectionIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("production_order_sections")
    .delete()
    .eq("production_order_id", productionOrderId);
  if (delError) return { error: delError.message };

  if (sectionIds.length > 0) {
    const { error: insError } = await supabase.from("production_order_sections").insert(
      sectionIds.map((sectionId, i) => ({
        production_order_id: productionOrderId,
        section_id: sectionId,
        ordre: i + 1,
      }))
    );
    if (insError) return { error: insError.message };
  }

  revalidateOdf(productionOrderId);
  return {};
}

/** Quantités demandées par taille — remplace intégralement la liste (saisie simple, pas d'édition ligne à ligne). */
export async function setProductionOrderSizes(
  productionOrderId: string,
  sizes: { taille: string; quantite_demandee: number }[]
) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("production_order_sizes")
    .delete()
    .eq("production_order_id", productionOrderId);
  if (delError) return { error: delError.message };

  const rows = sizes.filter((s) => s.taille.trim().length > 0 && s.quantite_demandee > 0);
  if (rows.length > 0) {
    const { error: insError } = await supabase.from("production_order_sizes").insert(
      rows.map((s) => ({
        production_order_id: productionOrderId,
        taille: s.taille.trim(),
        quantite_demandee: s.quantite_demandee,
      }))
    );
    if (insError) return { error: insError.message };
  }

  revalidateOdf(productionOrderId);
  return {};
}

/** brouillon -> en_attente_validation. */
export async function submitProductionOrder(productionOrderId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_production_order", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * en_attente_validation -> en_production (génère les sous-ODF) ou refuse.
 * L'autorisation vient de `has_permission('ordres_fabrication', 'validate')`
 * côté Postgres — droit unique de validation (section 3 du document de
 * logique), réglable depuis Paramètres > Rôles & permissions, pas un rôle
 * codé en dur ici (même philosophie que archiveProductionOrder).
 */
export async function validateProductionOrder(productionOrderId: string) {
  await requireRole(["administrateur", "responsable_production", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("validate_production_order", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

export async function refuseProductionOrder(productionOrderId: string, reason?: string) {
  await requireRole(["administrateur", "responsable_production", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("refuse_production_order", {
    p_production_order_id: productionOrderId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * en_production -> demande_cloture. Réservé au chef de production
 * (responsable_production) côté RPC — possible uniquement si tous les
 * sous-ODF ont atteint leur quantité prévue (section 4 du document de
 * logique).
 */
export async function requestClosure(productionOrderId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_closure", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * demande_cloture -> terminee (approve=true) ou retour en_production
 * (renvoi pour corrections, motif obligatoire). Contrôle réel effectué par
 * la direction avant validation définitive (section 4).
 */
export async function confirmClosure(productionOrderId: string, approve: boolean, note?: string) {
  await requireRole(["administrateur", "responsable_production", "commercial"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_closure", {
    p_production_order_id: productionOrderId,
    p_approve: approve,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/** Clôture exceptionnelle — réservée à l'administrateur, motif obligatoire (section 6). */
export async function forceCloseProductionOrder(productionOrderId: string, reason: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("force_close_production_order", {
    p_production_order_id: productionOrderId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/** Annulation d'un ODF — réservée à l'administrateur, motif obligatoire (section 7). */
export async function cancelProductionOrder(productionOrderId: string, reason: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_production_order", {
    p_production_order_id: productionOrderId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
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
  // work_orders_update dans 0002_rls.sql) — action de gestion, distincte de
  // la saisie de quantité quotidienne qui passe par record_work_order_
  // quantity().
  const { error } = await supabase
    .from("work_orders")
    .update({ assigned_section_chief_id: userId })
    .eq("id", workOrderId);

  if (error) return { error: error.message };
  revalidatePath("/atelier/production");
  return {};
}
