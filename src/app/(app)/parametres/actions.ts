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

const FAMILLES = ["blanc", "clair", "moyen", "fonce"] as const;

const colorSchema = z.object({
  name: z.string().trim().min(1, "Indiquez le nom de la couleur"),
  code: z.string().trim().min(1, "Indiquez la référence Pantone TCX"),
  hex: z.union([z.literal(""), z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "L'aperçu doit être au format #RRGGBB")]),
  famille: z.union([z.literal(""), z.enum(FAMILLES)]),
});

function parseColorForm(formData: FormData) {
  return colorSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
    hex: formData.get("hex") ?? "",
    famille: formData.get("famille") ?? "",
  });
}

function colorFields(data: z.infer<typeof colorSchema>) {
  return {
    name: data.name,
    code: data.code,
    hex: data.hex ? data.hex.toUpperCase() : null,
    famille: data.famille || null,
  };
}

/**
 * Palette de couleurs de référence (section 9) — réservée à responsable_production/administrateur.
 * `code` = référence Pantone TCX ; `hex` = couleur d'aperçu (pastilles) ; `famille` = famille
 * du fournisseur (blanc/clair/moyen/foncé), dont dépend le prix du tissu.
 */
export async function createColor(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = parseColorForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("colors").insert(colorFields(parsed.data));
  if (error) {
    if (error.code === "23505") return { error: `La couleur « ${parsed.data.name} » existe déjà.` };
    return { error: error.message };
  }
  revalidatePath("/parametres/couleurs");
  return {};
}

export async function updateColor(colorId: string, formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = parseColorForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("colors").update(colorFields(parsed.data)).eq("id", colorId);
  if (error) {
    if (error.code === "23505") return { error: `La couleur « ${parsed.data.name} » existe déjà.` };
    return { error: error.message };
  }
  revalidatePath("/parametres/couleurs");
  return {};
}

/**
 * Supprime une couleur jamais utilisée (la fonction SQL refuse sinon : les
 * disponibilités par modèle seraient effacées en cascade). Administrateur
 * uniquement ; une couleur utilisée se désactive plutôt.
 */
export async function deleteColor(colorId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_color", { p_id: colorId });
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

const sizeEditSchema = newSizeSchema;

/**
 * Modifie une taille. Le groupe et le libellé forment la clé (« Groupe/Libellé »)
 * que stockent les ODF, les grilles de prix et le dispatching : tant que la
 * taille est référencée quelque part, seul l'ordre peut changer.
 */
export async function updateSize(sizeId: string, formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = sizeEditSchema.safeParse({
    groupe: formData.get("groupe"),
    libelle: formData.get("libelle"),
    display_order: formData.get("display_order") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: current } = await supabase.from("sizes").select("groupe,libelle").eq("id", sizeId).maybeSingle();
  if (!current) return { error: "Taille introuvable." };

  if (current.groupe !== parsed.data.groupe || current.libelle !== parsed.data.libelle) {
    const { data: usage, error: usageError } = await supabase.rpc("reference_usage", { p_table: "sizes", p_id: sizeId });
    if (usageError) return { error: usageError.message };
    if (usage && usage.length > 0) {
      return {
        error: `Cette taille est déjà utilisée (${usage.map((u: { ref_table: string; nb: number }) => `${u.ref_table} : ${u.nb}`).join(", ")}) : son groupe et son libellé ne peuvent plus changer. Seul l'ordre est modifiable ; sinon désactivez-la et créez-en une nouvelle.`,
      };
    }
  }

  const { error } = await supabase
    .from("sizes")
    .update({ groupe: parsed.data.groupe, libelle: parsed.data.libelle, display_order: parsed.data.display_order })
    .eq("id", sizeId);
  if (error) {
    if (error.code === "23505") return { error: `La taille « ${parsed.data.groupe}/${parsed.data.libelle} » existe déjà.` };
    return { error: error.message };
  }
  revalidatePath("/parametres/couleurs");
  return {};
}

/** Supprime une taille jamais utilisée (refus côté SQL sinon). Administrateur uniquement. */
export async function deleteSize(sizeId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_size", { p_id: sizeId });
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}
