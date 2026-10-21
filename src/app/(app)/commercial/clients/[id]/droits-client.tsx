"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { DROITS_CLIENT } from "@/lib/clients/droits";
import { definirDroitClient } from "../actions";

export type CompteDroits = { id: string; label: string; actif: boolean };
export type RetraitDroit = { droit: string; user_id: string | null };

/**
 * Droits de l'espace client (www.seritex.ci/espace-client) : tout est permis par défaut.
 * Décocher « Société » retire le droit à tous les comptes ; décocher un compte ne restreint que lui.
 * Un compte n'a jamais plus que sa société : si la société n'a pas le droit, la case du compte est grisée.
 */
export function DroitsClient({
  companyId,
  comptes,
  retraits,
  editable,
}: {
  companyId: string;
  comptes: CompteDroits[];
  retraits: RetraitDroit[];
  editable: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const societeRetire = (droit: string) => retraits.some((r) => r.droit === droit && r.user_id === null);
  const compteRetire = (droit: string, userId: string) => retraits.some((r) => r.droit === droit && r.user_id === userId);

  function regler(droit: string, autorise: boolean, userId: string | null) {
    startTransition(async () => {
      const res = await definirDroitClient(companyId, droit, autorise, userId);
      if (res.error) toast.error("Réglage impossible", { description: res.error });
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-foreground-muted">
              <th className="py-2 pr-3 font-medium">Droit</th>
              <th className="px-3 py-2 text-center font-medium">Société</th>
              {comptes.map((c) => (
                <th key={c.id} className="px-3 py-2 text-center font-medium" title={c.actif ? undefined : "Compte désactivé"}>
                  <span className="block max-w-[10rem] truncate">{c.label}</span>
                  {!c.actif && <span className="text-[10px] font-normal">(désactivé)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {DROITS_CLIENT.map((d) => {
              const retireSociete = societeRetire(d.key);
              return (
                <tr key={d.key}>
                  <td className="py-2 pr-3">
                    <span className="font-medium text-foreground">{d.label}</span>
                    <span className="block text-xs text-foreground-muted">{d.description}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!retireSociete}
                      disabled={!editable || pending}
                      onChange={(e) => regler(d.key, e.target.checked, null)}
                      aria-label={`${d.label} — toute la société`}
                      className="h-4 w-4 accent-[var(--brand,#0f766e)]"
                    />
                  </td>
                  {comptes.map((c) => {
                    const retire = compteRetire(d.key, c.id);
                    return (
                      <td key={c.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={!retireSociete && !retire}
                          disabled={!editable || pending || retireSociete}
                          onChange={(e) => regler(d.key, e.target.checked, c.id)}
                          aria-label={`${d.label} — ${c.label}`}
                          title={retireSociete ? "Retiré à toute la société" : undefined}
                          className="h-4 w-4 accent-[var(--brand,#0f766e)] disabled:opacity-40"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">
        Tout est activé par défaut. Un droit retiré l&apos;est aussi pour l&apos;API, pas seulement à l&apos;écran ; il prend effet
        à la prochaine page ouverte par le client.
        {comptes.length === 0 && " Aucun compte du site n'est encore rattaché à cette société : le réglage s'appliquera à ses futurs comptes."}
      </p>
    </div>
  );
}
