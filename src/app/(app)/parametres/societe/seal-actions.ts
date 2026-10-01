"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const MAX_BYTES = 330_000; // ≈ 440 Ko en base64, sous le plafond de 450 000 caractères de la migration 0062
const MAX_SIDE = 2000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Valide un PNG téléversé et le renvoie en base64 — type, taille et dimensions contrôlés sur les octets, pas sur le nom. */
async function readPng(file: FormDataEntryValue | null, label: string): Promise<{ base64: string } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: `Choisissez l'image du ${label} (PNG)` };
  if (file.size > MAX_BYTES) return { error: `Image trop lourde (${Math.round(file.size / 1000)} Ko, maximum ${Math.round(MAX_BYTES / 1000)} Ko)` };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < 33 || !PNG_MAGIC.every((b, i) => buf[i] === b)) return { error: "Le fichier doit être une image PNG" };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE) return { error: `Dimensions maximales : ${MAX_SIDE} × ${MAX_SIDE} pixels` };
  return { base64: buf.toString("base64") };
}

// ── Cachet de la société ────────────────────────────────────────────────────

export async function setCompanyStamp(formData: FormData) {
  const current = await requirePlatformAdmin();
  const png = await readPng(formData.get("image"), "cachet");
  if ("error" in png) return { error: png.error };

  const supabase = await createClient();
  // Une seule ligne : on remplace plutôt que d'empiler.
  const { error: delError } = await supabase.from("company_stamp").delete().not("id", "is", null);
  if (delError) return { error: delError.message };
  const { error } = await supabase.from("company_stamp").insert({ image_png: png.base64, updated_by: current.profile.id });
  if (error) return { error: error.message };

  revalidatePath("/parametres/societe");
  return {};
}

export async function removeCompanyStamp() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("company_stamp").delete().not("id", "is", null);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

// ── Signatures (une par compte utilisateur) ─────────────────────────────────

const signatorySchema = z.object({
  // guid() et non uuid() : zod 4 exige les bits de version/variante RFC 9562, que
  // ne respectent pas les comptes de démonstration (44444444-…-4401) — la
  // vérification réelle est l'existence du compte, juste après.
  user_id: z.guid("Choisissez un compte utilisateur"),
  fonction: z.string().trim().max(120, "Fonction trop longue").transform((v) => v || null),
});

/** Crée ou met à jour la signature d'un compte. Sans nouvelle image, seule la fonction change. */
export async function saveSignatory(formData: FormData) {
  const current = await requirePlatformAdmin();
  const parsed = signatorySchema.safeParse({ user_id: formData.get("user_id"), fonction: formData.get("fonction") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: user } = await supabase.from("app_users").select("id,role,active").eq("id", parsed.data.user_id).maybeSingle();
  if (!user) return { error: "Compte introuvable" };
  // Signature = habilitation à valider les devis, réservée à la Direction et à
  // l'administrateur (base_role administrateur, migration 0064).
  if (user.role !== "administrateur") {
    return { error: "Une signature ne peut être affiliée qu'à un compte de la Direction ou administrateur" };
  }

  const hasFile = formData.get("image") instanceof File && (formData.get("image") as File).size > 0;
  const { data: existing } = await supabase.from("document_signatories").select("user_id").eq("user_id", user.id).maybeSingle();

  if (!hasFile) {
    if (!existing) return { error: "Choisissez l'image de la signature (PNG)" };
    const { error } = await supabase
      .from("document_signatories")
      .update({ fonction: parsed.data.fonction, updated_at: new Date().toISOString(), updated_by: current.profile.id })
      .eq("user_id", user.id);
    if (error) return { error: error.message };
  } else {
    const png = await readPng(formData.get("image"), "signature");
    if ("error" in png) return { error: png.error };
    const { error } = await supabase.from("document_signatories").upsert({
      user_id: user.id,
      fonction: parsed.data.fonction,
      signature_png: png.base64,
      active: true,
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/parametres/societe");
  return {};
}

export async function setSignatoryActive(userId: string, active: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("document_signatories")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}

export async function deleteSignatory(userId: string) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("document_signatories").delete().eq("user_id", userId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/societe");
  return {};
}
