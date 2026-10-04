"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { checkStorageTarget } from "@/lib/actions/media";
import type { ConnectionStatus } from "@/lib/storage/types";
import { formatDateTime } from "@/lib/utils";
import { TargetActions, type EditableTarget } from "./target-actions";
import { TargetActiveToggle } from "./target-active-toggle";

/**
 * Commandes d'une cible + son état de connexion. Le test (lecture seule) part à
 * l'affichage, cible par cible, pour qu'un NAS injoignable ne retarde ni la page
 * ni les autres cibles ; « Tester » lance un test approfondi (écriture comprise)
 * et la modification d'une cible relance le test.
 */
export function TargetControls({ target, active }: { target: EditableTarget; active: boolean }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [run, setRun] = useState({ n: 0, deep: false });

  useEffect(() => {
    let cancelled = false;
    checkStorageTarget(target.id, run.deep)
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setStatus({
            connected: false,
            checkedAt: new Date().toISOString(),
            durationMs: 0,
            message: "Le test n'a pas pu être lancé (erreur serveur).",
            detail: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [target.id, run]);

  function retest(deep: boolean) {
    setStatus(null);
    setRun((r) => ({ n: r.n + 1, deep }));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {status === null ? (
          <Badge tone="neutral">
            <Loader2 className="h-3 w-3 animate-spin" /> Vérification…
          </Badge>
        ) : status.connected ? (
          <Badge tone={status.warning ? "warning" : "success"}>
            <CheckCircle2 className="h-3 w-3" /> Connecté
          </Badge>
        ) : (
          <Badge tone="danger">
            <XCircle className="h-3 w-3" /> Non connecté
          </Badge>
        )}
        <Button variant="ghost" size="sm" onClick={() => retest(true)} disabled={status === null} aria-label="Tester la connexion">
          <RefreshCw className="h-3.5 w-3.5" /> Tester
        </Button>
        <TargetActions target={target} onUpdated={() => retest(false)} />
        <TargetActiveToggle targetId={target.id} active={active} />
      </div>

      {status && (
        <div className="basis-full space-y-1 text-xs">
          {!status.connected && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
              <p className="font-medium">{status.message}</p>
              {status.detail && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-danger/80">Détail technique</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-danger/90">{status.detail}</pre>
                </details>
              )}
            </div>
          )}
          {status.connected && status.warning && (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-warning">{status.warning}</p>
          )}
          <p className="text-foreground-muted">
            Testé le {formatDateTime(status.checkedAt)} ({status.durationMs} ms)
            {status.checks && status.checks.length > 0 && ` — ${status.checks.join(" · ")}`}
          </p>
        </div>
      )}
    </>
  );
}
