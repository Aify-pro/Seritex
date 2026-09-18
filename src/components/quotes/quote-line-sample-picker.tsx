"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { X } from "lucide-react";
import { linkSampleToQuoteLine } from "@/lib/actions/samples";
import { SAMPLE_STATUS_LABELS, type SampleRequestStatus } from "@/lib/types/domain";

export interface QuoteSample {
  id: string;
  sample_number: string;
  status: SampleRequestStatus;
  quote_line_id: string | null;
}

/**
 * Échantillon(s) liés à une ligne d'article du devis (migration 0051) —
 * pendant côté devis de SampleQuoteLineLink. Le lien est facultatif ; une
 * fois le devis accepté (ODF généré), il suit l'article d'ODF et ne se
 * retire plus : seul l'ajout reste proposé.
 */
export function QuoteLineSamplePicker({
  quoteLineId,
  samples,
  editable,
  locked,
}: {
  quoteLineId: string;
  /** Échantillons de la demande du devis. */
  samples: QuoteSample[];
  editable: boolean;
  /** Devis accepté : la ligne est passée en ODF, les liens existants sont figés. */
  locked: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const linked = samples.filter((s) => s.quote_line_id === quoteLineId);
  const selectable = samples.filter((s) => s.quote_line_id === null);

  function link(sampleId: string, lineId: string | null) {
    startTransition(async () => {
      const res = await linkSampleToQuoteLine(sampleId, lineId);
      if (res?.error) toast.error(res.error);
    });
  }

  if (!editable && linked.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-medium text-foreground-muted">Échantillon</p>
      {linked.length === 0 && <p className="text-xs text-foreground-muted">Aucun échantillon lié (facultatif).</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {linked.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs">
            <Link href={`/echantillons/${s.sample_number}`} className="font-mono text-foreground hover:text-brand">
              {s.sample_number}
            </Link>
            <span className="text-foreground-muted">· {SAMPLE_STATUS_LABELS[s.status]}</span>
            {editable && !locked && (
              <button
                disabled={pending}
                onClick={() => link(s.id, null)}
                aria-label="Retirer le lien"
                className="rounded p-0.5 text-foreground-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {editable && selectable.length > 0 && (
          <select
            disabled={pending}
            value=""
            onChange={(e) => e.target.value && link(e.target.value, quoteLineId)}
            className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
          >
            <option value="">+ Lier un échantillon de la demande</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sample_number} · {SAMPLE_STATUS_LABELS[s.status]}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
