"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";

/**
 * Référentiels de livraison (LIV-0) : zones et transporteurs (les véhicules
 * ont leur module, 0168).
 * Écriture selon les droits « Paramètres livraison » de la matrice — la RLS
 * (migration 0113) fait foi.
 */
const done = () => revalidatePath("/parametres/livraison");

const zoneSchema = z.object({
  nom: z.string().trim().min(1, "Nom de zone manquant").max(80),
  type: z.enum(["commune", "interieur", "international"]),
});

export async function createZone(formData: FormData) {
  await requirePermission("parametres_livraison", "create");
  const parsed = zoneSchema.safeParse({ nom: formData.get("nom"), type: formData.get("type") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data: last } = await supabase.from("delivery_zones").select("ordre").order("ordre", { ascending: false }).limit(1);
  const { error } = await supabase.from("delivery_zones").insert({ ...parsed.data, ordre: (last?.[0]?.ordre ?? 0) + 10 });
  if (error) return { error: error.code === "23505" ? "Cette zone existe déjà." : error.message };
  done();
  return {};
}

export async function setZoneActive(id: string, actif: boolean) {
  await requirePermission("parametres_livraison", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("delivery_zones").update({ actif }).eq("id", id);
  if (error) return { error: error.message };
  done();
  return {};
}

const carrierSchema = z.object({
  nom: z.string().trim().min(1, "Nom manquant").max(80),
  type: z.enum(["interne", "prestataire"]),
});

/** Transporteur en mode « manuel » (seul mode actif en version 1, L6). */
export async function createCarrier(formData: FormData) {
  await requirePermission("parametres_livraison", "create");
  const parsed = carrierSchema.safeParse({ nom: formData.get("nom"), type: formData.get("type") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("carriers").insert({ ...parsed.data, integration: "manuel" });
  if (error) return { error: error.code === "23505" ? "Ce transporteur existe déjà." : error.message };
  done();
  return {};
}

export async function setCarrierActive(id: string, actif: boolean) {
  await requirePermission("parametres_livraison", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("carriers").update({ actif }).eq("id", id);
  if (error) {
    return {
      error: error.message.includes("carriers_integration_v1")
        ? "Les connexions Yango et DHL ne seront actives qu'avec l'e-shop."
        : error.message,
    };
  }
  done();
  return {};
}
