"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";

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

  revalidatePath("/articles", "layout");
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
  revalidatePath("/articles", "layout");
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
  revalidatePath("/articles", "layout");
  return {};
}
