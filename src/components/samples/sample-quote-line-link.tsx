"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Link2, Lock, Unlink } from "lucide-react";
import { linkSampleToQuoteLine } from "@/lib/actions/samples";
import type { SampleQuoteLineOption } from "@/lib/samples";

/**
 * Lien facultatif échantillon ↔ ligne d'article d'un devis de sa demande
 * (migration 0051). Modifiable tant que la ligne n'est pas passée en ODF ;
 * ensuite verrouillé : l'échantillon suit l'article d'ODF issu de la ligne
 * et sert de point de repère à la production.
 */
export function SampleQuoteLineLink({
  sampleId,
  currentQuoteLineId,
  quoteLines,
  canEdit,
}: {
  sampleId: string;
  currentQuoteLineId: string | null;
  /** Lignes des devis de la demande de la fiche. */
  quoteLines: SampleQuoteLineOption[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const current = quoteLines.find((l) => l.id === currentQuoteLineId);
  const locked = !!current?.orderLine;

  function handleChange(value: string) {
    startTransition(async () => {
      const res = await linkSampleToQuoteLine(sampleId, value || null);
      if (res?.error) toast.error(res.error);
      else toast.success(value ? "Échantillon lié à la ligne de devis" : "Lien retiré");
    });
  }

  const label = current ? `${current.quoteReference} — ${current.description}` : "aucune";

  if (!canEdit || locked) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
        {locked ? <Lock className="h-3.5 w-3.5" /> : currentQuoteLineId ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
        Ligne de devis : <span className="text-foreground">{label}</span>
        {locked && <span>(verrouillée — passée en {current.orderLine!.orderReference})</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1 font-medium text-foreground-muted">
        {currentQuoteLineId ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
        Ligne de devis :
      </span>
      <select
        disabled={pending || quoteLines.length === 0}
        value={currentQuoteLineId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        className="h-7 max-w-full rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
      >
        <option value="">{quoteLines.length === 0 ? "Aucun devis sur la demande" : "— Aucun lien —"}</option>
        {quoteLines.map((l) => (
          <option key={l.id} value={l.id}>
            {l.quoteReference} — {l.description}
            {l.orderLine ? ` · ${l.orderLine.orderReference} (verrouille le lien)` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
