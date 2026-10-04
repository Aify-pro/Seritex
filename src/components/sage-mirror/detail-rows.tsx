"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";

export interface DetailRow {
  id: string;
  /** Cellules du tableau, dans l'ordre des colonnes. */
  cells: ReactNode[];
  title: ReactNode;
  subtitle?: ReactNode;
  /** Tous les champs de la fiche, affichés dans la fenêtre. */
  fields: { label: string; value: ReactNode }[];
  /** Contenu libre sous les champs (ex. lignes d'un devis, stock par dépôt). */
  extra?: ReactNode;
}

/**
 * Lignes de tableau cliquables : un clic (ou Entrée) ouvre la fiche complète
 * de la ligne dans une fenêtre interne, sans quitter la liste. À placer dans
 * le `<tbody>` rendu par la page serveur.
 */
export function DetailRows({
  rows,
  cellClassNames,
  size = "md",
}: {
  rows: DetailRow[];
  cellClassNames: string[];
  size?: "sm" | "md" | "lg";
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = rows.find((r) => r.id === openId) ?? null;

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpenId(id);
    }
  }

  return (
    <>
      {rows.map((row) => (
        <tr
          key={row.id}
          tabIndex={0}
          onClick={() => setOpenId(row.id)}
          onKeyDown={(e) => onKey(e, row.id)}
          aria-label="Voir la fiche complète"
          className="cursor-pointer transition-colors hover:bg-surface-muted/40 focus-visible:bg-surface-muted/60 focus-visible:outline-none"
        >
          {row.cells.map((cell, i) => (
            <td key={i} className={cellClassNames[i] ?? "px-5 py-3"}>
              {cell}
            </td>
          ))}
        </tr>
      ))}
      <Dialog
        open={current !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        title={current?.title}
        description={current?.subtitle}
        size={size}
      >
        {current && (
          <div className="space-y-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {current.fields.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{f.label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-foreground">{f.value === null || f.value === undefined || f.value === "" ? "—" : f.value}</dd>
                </div>
              ))}
            </dl>
            {current.extra}
          </div>
        )}
      </Dialog>
    </>
  );
}
