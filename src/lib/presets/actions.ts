"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { canonicalParams } from "@/lib/filters/params";
import { PRESET_MODULES, PRESET_MODULE_KEYS, type PresetModule } from "./modules";

const moduleSchema = z.enum(PRESET_MODULE_KEYS as [PresetModule, ...PresetModule[]]);
const nameSchema = z.string().trim().min(1, "Donnez un nom au préréglage").max(40, "40 caractères au plus");
const paramsSchema = z.string().max(1000).transform((p) => canonicalParams(p));

function messageErreur(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Vous avez déjà un préréglage de ce nom";
  if (error.code === "42501") return "Droit insuffisant pour cette opération";
  return error.message;
}

async function verifierPartage(module: PresetModule, shared: boolean): Promise<string | null> {
  if (shared && !(await can(module, "modify"))) return "Seuls les utilisateurs pouvant modifier ce module peuvent partager un préréglage";
  return null;
}

/** Enregistre l'état courant de la liste (recherche, filtres, tri) comme préréglage. */
export async function creerPreset(input: { module: PresetModule; name: string; params: string; shared: boolean }) {
  await requireUser();
  const parsed = z.object({ module: moduleSchema, name: nameSchema, params: paramsSchema, shared: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Préréglage invalide" };
  const refus = await verifierPartage(parsed.data.module, parsed.data.shared);
  if (refus) return { error: refus };

  const supabase = await createClient();
  const { data: dernier } = await supabase
    .from("filter_presets")
    .select("position")
    .eq("module", parsed.data.module)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("filter_presets")
    .insert({ ...parsed.data, position: ((dernier?.position as number | undefined) ?? 0) + 1 });
  if (error) return { error: messageErreur(error) };
  revalidatePath(PRESET_MODULES[parsed.data.module].path);
  return {};
}

/** Renomme, partage ou remplace les critères d'un préréglage (tous champs facultatifs). */
export async function modifierPreset(input: {
  id: string;
  module: PresetModule;
  name?: string;
  params?: string;
  shared?: boolean;
}) {
  await requireUser();
  const parsed = z
    .object({
      id: z.string().uuid(),
      module: moduleSchema,
      name: nameSchema.optional(),
      params: paramsSchema.optional(),
      shared: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Préréglage invalide" };
  const { id, module, ...patch } = parsed.data;
  if (patch.shared !== undefined) {
    const refus = await verifierPartage(module, patch.shared);
    if (refus) return { error: refus };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("filter_presets")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return { error: messageErreur(error) };
  if (!data || data.length === 0) return { error: "Préréglage introuvable ou non modifiable" };
  revalidatePath(PRESET_MODULES[module].path);
  return {};
}

export async function supprimerPreset(id: string, module: PresetModule) {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success || !moduleSchema.safeParse(module).success) return { error: "Préréglage invalide" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("filter_presets").delete().eq("id", id).select("id");
  if (error) return { error: messageErreur(error) };
  if (!data || data.length === 0) return { error: "Préréglage introuvable ou non supprimable" };
  revalidatePath(PRESET_MODULES[module].path);
  return {};
}
