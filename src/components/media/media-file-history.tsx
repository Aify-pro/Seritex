"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { MEDIA_SYNC_STATUS_LABELS, STORAGE_BACKEND_LABELS, type MediaSyncStatus, type StorageBackendType } from "@/lib/types/domain";

export interface HistoryEvent {
  id: string;
  event_type: "ajout" | "mise_a_jour" | "suppression";
  reason: string;
  occurred_at: string;
  author_name: string | null;
}

const EVENT_LABELS: Record<HistoryEvent["event_type"], string> = {
  ajout: "Ajout",
  mise_a_jour: "Mise à jour",
  suppression: "Suppression",
};

const SYNC_TONE: Record<MediaSyncStatus, string> = {
  en_attente: "bg-warning-soft text-warning",
  synchronise: "bg-success-soft text-success",
  erreur: "bg-danger-soft text-danger",
};

/** Journal documenté (raison de chaque ajout/mise à jour) + statut de réplication par cible (section 3.7). */
export function MediaFileHistory({
  events,
  copies,
}: {
  events: HistoryEvent[];
  copies: { targetName: string; targetType: StorageBackendType; status: MediaSyncStatus; errorMessage: string | null }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Historique et copies ({events.length})
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-md bg-surface-muted/50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {copies.map((c, i) => (
              <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SYNC_TONE[c.status]}`} title={c.errorMessage ?? undefined}>
                {STORAGE_BACKEND_LABELS[c.targetType]} ({c.targetName}) · {MEDIA_SYNC_STATUS_LABELS[c.status]}
              </span>
            ))}
            {copies.length === 0 && <span className="text-[11px] text-foreground-muted">Aucune copie enregistrée.</span>}
          </div>
          <ul className="space-y-1.5 border-t border-border pt-2">
            {events.map((e) => (
              <li key={e.id} className="text-xs text-foreground-muted">
                <span className="font-medium text-foreground">{EVENT_LABELS[e.event_type]}</span> le{" "}
                {formatDateTime(e.occurred_at)}
                {e.author_name ? ` par ${e.author_name}` : ""} — {e.reason}
              </li>
            ))}
            {events.length === 0 && <li className="text-xs text-foreground-muted">Aucun événement.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
