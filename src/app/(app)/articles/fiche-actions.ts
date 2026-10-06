"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";
import { ARTICLE_NATURES, TYPES_APPRO, UNITES } from "@/lib/articles/natures";

/**
 * Fiche article unique (migration 0093) : création de tout article — produit
 * fini, matière première, consommable — depuis la même fiche, et son
 * classement. Les données techniques des matières premières (textiles) et
 * des consommables restent dans leurs tables, reliées à l'article.
 */

type Result = { error?: string; id?: string };

const optionalId = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(z.guid().nullable());
const optionalNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (v === "" || v === null ? null : Number(String(v).replace(",", "."))))
  .pipe(z.number().positive("Valeur invalide").nullable());

const classementSchema = z.object({
  type_appro: z.enum(TYPES_APPRO),
  famille_id: optionalId,
  sous_famille_id: optionalId,
  unite: z.enum(UNITES),
});

const createSchema = classementSchema.extend({
  nature: z.enum(ARTICLE_NATURES),
  name: z.string().trim().min(1, "Le nom est obligatoire").max(120),
  // Produit fini
  categorie_id: optionalId,
  matiere_id: optionalId,
  // Matière première (textile)
  composition: z.string().trim().max(200).optional().default(""),
  grammage: optionalNumber.optional().default(null),
  // Consommable
  consumable_family_id: optionalId.optional().default(null),
  etape: z.enum(["production", "finition"]).optional().default("production"),
  sage_reference: z.string().trim().max(18, "18 caractères au plus pour Sage").optional().default(""),
});

async function assertCanModify() {
  const { canModify } = await requireArticles();
  if (!canModify) throw new Error("Modification des articles non autorisée.");
}

export async function createArticle(input: z.input<typeof createSchema>): Promise<Result> {
  try {
    await assertCanModify();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const d = parsed.data;
  if (d.nature === "consommable" && !d.consumable_family_id) return { error: "Choisissez le préfixe du code (famille de consommable)." };

  const supabase = await createClient();
  const { data: model, error } = await supabase
    .from("product_models")
    .insert({
      name: d.name,
      nature: d.nature,
      type_appro: d.type_appro,
      famille_id: d.famille_id,
      sous_famille_id: d.sous_famille_id,
      unite: d.unite,
      categorie_id: d.nature === "pf" ? d.categorie_id : null,
      matiere_id: d.nature === "pf" ? d.matiere_id : null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Fiche technique de l'article, reliée ; en cas de refus, l'article est retiré.
  let techError: string | null = null;
  if (d.nature === "mp") {
    const { error: e } = await supabase.from("textiles").insert({
      nom: d.name,
      composition: d.composition || null,
      grammage: d.grammage,
      matiere_id: d.matiere_id,
      product_model_id: model.id,
    });
    if (e) techError = e.code === "23505" ? `Une matière « ${d.name} » existe déjà.` : e.message;
  } else if (d.nature === "consommable") {
    const { error: e } = await supabase.from("consumables").insert({
      designation: d.name,
      famille_id: d.consumable_family_id,
      unite: d.unite,
      etape: d.etape,
      sage_reference: d.sage_reference || null,
      product_model_id: model.id,
    });
    if (e) techError = e.message;
  }
  if (techError) {
    await supabase.from("product_models").delete().eq("id", model.id);
    return { error: techError };
  }

  revalidatePath("/articles", "layout");
  return { id: model.id as string };
}

/** Type d'approvisionnement, famille, sous-famille et unité d'un article. */
export async function setArticleClassement(productModelId: string, input: z.input<typeof classementSchema>): Promise<Result> {
  try {
    await assertCanModify();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = classementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("product_models").update(parsed.data).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}

const textileSchema = z.object({
  composition: z.string().trim().max(200),
  grammage: optionalNumber,
  matiere_id: optionalId,
});

/** Caractéristiques techniques d'une matière première (le nom se change dans l'identité de l'article). */
export async function updateTextileTechnique(textileId: string, input: z.input<typeof textileSchema>): Promise<Result> {
  try {
    await assertCanModify();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = textileSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("textiles")
    .update({ ...parsed.data, composition: parsed.data.composition || null })
    .eq("id", textileId);
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}

const consumableSchema = z.object({
  etape: z.enum(["production", "finition"]),
  sage_reference: z.string().trim().max(18, "18 caractères au plus pour Sage"),
});

/** Étape de consommation et référence Sage d'un consommable. */
export async function updateConsumableTechnique(consumableId: string, input: z.input<typeof consumableSchema>): Promise<Result> {
  try {
    await assertCanModify();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const parsed = consumableSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("consumables")
    .update({ etape: parsed.data.etape, sage_reference: parsed.data.sage_reference || null })
    .eq("id", consumableId);
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}
