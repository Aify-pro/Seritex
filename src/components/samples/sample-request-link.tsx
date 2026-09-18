"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, FileText } from "lucide-react";
import { attachSampleToRequest } from "@/lib/actions/samples";
import type { SampleRequestOption } from "@/lib/samples";

/**
 * Demande de rattachement de la fiche (migration 0051). Obligatoire depuis
 * cette migration ; les fiches plus anciennes créées sans demande sont
 * signalées « à rattacher » et peuvent l'être une fois, ici.
 */
export function SampleRequestLink({
  sampleId,
  request,
  attachableRequests,
  canAttach,
  linkToRequest,
}: {
  sampleId: string;
  request: { id: string; reference: string } | null;
  /** Demandes de l'entreprise de la fiche, proposées si elle n'est pas encore rattachée. */
  attachableRequests: SampleRequestOption[];
  canAttach: boolean;
  /** Lien cliquable vers la fiche de demande (vue commerciale uniquement). */
  linkToRequest: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (request) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-foreground-muted">
        <FileText className="h-3.5 w-3.5" />
        Demande :{" "}
        {linkToRequest ? (
          <Link href={`/commercial/demandes/${request.id}`} className="font-medium text-foreground hover:text-brand hover:underline">
            {request.reference}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{request.reference}</span>
        )}
      </div>
    );
  }

  function attach(requestId: string) {
    if (!requestId) return;
    startTransition(async () => {
      const res = await attachSampleToRequest(sampleId, requestId);
      if (res?.error) toast.error(res.error);
      else toast.success("Fiche rattachée à la demande");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="flex items-center gap-1 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5" /> Demande : à rattacher
      </span>
      {canAttach && (
        <select
          disabled={pending || attachableRequests.length === 0}
          defaultValue=""
          onChange={(e) => attach(e.target.value)}
          className="h-7 rounded-md border border-border bg-surface px-2 text-xs disabled:opacity-60"
        >
          <option value="">{attachableRequests.length === 0 ? "Aucune demande pour ce client" : "— Choisir la demande —"}</option>
          {attachableRequests.map((r) => (
            <option key={r.id} value={r.id}>
              {r.reference}
              {r.description ? ` — ${r.description.slice(0, 50)}` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
