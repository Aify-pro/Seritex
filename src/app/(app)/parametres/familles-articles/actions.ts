"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string };

const nomSchema = z.string().trim().min(1, "Donnez un nom").max(80);

function done() {
  revalidatePath("/parametres/familles-articles");
  revalidatePath("/articles", "layout");
}

/** Familles d'articles (migration 0093) : deux niveaux, famille puis sous-famille. */
export async function createFamily(nom: string, parentId: string | null): Promise<Result> {
  await requirePermission("articles", "modify");
  const parsed = nomSchema.safeParse(nom);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("article_families").insert({ nom: parsed.data, parent_id: parentId });
  if (error) return { error: error.code === "23505" ? `« ${parsed.data} » existe déjà à ce niveau.` : error.message };
  done();
  return {};
}

export async function renameFamily(id: string, nom: string): Promise<Result> {
  await requirePermission("articles", "modify");
  const parsed = nomSchema.safeParse(nom);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("article_families").update({ nom: parsed.data }).eq("id", id);
  if (error) return { error: error.code === "23505" ? `« ${parsed.data} » existe déjà à ce niveau.` : error.message };
  done();
  return {};
}

/** Une famille ne se supprime pas (articles rattachés) : elle se désactive. */
export async function setFamilyActive(id: string, actif: boolean): Promise<Result> {
  await requirePermission("articles", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("article_families").update({ actif }).eq("id", id);
  if (error) return { error: error.message };
  done();
  return {};
}
