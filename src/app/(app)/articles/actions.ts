"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Actions de la fiche article (ART-A) — reprises de Paramètres > Modèles de
 * produits, qui ne contient plus de fiche produit (A3). Autorisations
 * inchangées ; la RLS de product_models et des tables rattachées fait foi.
 */
function revalidateArticles() {
  revalidatePath("/articles", "layout");
}

/**
 * Disponibilité d'un modèle : remplace intégralement la liste des tailles ou
 * des couleurs proposables. Une liste vide signifie « aucune restriction
 * déclarée » — tout le référentiel actif reste proposable — et non « rien
 * n'est disponible » : sans cette convention, activer le référentiel rendrait
 * d'un coup tous les modèles existants incomplets.
 */
export async function setProductModelSizes(productModelId: string, sizeIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("product_model_sizes")
    .delete()
    .eq("product_model_id", productModelId);
  if (delError) return { error: delError.message };

  if (sizeIds.length > 0) {
    const { error } = await supabase
      .from("product_model_sizes")
      .insert(sizeIds.map((size_id) => ({ product_model_id: productModelId, size_id })));
    if (error) return { error: error.message };
  }

  revalidateArticles();
  return {};
}

export async function setProductModelColors(productModelId: string, colorIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("product_model_colors")
    .delete()
    .eq("product_model_id", productModelId);
  if (delError) return { error: delError.message };

  if (colorIds.length > 0) {
    const { error } = await supabase
      .from("product_model_colors")
      .insert(colorIds.map((color_id) => ({ product_model_id: productModelId, color_id })));
    if (error) return { error: error.message };
  }

  revalidateArticles();
  return {};
}

const newProductModelSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
});

/**
 * Modèles de produit — aucune page de gestion n'existait avant ce lot
 * (product_models n'était consommé qu'en lecture, pour les devis et le
 * catalogue Sage). Nécessaire ici pour rattacher un gabarit de zones.
 */
