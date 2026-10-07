"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  suivi: z.boolean(),
  seuil_kg: z.number().min(0, "Le seuil ne peut pas être négatif").max(100000),
});

/**
 * Active ou coupe le suivi de disponibilité d'un grammage et règle son seuil
 * (en kg de rouleaux en stock par couleur). Le droit est aussi contrôlé par la
 * base : seuls les responsables de production modifient un tissu.
 */
export async function saveTextileAvailability(
  modelId: string,
  textileId: string,
  input: z.input<typeof schema>
): Promise<{ error?: string }> {
  const { canModify } = await requireArticles();
  if (!canModify) return { error: "Modification des articles non autorisée." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("textiles")
    .update({ suivi_disponibilite: parsed.data.suivi, seuil_disponibilite_kg: parsed.data.seuil_kg })
    .eq("id", textileId)
    .eq("product_model_id", modelId)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Modification refusée ou grammage introuvable." };

  revalidatePath(`/articles/${modelId}/stock`);
  revalidatePath("/articles");
  return {};
}
