"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { nouveauJeton } from "@/lib/agents/jetons";

/**
 * Agents IA (0187) : création (le jeton n'est montré qu'une fois) et
 * révocation (définitive). Réservé à l'administrateur de la plateforme.
 */

const creationSchema = z
  .object({
    nom: z.string().trim().min(2, "Nom trop court.").max(80),
    description: z.string().trim().max(500).optional(),
    droits: z.array(z.enum(["lecture", "calcul"])).min(1, "Choisissez au moins un droit."),
    proprietaire: z.string().uuid("Choisissez le propriétaire de l'agent."),
  })
  .strict();

export async function creerAgent(input: z.input<typeof creationSchema>): Promise<{ jeton: string } | { error: string }> {
  const { authId } = await requirePlatformAdmin();
  const p = creationSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message ?? "Saisie invalide." };
  const { jeton, empreinte, prefixe } = nouveauJeton();
  const supabase = await createClient();
  const { error } = await supabase.from("agents_ia").insert({
    nom: p.data.nom,
    description: p.data.description || null,
    droits: [...new Set(p.data.droits)],
    proprietaire: p.data.proprietaire,
    empreinte_jeton: empreinte,
    prefixe_jeton: prefixe,
    cree_par: authId,
  });
  if (error) return { error: error.code === "23505" ? "Un agent actif porte déjà ce nom." : error.message };
  await supabase.from("audit_log").insert({ user_id: authId, action: "creation_agent_ia", entity_type: "agent_ia", metadata: { nom: p.data.nom, droits: p.data.droits } });
  revalidatePath("/parametres/agents-ia");
  return { jeton };
}

export async function revoquerAgent(id: string): Promise<{ error?: string }> {
  const { authId } = await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents_ia")
    .update({ actif: false, revoque_le: new Date().toISOString(), revoque_par: authId })
    .eq("id", id)
    .is("revoque_le", null)
    .select("nom");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Agent introuvable ou déjà révoqué." };
  await supabase.from("audit_log").insert({ user_id: authId, action: "revocation_agent_ia", entity_type: "agent_ia", entity_id: id, metadata: { nom: data[0].nom } });
  revalidatePath("/parametres/agents-ia");
  return {};
}