export async function createProductModel(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newProductModelSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("product_models").insert({
    name: parsed.data.name.trim(),
    category: parsed.data.category?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

export async function toggleProductModelActive(productModelId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_models").update({ active }).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/**
 * Lot 10 : référence Sage d'un modèle de produit — colonne présente depuis
 * la migration 0005 mais jamais éditable depuis l'application jusqu'ici.
 * Nécessaire pour que les mouvements de stock entree_semi_fini/entree_fini
 * (migration 0020) portent une référence exploitable par Sage.
 */
export async function setProductModelSageReference(productModelId: string, sageReference: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_models")
    .update({ sage_reference: sageReference.trim() || null })
    .eq("id", productModelId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

const newZoneSchema = z.object({
  product_model_id: z.string().uuid(),
  zone_key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "Clé de zone : minuscules, chiffres et underscores uniquement"),
  zone_label: z.string().trim().min(1),
});

/** Ajoute une zone au gabarit d'un modèle de produit (section 8) — placée après les zones existantes. */
export async function addProductZoneTemplate(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newZoneSchema.safeParse({
    product_model_id: formData.get("product_model_id"),
    zone_key: formData.get("zone_key"),
    zone_label: formData.get("zone_label"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("product_zone_templates")
    .select("display_order")
    .eq("product_model_id", parsed.data.product_model_id)
    .order("display_order", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("product_zone_templates").insert({
    product_model_id: parsed.data.product_model_id,
    zone_key: parsed.data.zone_key,
    zone_label: parsed.data.zone_label,
    display_order: (existing?.[0]?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/** Retire une zone du gabarit — réservé à l'administrateur (cohérent avec product_zone_templates_delete). */
export async function removeProductZoneTemplate(zoneTemplateId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_zone_templates").delete().eq("id", zoneTemplateId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

// Zones imprimables (référentiel distinct du gabarit de zones couleur ci-dessus) — sections de catégorie Impression.

const newPrintableZoneSchema = z.object({
  product_model_id: z.string().uuid(),
  zone_key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "Clé de zone : minuscules, chiffres et underscores uniquement"),
  zone_label: z.string().trim().min(1),
});

/** Ajoute une zone imprimable à un modèle de produit — placée après les zones imprimables existantes. */
export async function addProductPrintableZone(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newPrintableZoneSchema.safeParse({
    product_model_id: formData.get("product_model_id"),
    zone_key: formData.get("zone_key"),
    zone_label: formData.get("zone_label"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("product_printable_zones")
    .select("display_order")
    .eq("product_model_id", parsed.data.product_model_id)
    .order("display_order", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("product_printable_zones").insert({
    product_model_id: parsed.data.product_model_id,
    zone_key: parsed.data.zone_key,
    zone_label: parsed.data.zone_label,
    display_order: (existing?.[0]?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/** Retire une zone imprimable — réservé à l'administrateur (cohérent avec product_printable_zones_delete). */
export async function removeProductPrintableZone(zoneId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_printable_zones").delete().eq("id", zoneId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

// Lot 12 — nomenclature (fournitures constantes).

const newNomenclatureLineSchema = z.object({
  product_model_id: z.string().uuid(),
  designation: z.string().trim().min(1),
  quantite_par_piece: z.coerce.number().positive(),
  unite: z.string().trim().min(1),
});

/** Ajoute une ligne de nomenclature (composant constant hors tissu) à un modèle de produit. */
export async function addNomenclatureLine(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newNomenclatureLineSchema.safeParse({
    product_model_id: formData.get("product_model_id"),
    designation: formData.get("designation"),
    quantite_par_piece: formData.get("quantite_par_piece"),
    unite: formData.get("unite"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("nomenclature_lines").insert(parsed.data);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/** Retire une ligne de nomenclature — réservé à l'administrateur (cohérent avec nomenclature_lines_delete). */
export async function removeNomenclatureLine(lineId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("nomenclature_lines").delete().eq("id", lineId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

const identitySchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire").max(120),
  category: z.string().trim().max(80).optional(),
});

/** Nom et catégorie d'un modèle (onglet Général de la fiche article). */
export async function updateProductModelIdentity(productModelId: string, formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = identitySchema.safeParse({ name: formData.get("name"), category: formData.get("category") ?? undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  // La catégorie se choisit désormais dans le référentiel (COM-0) ; le champ
  // libre n'est écrit que s'il est transmis.
  const update: Record<string, string | null> = { name: parsed.data.name };
  if (formData.has("category")) update.category = parsed.data.category || null;
  const { error } = await supabase.from("product_models").update(update).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/**
 * Rattache à ce modèle un article de patronnage resté orphelin (A5 : le
 * patronnage est forcément lié à un modèle). Les orphelins sont listés dans
 * l'inventaire de la migration 0073.
 */
export async function attachPatternArticle(patternArticleId: string, productModelId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("pattern_articles")
    .update({ product_model_id: productModelId })
    .eq("id", patternArticleId)
    .is("product_model_id", null);
  if (error) return { error: error.message };
  revalidateArticles();
  revalidatePath("/atelier/patronnage/bibliotheque");
  return {};
}

/**
 * Catégorie et matière du modèle (COM-0). La catégorie donne le code du
 * modèle (TS012), attribué une fois pour toutes par la base ; la matière
 * borne les textiles autorisés (A6).
 */
export async function setProductModelClassification(
  productModelId: string,
  patch: { categorieId?: string | null; matiereId?: string | null }
) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const update: Record<string, string | null> = {};
  if (patch.categorieId !== undefined) update.categorie_id = patch.categorieId;
  if (patch.matiereId !== undefined) update.matiere_id = patch.matiereId;
  const { error } = await supabase.from("product_models").update(update).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/** Textiles autorisés (axe grammage des déclinaisons) — remplace la liste. */
export async function setProductModelTextiles(productModelId: string, textileIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { data: current } = await supabase.from("product_model_textiles").select("textile_id").eq("product_model_id", productModelId);
  const before = new Set((current ?? []).map((r) => r.textile_id as string));
  const toRemove = [...before].filter((id) => !textileIds.includes(id));
  const toAdd = textileIds.filter((id) => !before.has(id));
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("product_model_textiles")
      .delete()
      .eq("product_model_id", productModelId)
      .in("textile_id", toRemove);
    if (error) return { error: error.message };
  }
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from("product_model_textiles")
      .insert(toAdd.map((textile_id) => ({ product_model_id: productModelId, textile_id })));
    if (error) return { error: error.message };
  }
  revalidateArticles();
  return {};
}

/** Génère les déclinaisons cochées (textiles × couleurs × tailles) — ensure_variants. */
export async function generateVariants(productModelId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_variants", { p_model_id: productModelId });
  if (error) return { error: error.message };
  revalidateArticles();
  return { created: data as number };
}

export async function setVariantActive(variantId: string, actif: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ actif, archived_at: actif ? null : new Date().toISOString() })
    .eq("id", variantId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

/**
 * Référence Sage d'un article stockable (vierge, P, D) ou de la déclinaison.
 * Une référence absente du miroir Sage n'est pas bloquante : elle est
 * signalée (check_sage_reference).
 */
export async function setStockArticleSageReference(
  target: { kind: "stock_article" | "variant"; id: string },
  reference: string
): Promise<{ error?: string; warning?: string }> {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const ref = reference.trim() || null;
  const table = target.kind === "variant" ? "product_variants" : "variant_stock_articles";
  const { error } = await supabase.from(table).update({ sage_reference: ref }).eq("id", target.id);
  if (error) return { error: error.message };
  revalidateArticles();
  if (!ref) return {};
  const { data } = await supabase.rpc("check_sage_reference", { p_reference: ref }).maybeSingle();
  const found = (data as { trouvee: boolean } | null)?.trouvee;
  return found ? {} : { warning: `La référence ${ref} est absente du miroir Sage : vérifiez-la.` };
}

/* ============================================================
   Parcours types de fabrication (ART-H, migration 0077)
============================================================ */

export async function createModelRoute(productModelId: string, nom: string) {
  const { authId } = await requireRole(["administrateur", "responsable_production"]);
  const name = nom.trim();
  if (!name) return { error: "Donnez un nom au parcours." };
  const supabase = await createClient();
  const { count } = await supabase.from("model_routes").select("id", { count: "exact", head: true }).eq("product_model_id", productModelId);
  const { error } = await supabase
    .from("model_routes")
    .insert({ product_model_id: productModelId, nom: name, par_defaut: (count ?? 0) === 0, created_by: authId });
  if (error) return { error: error.code === "23505" ? "Un parcours porte déjà ce nom." : error.message };
  revalidateArticles();
  return {};
}

export async function deleteModelRoute(routeId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("model_routes").delete().eq("id", routeId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

export async function setDefaultModelRoute(productModelId: string, routeId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error: resetError } = await supabase
    .from("model_routes")
    .update({ par_defaut: false })
    .eq("product_model_id", productModelId)
    .neq("id", routeId);
  if (resetError) return { error: resetError.message };
  const { error } = await supabase.from("model_routes").update({ par_defaut: true }).eq("id", routeId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}

const stepSchema = z.object({
  etape: z.number().int().min(1).max(30),
  sectionId: z.string().uuid().nullable(),
  categorie: z.string().nullable(),
  mode: z.enum(["quantite", "partie"]),
  partie: z.string().trim().max(80).nullable(),
});

/** Ajoute une étape (section précise ou catégorie) ; le parcours est contrôlé ensuite. */
export async function addModelRouteStep(routeId: string, input: z.infer<typeof stepSchema>) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = stepSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const s = parsed.data;
  if (!s.sectionId === !s.categorie) return { error: "Choisissez une section ou une catégorie d'atelier." };
  if (s.mode === "partie" && !s.partie) return { error: "Indiquez la partie de la pièce confiée à cette section." };
  const supabase = await createClient();
  const { data: last } = await supabase.from("model_route_steps").select("ordre").eq("route_id", routeId).order("ordre", { ascending: false }).limit(1);
  const { data: step, error } = await supabase
    .from("model_route_steps")
    .insert({
      route_id: routeId,
      etape: s.etape,
      ordre: (last?.[0]?.ordre ?? 0) + 1,
      section_id: s.sectionId,
      atelier_category: s.categorie,
      mode_parallelisme: s.mode,
      partie: s.mode === "partie" ? s.partie : null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message.includes("pas_de_finition") ? "La Finition est imposée en dernier : inutile de l'ajouter." : error.message };
  const { error: checkError } = await supabase.rpc("check_model_route", { p_route_id: routeId });
  if (checkError) {
    await supabase.from("model_route_steps").delete().eq("id", step.id);
    return { error: checkError.message };
  }
  revalidateArticles();
  return {};
}

export async function removeModelRouteStep(stepId: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("model_route_steps").delete().eq("id", stepId);
  if (error) return { error: error.message };
  revalidateArticles();
  return {};
}
