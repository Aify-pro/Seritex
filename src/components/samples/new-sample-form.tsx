"use client";

import { useState, useTransition, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createSampleRequest } from "@/lib/actions/samples";
import { SAMPLE_PRIORITY_LABELS, type SamplePriority } from "@/lib/types/domain";
import type { SampleRequestOption, SampleQuoteLineOption } from "@/lib/samples";
import { Plus } from "lucide-react";

const PRIORITIES: SamplePriority[] = ["basse", "normale", "haute", "urgente"];

/**
 * Création d'une fiche échantillon (0051, revu 0094) : toujours rattachée à
 * une demande — choisie dans la liste depuis le module Échantillonnage, ou
 * imposée quand on crée depuis la fiche de demande ou depuis une ligne
 * d'article — et à une LIGNE D'ARTICLE dès que la demande porte un devis :
 * une proforma peut contenir plusieurs modèles, un échantillon ne concerne
 * jamais le devis entier. Sans devis encore établi, la fiche se crée sans
 * ligne et se rattache ensuite. Réservée au staff commercial.
 */
export function NewSampleForm({
  requests,
  fixedRequest,
  fixedQuoteLine,
  quoteLines,
  onCreated,
}: {
  /** Demandes proposées au rattachement (module Échantillonnage). Ignoré si `fixedRequest`. */
  requests?: SampleRequestOption[];
  /** Demande imposée (création depuis la fiche de demande). */
  fixedRequest?: Pick<SampleRequestOption, "id" | "reference" | "companyName">;
  /** Ligne d'article imposée (création depuis la ligne du devis ou l'article d'ODF). */
  fixedQuoteLine?: { id: string; label: string };
  /** Lignes des devis des demandes proposées — filtrées ici sur la demande choisie. */
  quoteLines: SampleQuoteLineOption[];
  /** Appelé après une création réussie — utilisé par `CreateSampleDialog` pour refermer la fenêtre. */
  onCreated?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [requestId, setRequestId] = useState(fixedRequest?.id ?? "");
  const requestQuoteLines = quoteLines.filter((l) => l.requestId === requestId);
  // Un devis existe sur la demande : la ligne devient obligatoire (0094).
  const lineRequired = requestQuoteLines.length > 0;

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await createSampleRequest(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success(`Fiche échantillon ${res.sampleNumber} créée`);
            formRef.current?.reset();
            if (!fixedRequest) setRequestId("");
            onCreated?.();
          }
        })
      }
      className="space-y-3"
    >
      {fixedRequest ? (
        <>
          <input type="hidden" name="request_id" value={fixedRequest.id} />
          <p className="text-xs text-foreground-muted">
            Demande <span className="font-medium text-foreground">{fixedRequest.reference}</span>
            {fixedRequest.companyName ? ` · ${fixedRequest.companyName}` : ""}
          </p>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Demande</label>
          <select
            name="request_id"
            required
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            <option value="">— Choisir la demande —</option>
            {requests?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.reference} · {r.companyName}
                {r.description ? ` — ${r.description.slice(0, 60)}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {fixedQuoteLine ? (
        <>
          <input type="hidden" name="quote_line_id" value={fixedQuoteLine.id} />
          <p className="text-xs text-foreground-muted">
            Article <span className="font-medium text-foreground">{fixedQuoteLine.label}</span>
          </p>
        </>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">
            Ligne d&apos;article {lineRequired ? "" : "(aucun devis sur cette demande)"}
          </label>
          <select
            name="quote_line_id"
            required={lineRequired}
            defaultValue=""
            key={requestId}
            disabled={!requestId || requestQuoteLines.length === 0}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
          >
            <option value="">
              {!requestId
                ? "— Choisir d'abord la demande —"
                : requestQuoteLines.length === 0
                  ? "Aucun devis : la fiche sera à rattacher plus tard"
                  : "— Choisir l'article concerné —"}
            </option>
            {requestQuoteLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.quoteReference} — {l.description}
                {l.orderLine ? ` · ${l.orderLine.orderReference}` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-foreground-muted">
            Un échantillon porte sur un article précis, jamais sur le devis entier. Une fois le devis passé en ODF, ce
            lien suit l&apos;article et n&apos;est plus modifiable.
          </p>
        </div>
      )}

      <textarea
        name="need_description"
        required
        rows={2}
        placeholder="Besoin exprimé (coloris, matière, visuel de référence...)"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      <textarea
        name="extra_info"
        rows={2}
        placeholder="Informations complémentaires (optionnel)"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Date de la demande</label>
          <input
            name="request_date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Priorité</label>
          <select name="priority" defaultValue="normale" className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {SAMPLE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Délai souhaité</label>
          <input name="due_date" type="date" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
        </div>
        <Button type="submit" size="sm" loading={pending}>
          <Plus className="h-3.5 w-3.5" /> Créer la fiche
        </Button>
      </div>
    </form>
  );
}
