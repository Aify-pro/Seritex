"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { error?: string };
const MAX_IMAGE = 10 * 1024 * 1024;

function done(modelId: string) {
  revalidatePath(`/articles/${modelId}/medias`);
  revalidatePath("/articles");
}

/**
 * Photo d'un modèle (ART-F) : le droit est vérifié par la base
 * (record_product_model_media) ; le fichier va dans le bucket privé
 * « articles », retiré si la base refuse.
 */
export async function uploadModelMedia(modelId: string, formData: FormData): Promise<Result> {
  await requireArticles();
  const file = formData.get("image");
  const colorId = String(formData.get("color_id") ?? "") || null;
  if (!(file instanceof File) || file.size === 0) return { error: "Choisissez une image." };
  if (file.size > MAX_IMAGE) return { error: "Image trop lourde (10 Mo au plus)." };
  if (!file.type.startsWith("image/")) return { error: "Le fichier doit être une image." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `modeles/${modelId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storage = createAdminClient().storage.from("articles");
  const { error } = await storage.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { error: `Image non enregistrée : ${error.message}` };

  const supabase = await createClient();
  const { error: recordError } = await supabase.rpc("record_product_model_media", {
    p_model_id: modelId,
    p_path: path,
    p_file_name: file.name,
    p_mime: file.type,
    p_color_id: colorId,
  });
  if (recordError) {
    await storage.remove([path]);
    return { error: recordError.message };
  }
  done(modelId);
  return {};
}

export async function setMediaPrincipale(modelId: string, mediaId: string): Promise<Result> {
  await requireArticles();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_model_media_principale", { p_media_id: mediaId });
  if (error) return { error: error.message };
  done(modelId);
  return {};
}

export async function reorderMedia(modelId: string, mediaIds: string[]): Promise<Result> {
  await requireArticles();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_product_model_media", { p_model_id: modelId, p_media_ids: mediaIds });
  if (error) return { error: error.message };
  done(modelId);
  return {};
}

export async function deleteMedia(modelId: string, mediaId: string): Promise<Result> {
  await requireArticles();
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_product_model_media", { p_media_id: mediaId });
  if (error) return { error: error.message };
  if (typeof path === "string") await createAdminClient().storage.from("articles").remove([path]);
  done(modelId);
  return {};
}

const eshopSchema = z.object({
  texte_commercial: z.string().trim().max(4000).transform((v) => v || null),
  publiable_eshop: z.boolean(),
});

export async function saveEshop(modelId: string, input: z.input<typeof eshopSchema>): Promise<Result> {
  const { canModify } = await requireArticles();
  if (!canModify) return { error: "Modification des articles non autorisée." };
  const parsed = eshopSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("product_models").update(parsed.data).eq("id", modelId);
  if (error) return { error: error.message };
  done(modelId);
  return {};
}
