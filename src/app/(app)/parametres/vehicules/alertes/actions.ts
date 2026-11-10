"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { ALERT_RULE_FIELDS } from "@/lib/vehicules/alert-rule-fields";

/** Paramètres > Logistique > Alertes (VEH-8) : une règle à la fois. */
export async function saveAlertRule(code: string, fd: FormData): Promise<{ error?: string }> {
  await requirePermission("parametres_vehicules", "modify");
  const fields = ALERT_RULE_FIELDS[code];
  if (!fields) return { error: "Règle inconnue." };
  const parametres: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = String(fd.get(f.key) ?? "").trim();
    if (f.kind === "jours") {
      parametres[f.key] = [1, 2, 3, 4, 5, 6, 7].filter((d) => fd.get(`${f.key}_${d}`) === "on");
      continue;
    }
    if (f.kind === "heure") {
      if (!/^\d{1,2}:\d{2}$/.test(raw)) return { error: `${f.label} : heure invalide (HH:MM).` };
      parametres[f.key] = raw.padStart(5, "0");
      continue;
    }
    if (!raw) {
      if (f.optional) {
        parametres[f.key] = null;
        continue;
      }
      return { error: `${f.label} : valeur manquante.` };
    }
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value) || (f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max)) {
      return { error: `${f.label} : valeur invalide.` };
    }
    parametres[f.key] = value;
  }
  const gravite = String(fd.get("gravite") ?? "attention");
  if (!["info", "attention", "critique"].includes(gravite)) return { error: "Gravité invalide." };
  const usages = ["livraison", "commercial", "direction", "service"].filter((u) => fd.get(`usage_${u}`) === "on");
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_alert_rules")
    .update({ actif: fd.get("actif") === "on", gravite, parametres, usages })
    .eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/parametres/vehicules/alertes");
  return {};
}
