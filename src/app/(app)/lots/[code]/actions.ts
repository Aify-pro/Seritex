"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

type Result = { error: string } | { code: string };

/** Découpe un lot (SF-5) : le sous-lot prend la composition donnée, le lot d'origine garde le reste. */
export async function splitArticleLot(code: string, composition: Record<string, number>): Promise<Result> {
  await requirePermission("ordres_travail", "modify");
  const parsed = z.record(z.string().min(1), z.number().int().positive()).safeParse(composition);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return { error: "Composition du sous-lot invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("split_article_lot", { p_lot_code: code, p_composition: parsed.data }).single();
  if (error) return { error: error.message };
  revalidatePath(`/lots/${code}`);
  return { code: (data as { code: string }).code };
}

/** Regroupe ce lot avec d'autres (même article, même catégorie) dans un nouveau lot. */
export async function mergeArticleLots(codes: string[]): Promise<Result> {
  await requirePermission("ordres_travail", "modify");
  const clean = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (clean.length < 2) return { error: "Au moins deux lots à regrouper" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("merge_article_lots", { p_lot_codes: clean }).single();
  if (error) return { error: error.message };
  for (const c of clean) revalidatePath(`/lots/${c}`);
  return { code: (data as { code: string }).code };
}
