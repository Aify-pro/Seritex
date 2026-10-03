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
  const { error } = await supabase
    .from("product_models")
    .update({ name: parsed.data.name, category: parsed.data.category || null })
    .eq("id", productModelId);
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
