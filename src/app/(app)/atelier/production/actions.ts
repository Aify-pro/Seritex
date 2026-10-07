"use server";

import { createClient } from "@/lib/supabase/server";

import { requirePermission } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSizes } from "@/lib/sizes";
import { sendNotification } from "@/lib/notifications/send";
import { resolveUserEmail, resolveContactEmailForProductionOrder } from "@/lib/notifications/recipients";

async function notifyCommandeTerminee(productionOrderId: string) {
  const supabase = await createClient();
  const { data: po } = await supabase
    .from("production_orders")
    .select("reference, company_id, companies(name)")
    .eq("id", productionOrderId)
    .maybeSingle();
  // ODF de stock (SF-3) : pas de notification client.
  if (!po?.company_id) return;
  await sendNotification("commande_terminee", {
    to: await resolveContactEmailForProductionOrder(productionOrderId),
    variables: {
      numero_odf: po?.reference ?? "",
      nom_client: (po?.companies as unknown as { name: string } | null)?.name ?? "",
    },
    relatedEntityType: "production_order",
    relatedEntityId: productionOrderId,
  });
}

function revalidateOdf(productionOrderId: string) {
  revalidatePath(`/atelier/production/${productionOrderId}`);
  revalidatePath("/atelier/production");
  revalidatePath("/dashboard");
}

/**
 * Sections retenues pour un article d'un ODF en brouillon (migration 0037,
 * par article plutôt que par ODF entier — une commande peut mêler un
 * article à imprimer et un autre non) — remplace la dépendance à une gamme
 * opératoire figée par produit (routing_templates/routing_steps) : les
 * sections sont choisies à la saisie, pas figées à l'avance. Écriture
 * directe autorisée par la RLS (is_production_manager()), même pattern que
 * `reassignSectionChief` ci-dessous.
 *
 * Chaque section porte sa quantité de pièces (migration 0052) : `null` =
 * quantité totale de l'article. Utile quand plusieurs ateliers d'une même
 * catégorie se partagent le travail — reprise comme quantité planifiée du
 * sous-ODF à la validation.
 *
 * Chaque section peut aussi porter une `partie` de la pièce (migration 0069,
 * ex. « Manches » / « Col ») : l'atelier travaille alors sur toutes les
 * pièces, pour cette partie seulement — la quantité reste celle de l'article.
 */
export async function setProductionOrderLineSections(
  lineId: string,
  productionOrderId: string,
  sections: { sectionId: string; quantite: number | null; partie: string | null; etape?: number }[]
) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  if (sections.some((s) => s.quantite !== null && (!Number.isInteger(s.quantite) || s.quantite < 0))) {
    return { error: "La quantité d'une section doit être un nombre entier positif." };
  }
  if (sections.some((s) => s.etape !== undefined && (!Number.isInteger(s.etape) || s.etape < 1))) {
    return { error: "L'étape d'une section doit être un entier à partir de 1." };
  }
  const partieDe = (s: { partie: string | null }) => s.partie?.trim() || null;
  if (sections.some((s) => (partieDe(s)?.length ?? 0) > 80)) {
    return { error: "La partie d'une section ne peut pas dépasser 80 caractères." };
  }

  const { error: delError } = await supabase
    .from("production_order_line_sections")
    .delete()
    .eq("production_order_line_id", lineId);
  if (delError) return { error: delError.message };

  if (sections.length > 0) {
    const { error: insError } = await supabase.from("production_order_line_sections").insert(
      sections.map((s, i) => ({
        production_order_line_id: lineId,
        section_id: s.sectionId,
        ordre: i + 1,
        // Étapes (SF-1) : même numéro = sections en parallèle ; absente = en série.
        etape: s.etape ?? i + 1,
        quantite: s.quantite,
        partie: partieDe(s),
      }))
    );
    if (insError) return { error: insError.message };
  }

  // Une section retirée de l'article ne doit pas garder de visuel affecté.
  const { data: affectations } = await supabase
    .from("production_order_line_section_visuels")
    .select("section_id")
    .eq("production_order_line_id", lineId);
  const keptIds = new Set(sections.map((s) => s.sectionId));
  const orphanIds = [...new Set((affectations ?? []).map((a) => a.section_id as string))].filter((id) => !keptIds.has(id));
  if (orphanIds.length > 0) {
    const { error: orphanError } = await supabase
      .from("production_order_line_section_visuels")
      .delete()
      .eq("production_order_line_id", lineId)
      .in("section_id", orphanIds);
    if (orphanError) return { error: orphanError.message };
  }

  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Applique un parcours type du modèle à un article d'ODF modifiable (ART-H) :
 * ses sections sont remplacées, la Finition ajoutée en dernier ; le parcours
 * reste ensuite modifiable. Autorité : apply_model_route (base).
 */
