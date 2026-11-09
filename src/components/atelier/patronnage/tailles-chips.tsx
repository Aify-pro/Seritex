import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { TailleSemiFini } from "@/lib/patronnage/tailles-semi-finis";

/**
 * Tailles d'un semi-fini, par groupe (Homme, Femme…), chacune marquée déposée
 * ou manquante (un patron par taille, Homme et Femme distincts). Le rendu
 * d'une taille manquante est laissé à l'appelant : bouton ou lien de dépôt.
 */
export function TaillesChips({ tailles, manquante }: { tailles: TailleSemiFini[]; manquante: (t: TailleSemiFini) => ReactNode }) {
  const groupes = [...new Set(tailles.map((t) => t.groupe))];
  return (
    <div className="space-y-1.5">
      {groupes.map((g) => (
        <div key={g} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 text-xs text-foreground-muted">{g}</span>
          {tailles
            .filter((t) => t.groupe === g)
            .map((t) =>
              t.depose ? (
                <span key={t.cle} className="inline-flex min-h-7 items-center gap-1 rounded-md bg-success-soft px-2 text-xs font-medium text-success">
                  <Check className="h-3 w-3" /> {t.libelle}
                </span>
              ) : (
                <span key={t.cle}>{manquante(t)}</span>
              )
            )}
        </div>
      ))}
    </div>
  );
}
