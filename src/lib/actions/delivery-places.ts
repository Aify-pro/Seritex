"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/current-user";

/**
 * Lieux de livraison d'un client (LIV-0). Écriture directe sous la RLS
 * (responsable livraison, commercial, administration — migration 0075) ;
 * position et lieu par défaut passent par des fonctions de la base.
 */
const placeSchema = z.object({
  libelle: z.string().trim().min(1, "Donnez un libellé au lieu").max(120),
  zone_id: z.string().uuid().nullable(),
  quartier: z.string().trim().max(120).nullable(),
  repere: z.string().trim().max(500).nullable(),
  contact_nom: z.string().trim().max(120).nullable(),
  contact_tel: z.string().trim().max(40).nullable(),
  horaires: z.string().trim().max(200).nullable(),
  consignes: z.string().trim().max(500).nullable(),
});

export type PlaceInput = z.infer<typeof placeSchema>;

function revalidate(companyId: string) {
  revalidatePath(`/commercial/clients/${companyId}`);
  revalidatePath("/livraisons", "layout");
}

export async function saveDeliveryPlace(
  companyId: string,
  placeId: string | null,
  input: PlaceInput
): Promise<{ error?: string; id?: string }> {
  const { authId } = await requireUser();
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const data = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]));
  const supabase = await createClient();

  if (placeId) {
    const { error } = await supabase.from("delivery_places").update(data).eq("id", placeId).eq("company_id", companyId);
    if (error) return { error: error.message };
    revalidate(companyId);
    return { id: placeId };
  }

  // Premier lieu actif du client : par défaut d'office.
  const { count } = await supabase
    .from("delivery_places")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("actif", true);
  const { data: row, error } = await supabase
    .from("delivery_places")
    .insert({ ...data, company_id: companyId, par_defaut: (count ?? 0) === 0, created_by: authId })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidate(companyId);
  return { id: row.id as string };
}

export async function setDefaultDeliveryPlace(companyId: string, placeId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_delivery_place", { p_place_id: placeId });
  if (error) return { error: error.message };
  revalidate(companyId);
  return {};
}

export async function setDeliveryPlaceActive(companyId: string, placeId: string, actif: boolean) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("delivery_places")
    .update({ actif, ...(actif ? {} : { par_defaut: false }) })
    .eq("id", placeId);
  if (error) return { error: error.message };
  revalidate(companyId);
  return {};
}

/** Position d'un lieu : épingle posée sur la carte, ou GPS pris sur place. */
export async function setDeliveryPlacePosition(
  placeId: string,
  latitude: number,
  longitude: number,
  source: "gps_terrain" | "carte" | "approximative",
  confirmee: boolean
) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_delivery_place_position", {
    p_place_id: placeId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_source: source,
    p_confirmee: confirmee,
  });
  if (error) return { error: error.message };
  revalidatePath("/commercial/clients", "layout");
  revalidatePath("/livreur");
  return {};
}

const MAX_PHOTO = 8 * 1024 * 1024;

/**
 * Photo du lieu (devanture, portail…) dans le bucket privé « livraisons ».
 * Le droit est vérifié par la base AVANT le dépôt : la mise à jour du lieu
 * sous la RLS de l'utilisateur doit toucher une ligne.
 */
export async function uploadDeliveryPlacePhoto(companyId: string, placeId: string, formData: FormData) {
  await requireUser();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Aucune photo sélectionnée." };
  if (file.size > MAX_PHOTO) return { error: "Photo trop lourde (8 Mo au plus)." };
  if (!file.type.startsWith("image/")) return { error: "Le fichier doit être une image." };

  const supabase = await createClient();
  const { data: allowed, error: checkError } = await supabase
    .from("delivery_places")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", placeId)
    .select("id");
  if (checkError) return { error: checkError.message };
  if (!allowed || allowed.length === 0) return { error: "Accès refusé à ce lieu." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `lieux/${placeId}/${Date.now()}.${ext}`;
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("livraisons")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) return { error: uploadError.message };

  const { error } = await supabase.from("delivery_places").update({ photo_path: path }).eq("id", placeId);
  if (error) return { error: error.message };
  revalidate(companyId);
  return {};
}
