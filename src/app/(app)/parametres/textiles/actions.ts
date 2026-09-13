"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newTextileSchema = z.object({
  nom: z.string().trim().min(1, "Donnez un nom au textile"),
  composition: z.string().trim().optional().nullable(),
  grammage: z.coerce.number().positive().optional().nullable(),
  laize_cm: z.coerce.number().positive().optional().nullable(),
});

/**
 * Crée un textile. Les trois caractéristiques facultatives — composition,
 * grammage, laize — sont celles que la fiche de placement redemande
 * aujourd'hui en saisie libre : les tenir ici permettra de les pré-remplir
 * quand les ordres de tracé seront générés automatiquement.
 */
export async function createTextile(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newTextileSchema.safeParse({
    nom: formData.get("nom"),
    composition: formData.get("composition") || null,
    grammage: formData.get("grammage") || null,
    laize_cm: formData.get("laize_cm") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("textiles").insert({
    nom: parsed.data.nom,
    composition: parsed.data.composition || null,
    grammage: parsed.data.grammage ?? null,
    laize_cm: parsed.data.laize_cm ?? null,
  });
  if (error) {
    if (error.code === "23505") return { error: `Le textile « ${parsed.data.nom} » existe déjà.` };
    return { error: error.message };
  }

  revalidatePath("/parametres/textiles");
  return {};
}

export async function toggleTextileActive(textileId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("textiles").update({ active }).eq("id", textileId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/textiles");
  return {};
}

/**
 * Rattache un article Sage à un textile, avec le coloris qu'il représente.
 * Un article n'appartient qu'à un seul textile — l'unicité est posée en base
 * (index sur `sage_reference`) : sans elle, le regroupement des ordres de
 * tracé deviendrait ambigu au premier doublon.
 */
export async function linkSageArticleToTextile(
  textileId: string,
  sageReference: string,
  colorId: string | null
) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error } = await supabase.from("textile_sage_articles").insert({
    textile_id: textileId,
    sage_reference: sageReference,
    color_id: colorId || null,
  });
  if (error) {
    if (error.code === "23505") {
      return { error: `L'article ${sageReference} est déjà rattaché à un textile.` };
    }
    return { error: error.message };
  }

  revalidatePath("/parametres/textiles");
  return {};
}

export async function unlinkSageArticle(textileId: string, sageReference: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("textile_sage_articles")
    .delete()
    .eq("textile_id", textileId)
    .eq("sage_reference", sageReference);
  if (error) return { error: error.message };
  revalidatePath("/parametres/textiles");
  return {};
}

/** Tissu principal d'un modèle de produit — détermine son ordre de tracé. */
export async function setProductModelTextile(productModelId: string, textileId: string | null) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_models")
    .update({ textile_id: textileId || null })
    .eq("id", productModelId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  revalidatePath("/parametres/textiles");
  return {};
}
