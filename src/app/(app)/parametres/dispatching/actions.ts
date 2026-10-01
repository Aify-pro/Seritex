"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rulePctTotal } from "@/lib/dispatching";

const ruleSchema = z
  .object({
    id: z.guid().nullable(),
    groupe: z.string().trim().min(1),
    qty_min: z.number().int("Quantité minimale invalide").min(1, "La quantité minimale vaut au moins 1"),
    qty_max: z.number().int("Quantité maximale invalide").min(1).nullable(),
    pcts: z.record(z.string().min(1), z.number().min(0, "Pourcentage invalide").max(100, "Pourcentage invalide")),
  })
  .refine((r) => r.qty_max === null || r.qty_max >= r.qty_min, { message: "La quantité maximale doit être supérieure ou égale à la minimale" })
  .refine((r) => Object.keys(r.pcts).every((cle) => cle.startsWith(`${r.groupe}/`)), { message: "Une taille n'appartient pas à ce groupe" })
  .refine((r) => Math.abs(rulePctTotal(r.pcts) - 100) < 0.01, { message: "Les pourcentages d'un palier doivent totaliser 100 %" });

export type DispatchRuleInput = z.infer<typeof ruleSchema>;

/**
 * Enregistre un palier de la règle de dispatching (migration 0066) : bornes de
 * quantité et pourcentage par taille, total 100 %. Réservé à la Direction et à
 * l'administrateur (base_role administrateur — la RLS l'impose aussi).
 */
export async function saveDispatchRule(input: DispatchRuleInput) {
  await requireRole(["administrateur"]);
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Palier invalide" };
  const r = parsed.data;

  const supabase = await createClient();
  const fields = { groupe: r.groupe, qty_min: r.qty_min, qty_max: r.qty_max, updated_at: new Date().toISOString() };
  const { data: saved, error } = r.id
    ? await supabase.from("dispatch_rules").update(fields).eq("id", r.id).select("id").single()
    : await supabase.from("dispatch_rules").insert(fields).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: `Un palier « ${r.groupe} » commence déjà à ${r.qty_min} pièce(s)` };
    return { error: error.message };
  }

  const ruleId = saved.id as string;
  const { error: delError } = await supabase.from("dispatch_rule_sizes").delete().eq("rule_id", ruleId);
  if (delError) return { error: delError.message };
  const rows = Object.entries(r.pcts)
    .filter(([, pct]) => pct > 0)
    .map(([taille, pct]) => ({ rule_id: ruleId, taille, pct }));
  const { error: insError } = await supabase.from("dispatch_rule_sizes").insert(rows);
  if (insError) return { error: insError.message };

  revalidatePath("/parametres/dispatching");
  return { id: ruleId };
}

export async function deleteDispatchRule(id: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("dispatch_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/parametres/dispatching");
  return {};
}
