"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { REPARTITION_TAILLES_KEYS } from "@/lib/patronnage/types";

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
  const tailleInvalide = rows.find((s) => !REPARTITION_TAILLES_KEYS.includes(s.taille.trim() as (typeof REPARTITION_TAILLES_KEYS)[number]));
  if (tailleInvalide) {
    return { error: `Taille invalide : "${tailleInvalide.taille}" — choisissez parmi ${REPARTITION_TAILLES_KEYS.join(", ")}.` };
  }
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

/**
 * Signalement d'anomalie (lot 5, section 14 du document de logique) — jamais
 * bloquant, juste un flag calculé (has_open_anomaly) qui fait apparaître le
 * triangle sur la liste des ODF. Aucune vérification de rôle ici : c'est
 * `report_anomaly` (SECURITY DEFINER) qui fait autorité — un chef de section
 * ne peut signaler que pour sa propre section (dérivée de son profil côté
 * fonction, jamais du paramètre passé ici), responsable_production/
 * administrateur peuvent signaler sans section précise.
 */
export async function reportAnomaly(
  productionOrderId: string,
  message: string,
  opts?: { sectionId?: string | null; workOrderId?: string | null; traceId?: string | null }
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_anomaly", {
    p_production_order_id: productionOrderId,
    p_section_id: opts?.sectionId ?? null,
    p_work_order_id: opts?.workOrderId ?? null,
    p_trace_id: opts?.traceId ?? null,
    p_message: message,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  revalidatePath("/atelier/section");
  return {};
}

/** Réservé à responsable_production/administrateur — vérifié par `resolve_anomaly` (SECURITY DEFINER). */
export async function resolveAnomaly(anomalyId: string, productionOrderId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_anomaly", { p_anomaly_id: anomalyId });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  revalidatePath("/atelier/section");
  return {};
}

// ============================================================================
// Lot 9 — configurateur couleur par zone (section 8/9 du document de
// logique) : même pattern que sections/tailles ci-dessus — écriture directe
// autorisée par la RLS (is_production_manager()), pas de RPC dédiée.
// ============================================================================

/** Choix du modèle de produit — détermine le gabarit de zones proposé ensuite. */
export async function setProductionOrderProductModel(productionOrderId: string, productModelId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({ product_model_id: productModelId })
    .eq("id", productionOrderId);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Couleur choisie par zone — remplace intégralement la liste (même logique
 * que setProductionOrderSizes). `zone_key` revalidé contre le gabarit réel
 * du modèle de produit de l'ODF plutôt que de faire confiance à l'appelant.
 */
export async function setProductionOrderZoneColors(
  productionOrderId: string,
  entries: { zone_key: string; color_id: string }[]
) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("production_orders")
    .select("product_model_id")
    .eq("id", productionOrderId)
    .single();
  if (!order?.product_model_id) return { error: "Choisissez d'abord un modèle de produit pour cet ODF." };

  const { data: template } = await supabase
    .from("product_zone_templates")
    .select("zone_key")
    .eq("product_model_id", order.product_model_id);
  const validZoneKeys = new Set((template ?? []).map((z) => z.zone_key));

  const rows = entries.filter((e) => e.zone_key && e.color_id);
  const invalidZone = rows.find((e) => !validZoneKeys.has(e.zone_key));
  if (invalidZone) {
    return { error: `Zone inconnue pour ce modèle de produit : "${invalidZone.zone_key}".` };
  }

  const { error: delError } = await supabase
    .from("production_order_zone_colors")
    .delete()
    .eq("production_order_id", productionOrderId);
  if (delError) return { error: delError.message };

  if (rows.length > 0) {
    const { error: insError } = await supabase.from("production_order_zone_colors").insert(
      rows.map((r) => ({
        production_order_id: productionOrderId,
        zone_key: r.zone_key,
        color_id: r.color_id,
      }))
    );
    if (insError) return { error: insError.message };
  }

  revalidateOdf(productionOrderId);
  return {};
}

/** Commentaire libre de disponibilité (achats/stock) — jamais validé par le logiciel (section 9). */
export async function setProductionOrderColorNote(productionOrderId: string, note: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({ note_disponibilite_couleurs: note.trim() || null })
    .eq("id", productionOrderId);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/** Visuel/maquette joint à l'ODF (MEDIA_FILE) — même pattern que attachMediaFileToSample. */
export async function attachMediaFileToProductionOrder(productionOrderId: string, mediaFileId: string) {
  const { authId } = await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("production_order_media_files").insert({
    production_order_id: productionOrderId,
    media_file_id: mediaFileId,
    added_by: authId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

export async function detachMediaFileFromProductionOrder(productionOrderId: string, mediaFileId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_order_media_files")
    .delete()
    .eq("production_order_id", productionOrderId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
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

// ============================================================================
// Lot 10 — mouvements de stock & fiches d'import Sage (section 19).
// ============================================================================

export type GenerateStockExportFicheResult = { error: string } | { id: string; numero: string };

/**
 * Regroupe dans une fiche numérotée tous les mouvements de stock pas encore
 * exportés de cet ODF (livraisons partielles possibles, section 19).
 * Aucune vérification de rôle ici : `generate_stock_export_fiche` (SECURITY
 * DEFINER) fait autorité (responsable_production/administrateur) — la fiche
 * conditionne la sortie commerciale (BL), même périmètre que
 * validateProductionOrder.
 */
export async function generateStockExportFiche(productionOrderId: string): Promise<GenerateStockExportFicheResult> {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_stock_export_fiche", {
    p_production_order_id: productionOrderId,
  }).single();

  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  const fiche = data as { id: string; numero: string };
  return { id: fiche.id, numero: fiche.numero };
}
