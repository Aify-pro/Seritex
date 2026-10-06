"use server";

import { revalidatePath } from "next/cache";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";

/** Regroupe des grammages sous un seul article tissu (migration 0103), sur validation de l'utilisateur. */
export async function groupTextiles(nom: string, textileIds: string[], articleId: string | null): Promise<{ error?: string; id?: string }> {
  const { canModify } = await requireArticles();
  if (!canModify) return { error: "Modification des articles non autorisée." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("group_textiles", { p_nom: nom, p_textile_ids: textileIds, p_article_id: articleId });
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return { id: data as string };
}
