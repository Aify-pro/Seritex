"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TriangleAlert, CheckCircle2, Plus } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { reportAnomaly, resolveAnomaly } from "../actions";

export interface AnomalyRow {
  id: string;
  message: string;
  sectionName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
}

/**
 * Panneau "Anomalies" de la fiche ODF (lot 5, section 14 du document de
 * logique) — jamais bloquant : pure information, le triangle de la liste
 * (page.tsx) pointe ici. Signalement général (sans section précise)
 * réservé à responsable_production/administrateur, seuls rôles à accéder à
 * cet écran ; le signalement par section passe par /atelier/section.
 */
export function AnomaliesPanel({
  productionOrderId,
  anomalies,
  canResolve,
}: {
  productionOrderId: string;
  anomalies: AnomalyRow[];
  canResolve: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [showReport, setShowReport] = useState(false);
  const [message, setMessage] = useState("");

  const open = anomalies.filter((a) => !a.resolvedAt);
  const resolved = anomalies.filter((a) => a.resolvedAt);

  function submitReport() {
    if (!message.trim()) return;
    startTransition(async () => {
      const res = await reportAnomaly(productionOrderId, message.trim());
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success("Anomalie signalée");
        setMessage("");
        setShowReport(false);
      }
    });
  }

  function resolve(anomalyId: string) {
    startTransition(async () => {
      const res = await resolveAnomaly(anomalyId, productionOrderId);
      if (res.error) toast.error("Action refusée", { description: res.error });
      else toast.success("Anomalie résolue");
    });
  }

  if (anomalies.length === 0 && !canResolve) return null;

  return (
    <Card className={open.length > 0 ? "border-warning/30 bg-warning-soft/30" : undefined}>
      <CardHeader
        title="Anomalies"
        description="Jamais bloquant — pur repère informatif pour le suivi."
        action={
          canResolve &&
          !showReport && (
            <Button size="sm" variant="ghost" onClick={() => setShowReport(true)}>
              <Plus className="h-3.5 w-3.5" /> Signaler un incident
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {showReport && (
          <div className="space-y-2 rounded-md border border-border bg-surface p-3">
            <textarea
              autoFocus
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Décrire l'incident"
              className="w-full rounded-md border border-border bg-surface p-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex gap-1.5">
              <Button size="sm" loading={pending} disabled={!message.trim()} onClick={submitReport}>
                Envoyer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowReport(false)}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        {anomalies.length === 0 && !showReport && (
          <p className="text-sm text-foreground-muted">Aucune anomalie signalée.</p>
        )}

        {open.map((a) => (
          <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <div>
                <p className="text-sm text-foreground">{a.message}</p>
                <p className="text-xs text-foreground-muted">
                  {a.sectionName ? `${a.sectionName} · ` : ""}
                  {formatDateTime(a.createdAt)}
                </p>
              </div>
            </div>
            {canResolve && (
              <Button size="sm" variant="ghost" loading={pending} onClick={() => resolve(a.id)}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Résoudre
              </Button>
            )}
          </div>
        ))}

        {resolved.length > 0 && (
          <details className="text-xs text-foreground-muted">
            <summary className="cursor-pointer select-none">{resolved.length} anomalie(s) résolue(s)</summary>
            <div className="mt-2 space-y-1.5">
              {resolved.map((a) => (
                <p key={a.id}>
                  {a.message} — résolue le {formatDateTime(a.resolvedAt)} par {a.resolvedByName ?? "—"}
                </p>
              ))}
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
