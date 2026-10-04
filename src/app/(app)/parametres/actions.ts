"use server";

import { createClient } from "@/lib/supabase/server";
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
