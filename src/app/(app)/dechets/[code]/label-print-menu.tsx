"use client";

import { useState } from "react";
import { Printer, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Même plafond que la planche A4 (3 × 4) de `src/lib/pdf/waste-bag-label.ts`. */
const A4_MAX_COPIES = 12;

/**
 * Icône imprimante posée au-dessus du QR du sac : ouvre le choix du support
 * puis le PDF de l'étiquette dans un nouvel onglet, où le visualiseur du
 * navigateur (ou du téléphone) se charge de l'impression.
 *
 * De simples liens plutôt qu'un téléchargement piloté en JavaScript : le PDF
 * est servi par une route authentifiée par cookie, un lien suffit, et il
 * fonctionne aussi bien sur un poste d'atelier que sur un téléphone.
 */
export function LabelPrintMenu({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(A4_MAX_COPIES);
  const base = `/api/dechets/${encodeURIComponent(code)}/etiquette`;

  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Imprimer l'étiquette"
        title="Imprimer l'étiquette"
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-foreground hover:bg-surface-muted",
          open && "bg-surface-muted"
        )}
      >
        {open ? <X className="h-5 w-5" /> : <Printer className="h-5 w-5" />}
      </button>

      {open && (
        <div className="absolute top-12 z-20 w-64 space-y-2 rounded-md border border-border bg-surface p-3 text-sm shadow-lg">
          <a
            href={`${base}?format=thermique`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
            className="block rounded-md border border-border px-3 py-2.5 hover:bg-surface-muted"
          >
            <span className="block font-medium text-foreground">Imprimante thermique</span>
            <span className="block text-xs text-foreground-muted">1 étiquette · 52 × 60 mm</span>
          </a>

          <div className="rounded-md border border-border px-3 py-2.5">
            <span className="block font-medium text-foreground">Feuille A4</span>
            <label htmlFor={`copies-${code}`} className="mt-1 block text-xs text-foreground-muted">
              Nombre d&apos;étiquettes sur la planche
            </label>
            <div className="mt-1.5 flex gap-2">
              <select
                id={`copies-${code}`}
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value))}
                className="h-10 flex-1 rounded-md border border-border bg-surface px-2 text-base"
              >
                {Array.from({ length: A4_MAX_COPIES }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <a
                href={`${base}?format=a4&copies=${copies}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="inline-flex h-10 items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-foreground hover:bg-brand/90"
              >
                PDF
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
