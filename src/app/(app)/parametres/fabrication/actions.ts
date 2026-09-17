"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const tauxSchema = z.coerce.number().min(0, "Le taux ne peut pas être négatif").max(100, "Le taux ne peut pas dépasser 100%");

/** Met à jour le taux d'acceptation par défaut (fabrication_settings, ligne unique). */
export async function updateTauxAcceptationDefaut(id: string, formData: FormData) {
  const current = await requirePlatformAdmin();
  const parsed = tauxSchema.safeParse(formData.get("taux"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("fabrication_settings")
    .update({
      taux_acceptation_surplus_defaut: parsed.data,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/parametres/fabrication");
  return {};
}

/**
 * Taux spécifique d'une catégorie d'atelier — `null` (champ vidé) fait
 * retomber la catégorie sur le taux par défaut, comme n'importe quelle
 * catégorie qui n'a jamais eu de taux propre.
 */
export async function updateTauxCategorie(categorieId: string, formData: FormData) {
  await requirePlatformAdmin();
  const raw = formData.get("taux");
  const parsed = raw === null || raw === "" ? { success: true as const, data: null } : tauxSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("atelier_categories")
    .update({ taux_acceptation_surplus_trace: parsed.data })
    .eq("id", categorieId);
  if (error) return { error: error.message };

  revalidatePath("/parametres/fabrication");
  return {};
}
