import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";

/** Ancienne fiche matière première : chaque textile a désormais sa fiche article (migration 0093). */
export default async function TextileRedirect({ params }: { params: Promise<{ id: string }> }) {
  await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("textiles").select("product_model_id").eq("id", id).maybeSingle();
  if (!data?.product_model_id) notFound();
  redirect(`/articles/${data.product_model_id}/general`);
}
