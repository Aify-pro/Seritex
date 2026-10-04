"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireArticles } from "@/lib/articles/access";
import { createClient } from "@/lib/supabase/server";

/**
 * Référentiel des consommables (COM-G, migration 0087). Code COFI0012
 * attribué par la base à la création, figé ensuite ; la RLS réserve
 * l'écriture à la production, au droit articles/modify et au gestionnaire de
 * stock.
 */
const UNITES = ["piece", "kg", "g", "m", "l"] as const;

const consumableSchema = z.object({
  designation: z.string().trim().min(1, "La désignation est obligatoire").max(120),
  famille_id: z.guid("Choisissez une famille"),
  unite: z.enum(UNITES),
  sage_reference: z
    .string()
    .trim()
    .max(18, "18 caractères au plus pour Sage")
    .transform((v) => v || null),
  nature: z.enum(["consommable", "mp"]),
  etape: z.enum(["production", "finition"]),
});

type Result = { error?: string };

export async function createConsumable(input: z.input<typeof consumableSchema>): Promise<Result> {
  await requireArticles();
  const parsed = consumableSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("consumables").insert(parsed.data);
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}

export async function updateConsumable(
  id: string,
  patch: Partial<z.input<typeof consumableSchema>> & { actif?: boolean }
): Promise<Result> {
  await requireArticles();
  const parsed = consumableSchema.partial().extend({ actif: z.boolean().optional() }).safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("consumables").update(parsed.data).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/articles", "layout");
  return {};
}
