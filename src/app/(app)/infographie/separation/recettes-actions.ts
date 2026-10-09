"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { reglagesSchema, type Reglages } from "@/lib/separation/reglages";

/**
 * Recettes de réglages de la séparation (migration 0118) : enregistrer sous
 * un nom, supprimer. La RLS limite la création à qui a accès à la séparation,
 * la suppression à l'auteur ou à l'administrateur.
 */
export async function enregistrerRecette(nom: string, reglages: Reglages): Promise<{ error?: string; id?: string }> {
  await requireModule("demandes_graphiques");
  const parsed = z.object({ nom: z.string().trim().min(1, "Donnez un nom à la recette").max(80), reglages: reglagesSchema }).safeParse({ nom, reglages });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Réglages invalides" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("separation_recettes").insert(parsed.data).select("id").single();
  if (error) return { error: error.code === "23505" ? `La recette « ${parsed.data.nom} » existe déjà.` : error.message };
  revalidatePath("/infographie/separation");
  return { id: data.id as string };
}

export async function supprimerRecette(id: string): Promise<{ error?: string }> {
  await requireModule("demandes_graphiques");
  const supabase = await createClient();
  const { data, error } = await supabase.from("separation_recettes").delete().eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Seul l'auteur de la recette ou l'administrateur peut la supprimer." };
  revalidatePath("/infographie/separation");
  return {};
}
