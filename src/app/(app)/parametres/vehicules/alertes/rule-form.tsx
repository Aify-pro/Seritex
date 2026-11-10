"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ALERT_GRAVITE_LABELS, type AlertField } from "@/lib/vehicules/alert-rule-fields";
import { VEHICLE_USAGE_LABELS } from "@/lib/vehicules/labels";
import { saveAlertRule } from "./actions";

const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

export function RuleForm({
  rule,
  fields,
  canModify,
}: {
  rule: { code: string; libelle: string; description: string | null; actif: boolean; gravite: string; parametres: Record<string, unknown>; usages: string[] };
  fields: AlertField[];
  canModify: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      action={(fd) =>
        start(async () => {
          const r = await saveAlertRule(rule.code, fd);
          if (r.error) toast.error("Enregistrement refusé", { description: r.error });
          else {
            toast.success("Règle enregistrée");
            router.refresh();
          }
        })
      }
      className="space-y-3 px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="actif" defaultChecked={rule.actif} disabled={!canModify} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium">{rule.libelle}</span>
            {rule.description && <span className="block text-xs text-foreground-muted">{rule.description}</span>}
          </span>
        </label>
        <select name="gravite" defaultValue={rule.gravite} disabled={!canModify} className={input}>
          {Object.entries(ALERT_GRAVITE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <fieldset disabled={!canModify} className="flex flex-wrap items-end gap-4 pl-6">
        {fields.map((f) =>
          f.kind === "jours" ? (
            <div key={f.key}>
              <span className="mb-1 block text-[11px] font-medium text-foreground-muted">{f.label}</span>
              <div className="flex gap-2">
                {JOURS.map((j, i) => (
                  <label key={j} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      name={`${f.key}_${i + 1}`}
                      defaultChecked={(Array.isArray(rule.parametres[f.key]) ? (rule.parametres[f.key] as number[]) : []).includes(i + 1)}
                      className="h-3.5 w-3.5"
                    />
                    {j}
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <label key={f.key}>
              <span className="mb-1 block text-[11px] font-medium text-foreground-muted">{f.label}</span>
              <span className="flex items-center gap-1">
                <input
                  name={f.key}
                  type={f.kind === "heure" ? "time" : "text"}
                  inputMode={f.kind === "nombre" ? "decimal" : undefined}
                  defaultValue={rule.parametres[f.key] === null || rule.parametres[f.key] === undefined ? "" : String(rule.parametres[f.key])}
                  placeholder={f.kind === "nombre" && f.hint ? f.hint : undefined}
                  className={`${input} ${f.kind === "heure" ? "w-28" : "w-24"}`}
                />
                {f.kind === "nombre" && f.unit && <span className="text-xs text-foreground-muted">{f.unit}</span>}
              </span>
            </label>
          )
        )}
        <div>
          <span className="mb-1 block text-[11px] font-medium text-foreground-muted">Véhicules concernés (aucun coché = tous)</span>
          <div className="flex flex-wrap gap-3">
            {Object.entries(VEHICLE_USAGE_LABELS).map(([u, l]) => (
              <label key={u} className="flex items-center gap-1 text-xs">
                <input type="checkbox" name={`usage_${u}`} defaultChecked={rule.usages.includes(u)} className="h-3.5 w-3.5" />
                {l}
              </label>
            ))}
          </div>
        </div>
        {canModify && (
          <Button type="submit" size="sm" variant="secondary" loading={pending}>
            Enregistrer
          </Button>
        )}
      </fieldset>
    </form>
  );
}
