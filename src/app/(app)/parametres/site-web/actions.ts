"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  eshop: z.boolean(),
  personnaliser: z.boolean(),
  message: z.string().trim().max(400, "Message trop long (400 caractères maximum)"),
});

/**
 * Interrupteurs du site www.seritex.ci (migration 0110). La base vérifie
 * aussi le droit (set_site_settings) et journalise le changement.
 */
export async function saveSiteSettings(input: z.infer<typeof schema>) {
  await requireModule("site_web");
  if (!(await can("site_web", "modify"))) return { error: "Vous n'avez pas le droit de modifier les réglages du site." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Réglages invalides" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_site_settings", {
    p_eshop: parsed.data.eshop,
    p_personnaliser: parsed.data.personnaliser,
    p_message: parsed.data.message,
  });
  if (error) return { error: error.message };

  revalidatePath("/parametres/site-web");
  return {};
}
