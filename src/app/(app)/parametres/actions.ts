"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newSectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  categorie_id: z.string().uuid().optional(),
});

export async function createSection(formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = newSectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    categorie_id: formData.get("categorie_id") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: max } = await supabase
    .from("sections")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .single();

  const { error } = await supabase.from("sections").insert({
    name: parsed.data.name,
    description: parsed.data.description || null,
    categorie_id: parsed.data.categorie_id || null,
    display_order: (max?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

export async function toggleSectionActive(sectionId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sections").update({ active }).eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

const updateSectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

/** Modifie le nom/la description d'une section existante (créée via createSection ci-dessus). */
export async function updateSectionDetails(sectionId: string, formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = updateSectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sections")
    .update({ name: parsed.data.name, description: parsed.data.description || null })
    .eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

// Catégories d'atelier (migration 0036) : Coupe/Impression/Couture, fixes,
// créées par la migration — pas de création libre depuis l'UI (décision
// produit : une nouvelle catégorie se fait par migration, pas en
// libre-service). Ce qui reste administrable ici, c'est le rattachement
// d'une section (nom, description, catégorie) à l'une de ces catégories,
// via createSection à la création ou setSectionCategory ensuite.

/** Réaffecte la catégorie d'atelier d'une section existante (ou la détache avec `null`). */
export async function setSectionCategory(sectionId: string, categorieId: string | null) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sections").update({ categorie_id: categorieId }).eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

// ============================================================================
// Lot 9 — configurateur couleur par zone : palette de couleurs et modèles de
// produit / gabarit de zones (section 8/9 du document de logique).
// ============================================================================

const newColorSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});

/** Palette de couleurs de référence (section 9) — réservée à responsable_production/administrateur. */
export async function createColor(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newColorSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("colors").insert({
    name: parsed.data.name.trim(),
    code: parsed.data.code.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}

export async function toggleColorActive(colorId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("colors").update({ active }).eq("id", colorId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}

// ============================================================================
// Référentiel de tailles (migration 0029)
// ============================================================================

const newSizeSchema = z.object({
  groupe: z.string().trim().min(1, "Indiquez un groupe (Homme, Femme, Enfant…)"),
  libelle: z.string().trim().min(1, "Indiquez un libellé de taille"),
  display_order: z.coerce.number().int().min(0).default(0),
});

/**
 * Ajoute une taille au référentiel. `cle` est générée en base (« Groupe/
 * Libellé ») : c'est elle que stockent les ODF et les répartitions du
 * patronnage, jamais le libellé seul — un « M » homme et un « M » femme sont
 * deux tailles distinctes.
 *
 * `display_order` est demandé explicitement parce qu'une grille de tailles ne
 * s'ordonne ni alphabétiquement ni numériquement : XS < S < M < L < XL.
 */
export async function createSize(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newSizeSchema.safeParse({
    groupe: formData.get("groupe"),
    libelle: formData.get("libelle"),
    display_order: formData.get("display_order") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("sizes").insert({
    groupe: parsed.data.groupe,
    libelle: parsed.data.libelle,
    display_order: parsed.data.display_order,
  });
  if (error) {
    if (error.code === "23505") return { error: `La taille « ${parsed.data.groupe}/${parsed.data.libelle} » existe déjà.` };
    return { error: error.message };
  }

  revalidatePath("/parametres/couleurs");
  return {};
}

export async function toggleSizeActive(sizeId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sizes").update({ active }).eq("id", sizeId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
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

  revalidatePath("/parametres/produits");
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

  revalidatePath("/parametres/produits");
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
  revalidatePath("/parametres/produits");
  return {};
}

export async function toggleProductModelActive(productModelId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_models").update({ active }).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
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
  revalidatePath("/parametres/produits");
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
  revalidatePath("/parametres/produits");
  return {};
}

/** Retire une zone du gabarit — réservé à l'administrateur (cohérent avec product_zone_templates_delete). */
export async function removeProductZoneTemplate(zoneTemplateId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_zone_templates").delete().eq("id", zoneTemplateId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
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
  revalidatePath("/parametres/produits");
  return {};
}

/** Retire une zone imprimable — réservé à l'administrateur (cohérent avec product_printable_zones_delete). */
export async function removeProductPrintableZone(zoneId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_printable_zones").delete().eq("id", zoneId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
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
  revalidatePath("/parametres/produits");
  return {};
}

/** Retire une ligne de nomenclature — réservé à l'administrateur (cohérent avec nomenclature_lines_delete). */
export async function removeNomenclatureLine(lineId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("nomenclature_lines").delete().eq("id", lineId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

/**
 * Simule un cycle de synchronisation du miroir de stock Sage (section 7.1b).
 * En production, ce serait un job planifié utilisant un compte technique
 * Sage à droits lecture seule — jamais déclenché depuis une session
 * utilisateur normale. Conservé ici en lecture/démo uniquement, réservé à
 * l'administrateur, pour illustrer le mécanisme sans connecter un vrai Sage.
 */
export async function simulateStockSync() {
  await requireRole(["administrateur"]);
  // stock_item_view n'a volontairement AUCUNE policy d'écriture pour les
  // rôles applicatifs (cf. 0002_rls.sql) : seul un job technique via
  // service_role peut y écrire, jamais une session utilisateur normale même
  // administrateur. On utilise donc le client admin ici, uniquement après
  // vérification du rôle ci-dessus, pour simuler ce job de synchronisation.
  const admin = createAdminClient();
  const { data: items } = await admin.from("stock_item_view").select("sage_reference,quantity_available");

  for (const item of items ?? []) {
    const delta = Math.round((Math.random() - 0.5) * 20 * 10) / 10;
    await admin
      .from("stock_item_view")
      .update({
        quantity_available: Math.max(0, item.quantity_available + delta),
        last_sync_at: new Date().toISOString(),
      })
      .eq("sage_reference", item.sage_reference);
  }
  revalidatePath("/parametres/stock");
  return {};
}