export async function applyModelRoute(lineId: string, productionOrderId: string, routeId: string) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_model_route", { p_line_id: lineId, p_route_id: routeId });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Quantités demandées par taille, pour une ligne d'ODF (un article) —
 * remplace intégralement la liste de cette ligne (saisie simple, pas
 * d'édition ligne à ligne). Chaque article a son propre dispatching depuis
 * le chantier ODF multi-lignes (migration 0035) : le client peut demander
 * le jaune en XL et le bleu en L, pas une seule grille mélangée.
 */
export async function setProductionOrderLineSizes(
  lineId: string,
  productionOrderId: string,
  sizes: { taille: string; quantite_demandee: number }[]
) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  const rows = sizes.filter((s) => s.taille.trim().length > 0 && s.quantite_demandee > 0);

  // Les tailles viennent du référentiel (Paramètres > Couleurs et tailles) et
  // non plus d'une liste figée. La clé étrangère posée par 0031 refuserait de
  // toute façon une valeur inconnue : ce contrôle sert à rendre le refus
  // lisible avant d'y arriver.
  const referentiel = new Set((await getSizes()).map((t) => t.cle));
  const tailleInvalide = rows.find((s) => !referentiel.has(s.taille.trim()));
  if (tailleInvalide) {
    return {
      error: `Taille inconnue du référentiel : « ${tailleInvalide.taille} ». Ajoutez-la dans Paramètres > Couleurs et tailles.`,
    };
  }

  // Le dispatching doit tomber pile sur la quantité de l'article — ni
  // surplus, ni manque, contrôlé côté serveur (source de vérité, l'écart
  // affiché à l'écran n'est qu'un indicateur visuel) avant toute écriture,
  // pour ne jamais laisser production_order_sizes vide si le contrôle
  // échoue après une suppression déjà faite.
  const { data: line, error: lineError } = await supabase
    .from("production_order_lines")
    .select("quantity")
    .eq("id", lineId)
    .single();
  if (lineError) return { error: lineError.message };

  const reparti = rows.reduce((somme, s) => somme + s.quantite_demandee, 0);
  const ecart = reparti - line.quantity;
  if (ecart !== 0) {
    return {
      error:
        ecart > 0
          ? `Dispatching supérieur à la quantité de l'article : ${reparti} réparti(s) pour ${line.quantity} demandé(s) (${ecart} en trop).`
          : `Dispatching inférieur à la quantité de l'article : ${reparti} réparti(s) pour ${line.quantity} demandé(s) (il manque ${-ecart}).`,
    };
  }

  const { error: delError } = await supabase
    .from("production_order_sizes")
    .delete()
    .eq("production_order_line_id", lineId);
  if (delError) return { error: delError.message };

  if (rows.length > 0) {
    const { error: insError } = await supabase.from("production_order_sizes").insert(
      rows.map((s) => ({
        production_order_line_id: lineId,
        taille: s.taille.trim(),
        quantite_demandee: s.quantite_demandee,
      }))
    );
    if (insError) return { error: insError.message };
  }

  // Resynchronise la fiche de tracé liée, si elle existe : son dispatching
  // (repartition_tailles/quantite_totale) n'est qu'une COPIE prise au moment
  // de la liaison (applyLineToFiche, fiches-actions.ts) — sans ce
  // rattrapage, corriger le dispatching de l'ODF après la liaison laissait
  // l'OT afficher des tailles obsolètes (constaté en prod : un 5XL retiré
  // de l'ODF restait affiché sur l'OT). reparti === line.quantity ici
  // (contrôle ci-dessus), donc quantite_totale peut reprendre l'un ou
  // l'autre sans distinction.
  const repartitionTailles: Record<string, number> = {};
  for (const s of rows) {
    const cle = s.taille.trim();
    repartitionTailles[cle] = (repartitionTailles[cle] ?? 0) + s.quantite_demandee;
  }
  const { data: ficheLiee } = await supabase
    .from("fiches_placement")
    .select("id")
    .eq("production_order_line_id", lineId)
    .maybeSingle();
  if (ficheLiee) {
    await supabase
      .from("fiches_placement")
      .update({
        quantite_totale: reparti,
        repartition_tailles: repartitionTailles,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ficheLiee.id);
    revalidatePath("/atelier/patronnage");
    revalidatePath(`/atelier/patronnage/${ficheLiee.id}`);
  }

  // productionOrderId reçu de l'appelant plutôt que résolu ici (déjà
  // disponible côté page, évite un aller-retour) pour revalider les bonnes
  // routes.
  revalidateOdf(productionOrderId);
  return {};
}

/** brouillon -> en_attente_validation. */
export async function submitProductionOrder(productionOrderId: string) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_production_order", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Circuit de validation avant soumission (migration 0050) : la comptabilité
 * atteste que le compte du client est en règle — toujours requis, avant
 * submit_production_order(). L'autorisation vient de
 * `has_permission('validation_comptable', 'validate')` côté Postgres,
 * réglable depuis Paramètres > Rôles & permissions.
 */
export async function attesterComptabiliteOdf(productionOrderId: string) {
  await requirePermission("validation_comptable", "validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("attester_comptabilite_odf", { p_production_order_id: productionOrderId });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Circuit de validation avant soumission (migration 0050) : l'infographie
 * atteste que les visuels/maquette sont validés — requis seulement si au
 * moins un article exige un visuel (submit_production_order() le
 * revérifie). Autorisation via `has_permission('validation_visuels',
 * 'validate')`.
 */
export async function attesterInfographieOdf(productionOrderId: string) {
  await requirePermission("validation_visuels", "validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("attester_infographie_odf", { p_production_order_id: productionOrderId });
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
  await requirePermission("ordres_fabrication", "validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("validate_production_order", {
    p_production_order_id: productionOrderId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

export async function refuseProductionOrder(productionOrderId: string, reason?: string) {
  await requirePermission("ordres_fabrication", "validate");
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
 * (responsable_production) côté RPC. Le bilan par taille (1er/2e choix,
 * déchets, en-cours) est figé sur l'ODF ; s'il reste de l'en-cours, un motif
 * est exigé (SF-1, migration 0072).
 */
export async function requestClosure(productionOrderId: string, motif?: string) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  // SF-4 : refusée tant qu'il reste de l'en-cours (destinations à donner d'abord).
  const { error } = await supabase.rpc("request_closure", {
    p_production_order_id: productionOrderId,
    p_motif: motif?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

const settleSchema = z.object({
  workOrderId: z.guid(),
  taille: z.string().min(1),
  quantite: z.number().int().positive("Quantité invalide"),
  destination: z.enum(["dechet", "abandon", "stock_vierge", "stock_personnalise", "livre_client"]),
  motif: z.string().trim().min(1, "Un motif est obligatoire"),
});

/**
 * Destination d'un reste d'en-cours avant la clôture (SF-4, settle_en_cours) :
 * déchet, abandon (reste non prélevé au stock), ou terminé jusqu'à la
 * finition puis entré en stock vierge / personnalisé ou livré au client.
 */
export async function settleEnCours(productionOrderId: string, input: z.input<typeof settleSchema>) {
  await requirePermission("ordres_fabrication", "modify");
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("settle_en_cours", {
    p_work_order_id: parsed.data.workOrderId,
    p_taille: parsed.data.taille,
    p_quantite: parsed.data.quantite,
    p_destination: parsed.data.destination,
    p_motif: parsed.data.motif,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/** Ajuste la consommation réelle d'un consommable (COM-G), entre la demande de clôture et la clôture. */
export async function adjustConsumption(productionOrderId: string, consumptionId: string, quantite: number, motif: string) {
  await requirePermission("ordres_fabrication", "modify");
  if (!Number.isFinite(quantite) || quantite < 0) return { error: "Quantité invalide" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_order_consumption", {
    p_consumption_id: consumptionId,
    p_quantite: quantite,
    p_motif: motif.trim() || null,
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
  await requirePermission("ordres_fabrication", "validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_closure", {
    p_production_order_id: productionOrderId,
    p_approve: approve,
    p_note: note || null,
  });
  if (error) return { error: error.message };
  if (approve) await notifyCommandeTerminee(productionOrderId);
  revalidateOdf(productionOrderId);
  return {};
}

/** Clôture exceptionnelle — réservée à l'administrateur, motif obligatoire (section 6). */
export async function forceCloseProductionOrder(productionOrderId: string, reason: string) {
  await requirePermission("ordres_fabrication", "unlock");
  const supabase = await createClient();
  const { error } = await supabase.rpc("force_close_production_order", {
    p_production_order_id: productionOrderId,
    p_reason: reason,
  });
  if (error) return { error: error.message };
  await notifyCommandeTerminee(productionOrderId);
  revalidateOdf(productionOrderId);
  return {};
}

/** Annulation d'un ODF — réservée à l'administrateur, motif obligatoire (section 7). */
export async function cancelProductionOrder(productionOrderId: string, reason: string) {
  await requirePermission("ordres_fabrication", "delete");
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
 * Relie un ODF annulé à l'ODF qui le remplace (lot 1,
 * `replaced_by_production_order_id`). La migration 0009 avait volontairement
 * laissé cette colonne hors de `cancel_production_order()` — le remplaçant
 * n'existe pas encore au moment où l'on annule — en renvoyant le geste « à
 * part, une fois le nouvel ODF créé ». Ce « à part », c'est ici : l'audit
 * avait relevé que la colonne existait sans que rien ne la renseigne jamais.
 *
 * Écriture directe, autorisée par la RLS pour `is_production_manager()` —
 * même pattern que `setProductionOrderLineSections`. Passer `null` délie.
 */
export async function setReplacementProductionOrder(
  productionOrderId: string,
  replacementId: string | null
) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("production_orders")
    .select("id,status,company_id")
    .eq("id", productionOrderId)
    .single();
  if (orderError || !order) return { error: "Ordre de fabrication introuvable." };
  if (order.status !== "annulee") {
    return { error: "Seul un ordre de fabrication annulé peut être relié à un remplaçant." };
  }

  if (replacementId) {
    if (replacementId === productionOrderId) {
      return { error: "Un ordre de fabrication ne peut pas se remplacer lui-même." };
    }

    const { data: replacement, error: replacementError } = await supabase
      .from("production_orders")
      .select("id,reference,status,company_id,replaced_by_production_order_id")
      .eq("id", replacementId)
      .single();
    if (replacementError || !replacement) return { error: "Ordre de fabrication de remplacement introuvable." };
    if (replacement.status === "annulee") {
      return { error: `${replacement.reference} est lui-même annulé : choisissez un ordre de fabrication actif.` };
    }
    if (replacement.company_id !== order.company_id) {
      return { error: `${replacement.reference} appartient à un autre client.` };
    }
    // Deux ODF annulés qui se désigneraient l'un l'autre rendraient la chaîne
    // de remplacement illisible — et le cas se produit vite quand on annule
    // deux fois de suite.
    if (replacement.replaced_by_production_order_id === productionOrderId) {
      return { error: `${replacement.reference} désigne déjà cet ordre de fabrication comme son remplaçant.` };
    }
  }

  const { error } = await supabase
    .from("production_orders")
    .update({ replaced_by_production_order_id: replacementId })
    .eq("id", productionOrderId);
  if (error) return { error: error.message };

  revalidateOdf(productionOrderId);
  if (replacementId) revalidateOdf(replacementId);
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
  await requirePermission("ordres_fabrication", "archive");
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
  await requirePermission("ordres_fabrication", "archive");
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
// ODF multi-lignes — configuration produit par ligne (une ligne = un
// article du devis, migration 0035). Même pattern que sections/tailles
// ci-dessus — écriture directe autorisée par la RLS
// (is_production_manager()), pas de RPC dédiée.
// ============================================================================

/**
 * Modèle de produit d'une ligne restée sans modèle après accept_quote()
 * (la ligne de devis correspondante n'en portait aucun) — seul cas où le
 * modèle reste à saisir côté ODF : dès qu'un modèle vient du devis, il est
 * hérité et non modifiable ici, le client l'a déjà validé.
 */
export async function setProductionOrderLineProductModel(lineId: string, productModelId: string) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { data: line, error } = await supabase
    .from("production_order_lines")
    .update({ product_model_id: productModelId })
    .eq("id", lineId)
    .select("production_order_id")
    .single();
  if (error) return { error: error.message };
  revalidateOdf(line.production_order_id);
  return {};
}

/**
 * Couleur par zone d'une ligne — remplace intégralement la liste (même
 * logique que setProductionOrderLineSizes). `zone_key` revalidé contre le
 * gabarit réel du modèle de produit de la ligne plutôt que de faire
 * confiance à l'appelant.
 */
export async function setProductionOrderLineZoneColors(
  lineId: string,
  entries: { zone_key: string; color_id: string }[]
) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  const { data: line } = await supabase
    .from("production_order_lines")
    .select("production_order_id,product_model_id")
    .eq("id", lineId)
    .single();
  if (!line) return { error: "Article introuvable." };
  if (!line.product_model_id) return { error: "Choisissez d'abord un modèle de produit pour cet article." };

  const { data: template } = await supabase
    .from("product_zone_templates")
    .select("zone_key")
    .eq("product_model_id", line.product_model_id);
  const validZoneKeys = new Set((template ?? []).map((z) => z.zone_key));

  const rows = entries.filter((e) => e.zone_key && e.color_id);
  const invalidZone = rows.find((e) => !validZoneKeys.has(e.zone_key));
  if (invalidZone) {
    return { error: `Zone inconnue pour ce modèle de produit : "${invalidZone.zone_key}".` };
  }

  // Mutuellement exclusif avec la couleur unique (voir
  // setProductionOrderLineColorUnique) — poser des couleurs par zone
  // repasse en mode "par zone" même si "modèle uni" avait été coché avant.
  const { error: uniError } = await supabase
    .from("production_order_lines")
    .update({ couleur_unique_id: null })
    .eq("id", lineId);
  if (uniError) return { error: uniError.message };

  const { error: delError } = await supabase
    .from("production_order_line_zone_colors")
    .delete()
    .eq("production_order_line_id", lineId);
  if (delError) return { error: delError.message };

  if (rows.length > 0) {
    const { error: insError } = await supabase.from("production_order_line_zone_colors").insert(
      rows.map((r) => ({
        production_order_line_id: lineId,
        zone_key: r.zone_key,
        color_id: r.color_id,
      }))
    );
    if (insError) return { error: insError.message };
  }

  revalidateOdf(line.production_order_id);
  return {};
}

/**
 * Couleur unique ("modèle uni") d'une ligne — alternative à
 * setProductionOrderLineZoneColors pour un modèle sans gabarit de zones,
 * ou un article volontairement monochrome malgré un gabarit existant. Les
 * deux ne sont jamais actifs en même temps : poser une couleur unique
 * efface les couleurs par zone déjà saisies, et inversement
 * (submit_production_order() n'accepte que l'une ou l'autre par ligne,
 * migration 0035).
 */
export async function setProductionOrderLineColorUnique(lineId: string, colorId: string | null) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  const { data: line, error: updError } = await supabase
    .from("production_order_lines")
    .update({ couleur_unique_id: colorId })
    .eq("id", lineId)
    .select("production_order_id")
    .single();
  if (updError) return { error: updError.message };

  if (colorId) {
    const { error: delError } = await supabase
      .from("production_order_line_zone_colors")
      .delete()
      .eq("production_order_line_id", lineId);
    if (delError) return { error: delError.message };
  }

  revalidateOdf(line.production_order_id);
  return {};
}

/** Commentaire libre de disponibilité (achats/stock) — jamais validé par le logiciel (section 9). */
export async function setProductionOrderColorNote(productionOrderId: string, note: string) {
  await requirePermission("ordres_fabrication", "modify");
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
  const { authId } = await requirePermission("odf_visuels", "modify");
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
  await requirePermission("odf_visuels", "modify");
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_order_media_files")
    .delete()
    .eq("production_order_id", productionOrderId)
    .eq("media_file_id", mediaFileId)
    .is("production_order_line_id", null);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Fichier (visuel OU maquette, migration 0040 — même rattachement pour les
 * deux, seule leur catégorie diffère) joint à un article précis (migration
 * 0037, plus seulement à l'ODF entier) : c'est ce rattachement, pas celui
 * ci-dessus, que vérifie validate_production_order() pour une section de
 * catégorie Impression retenue sur CET article (visuel uniquement — la
 * maquette n'est pas aujourd'hui une condition bloquante).
 *
 * Le visuel reste multiple (plusieurs fichiers d'exploitation par article,
 * ex. recto/verso) — la maquette, elle, est unique par article (demande
 * Ayman, 16/09) : en joindre une nouvelle remplace silencieusement
 * l'ancienne plutôt que de s'y ajouter. Contrôle fait ici, pas en base
 * (pas de contrainte d'unicité sur production_order_media_files) — le
 * rattachement passe toujours par ce point d'entrée unique.
 */
export async function attachMediaFileToLine(
  lineId: string,
  productionOrderId: string,
  mediaFileId: string,
  sectionId?: string
) {
  const { authId } = await requirePermission("odf_visuels", "modify");
  const supabase = await createClient();

  // Depuis la zone d'un atelier d'impression : le fichier est joint à
  // l'article s'il ne l'est pas déjà (il peut déjà y être, ou venir du
  // devis), puis affecté à cet atelier.
  if (sectionId) {
    const { data: already } = await supabase
      .from("production_order_media_files")
      .select("id")
      .eq("production_order_line_id", lineId)
      .eq("media_file_id", mediaFileId)
      .maybeSingle();
    if (!already) {
      const { error: attachError } = await supabase.from("production_order_media_files").insert({
        production_order_id: productionOrderId,
        production_order_line_id: lineId,
        media_file_id: mediaFileId,
        added_by: authId,
      });
      if (attachError) return { error: attachError.message };
    }
    return assignVisuelToSection(lineId, productionOrderId, sectionId, mediaFileId);
  }

  const { data: media } = await supabase.from("media_files").select("category").eq("id", mediaFileId).maybeSingle();
  if (media?.category === "maquette") {
    const { data: existing } = await supabase
      .from("production_order_media_files")
      .select("media_file_id, media_files!inner(category)")
      .eq("production_order_line_id", lineId)
      .eq("media_files.category", "maquette");
    const existingIds = (existing ?? []).map((e) => e.media_file_id);
    if (existingIds.length > 0) {
      const { error: delError } = await supabase
        .from("production_order_media_files")
        .delete()
        .eq("production_order_line_id", lineId)
        .in("media_file_id", existingIds);
      if (delError) return { error: delError.message };
    }
  }

  const { error } = await supabase.from("production_order_media_files").insert({
    production_order_id: productionOrderId,
    production_order_line_id: lineId,
    media_file_id: mediaFileId,
    added_by: authId,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Affecte un visuel de l'article (joint à l'ODF ou hérité du devis) à un
 * atelier précis (migration 0069) — utile quand plusieurs ateliers
 * d'impression sont retenus (DTF, sérigraphie…), chacun avec son visuel.
 */
export async function assignVisuelToSection(
  lineId: string,
  productionOrderId: string,
  sectionId: string,
  mediaFileId: string
) {
  const { authId } = await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();

  const { data: chosen } = await supabase
    .from("production_order_line_sections")
    .select("id")
    .eq("production_order_line_id", lineId)
    .eq("section_id", sectionId)
    .maybeSingle();
  if (!chosen) return { error: "Cette section n'est pas retenue sur cet article." };

  const { error } = await supabase.from("production_order_line_section_visuels").upsert(
    {
      production_order_id: productionOrderId,
      production_order_line_id: lineId,
      section_id: sectionId,
      media_file_id: mediaFileId,
      added_by: authId,
    },
    { onConflict: "production_order_line_id,section_id,media_file_id", ignoreDuplicates: true }
  );
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

export async function unassignVisuelFromSection(
  lineId: string,
  productionOrderId: string,
  sectionId: string,
  mediaFileId: string
) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { error } = await supabase
    .from("production_order_line_section_visuels")
    .delete()
    .eq("production_order_line_id", lineId)
    .eq("section_id", sectionId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

export async function detachMediaFileFromLine(lineId: string, productionOrderId: string, mediaFileId: string) {
  await requirePermission("odf_visuels", "modify");
  const supabase = await createClient();

  // Un visuel détaché de l'article ne reste affecté à aucun atelier.
  const { error: unassignError } = await supabase
    .from("production_order_line_section_visuels")
    .delete()
    .eq("production_order_line_id", lineId)
    .eq("media_file_id", mediaFileId);
  if (unassignError) return { error: unassignError.message };
  const { error } = await supabase
    .from("production_order_media_files")
    .delete()
    .eq("production_order_line_id", lineId)
    .eq("media_file_id", mediaFileId);
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

const linePrintableZonesSchema = z.array(
  z.object({
    printable_zone_id: z.guid(),
    // Null : emplacement coché avant la migration 0065, nombre de couleurs inconnu.
    nb_couleurs: z.number().int().min(1).max(12).nullable(),
  })
);

/**
 * Zones imprimables cochées pour UN article de l'ODF (migration 0040), parmi
 * celles définies pour son modèle de produit (product_printable_zones,
 * migration 0039), avec leur nombre de couleurs (migration 0065 — hérité du
 * devis, corrigeable ici par la production). Même pattern que
 * `setProductionOrderLineSections` — remplace tout à chaque appel.
 */
export async function setProductionOrderLinePrintableZones(
  lineId: string,
  productionOrderId: string,
  printableZones: { printable_zone_id: string; nb_couleurs: number | null }[]
) {
  await requirePermission("ordres_fabrication", "modify");
  const parsed = linePrintableZonesSchema.safeParse(printableZones);
  if (!parsed.success) return { error: "Impressions invalides" };
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("production_order_line_printable_zones")
    .delete()
    .eq("production_order_line_id", lineId);
  if (delError) return { error: delError.message };

  if (parsed.data.length > 0) {
    const { error: insError } = await supabase.from("production_order_line_printable_zones").insert(
      parsed.data.map((z) => ({
        production_order_line_id: lineId,
        printable_zone_id: z.printable_zone_id,
        nb_couleurs: z.nb_couleurs,
      }))
    );
    if (insError) return { error: insError.message };
  }

  revalidateOdf(productionOrderId);
  return {};
}

export async function reassignSectionChief(workOrderId: string, userId: string | null) {
  await requirePermission("ordres_fabrication", "modify");
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

  if (userId) {
    const { data: wo } = await supabase
      .from("work_orders")
      .select("reference, production_orders(reference), sections(name)")
      .eq("id", workOrderId)
      .maybeSingle();
    await sendNotification("ot_assigne_chef_section", {
      to: await resolveUserEmail(userId),
      variables: {
        numero_ot: wo?.reference ?? "",
        numero_odf: (wo?.production_orders as unknown as { reference: string } | null)?.reference ?? "",
        section: (wo?.sections as unknown as { name: string } | null)?.name ?? "",
      },
      relatedEntityType: "work_order",
      relatedEntityId: workOrderId,
    });
  }

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
 * `generate_stock_export_fiche` (SECURITY DEFINER) fait autorité —
 * administrateur/responsable_production/gestionnaire_stock (migration
 * 0023) ; le `requireRole` ici doit rester le même périmètre, pas un sous-
 * ensemble, sous peine de refuser ce que le RPC autoriserait.
 */
export async function generateStockExportFiche(productionOrderId: string): Promise<GenerateStockExportFicheResult> {
  await requirePermission("stock_atelier", "modify");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("generate_stock_export_fiche", {
    p_production_order_id: productionOrderId,
  }).single();

  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  revalidatePath("/atelier/stock");
  const fiche = data as { id: string; numero: string };
  return { id: fiche.id, numero: fiche.numero };
}

/**
 * Découpe un article d'ODF modifiable (SF-2) : les quantités par taille
 * données passent sur une nouvelle ligne du même article — typiquement une
 * partie prise en stock, une partie fabriquée. Autorité : la base.
 */
export async function splitProductionOrderLine(lineId: string, productionOrderId: string, tailles: Record<string, number>) {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("split_production_order_line", { p_line_id: lineId, p_tailles: tailles });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}

/**
 * Paramètres de l'analyse du prix de revient réel d'un ODF (migration 0070) :
 * prix du tissu au kg propre à cet ODF (null = prix du textile) et notes.
 */
export async function saveOdfRealCost(productionOrderId: string, input: { prix_tissu_kg: number | null; notes: string }) {
  const { profile } = await requirePermission("tarification", "modify");
  const parsed = z
    .object({
      prix_tissu_kg: z.number().positive("Prix au kg invalide").nullable(),
      notes: z.string().trim().max(2000).transform((v) => v || null),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Paramètres invalides" };

  const supabase = await createClient();
  const { error } = await supabase.from("production_order_real_costs").upsert({
    production_order_id: productionOrderId,
    ...parsed.data,
    updated_at: new Date().toISOString(),
    updated_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidateOdf(productionOrderId);
  return {};
}
