"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { CheckCircle2, XCircle, Flag, ShieldAlert, Ban } from "lucide-react";
import type { ProductionOrderStatus } from "@/lib/types/domain";
import {
  validateProductionOrder,
  refuseProductionOrder,
  requestClosure,
  confirmClosure,
  forceCloseProductionOrder,
  cancelProductionOrder,
} from "../actions";

/**
 * Actions du cycle de vie de l'ODF, affichées selon le statut courant et les
 * droits de l'utilisateur (calculés côté serveur — `canValidate`/
 * `canRequestClosure`/`isAdmin` — jamais recalculés ici : ce composant ne
 * fait qu'appeler les RPC, qui refont l'autorité côté Postgres).
 */
export function LifecycleActions({
  productionOrderId,
  status,
  canValidate,
  canRequestClosure,
  isAdmin,
}: {
  productionOrderId: string;
  status: ProductionOrderStatus;
  canValidate: boolean;
  canRequestClosure: boolean;
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [showRefuse, setShowRefuse] = useState(false);
  const [showRenvoi, setShowRenvoi] = useState(false);
  const [showForceClose, setShowForceClose] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState("");

  function call(label: string, action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else toast.success(label);
      setShowRefuse(false);
      setShowRenvoi(false);
      setShowForceClose(false);
      setShowCancel(false);
      setReason("");
    });
  }

  const adminActions = isAdmin && ["en_production", "demande_cloture", "en_attente_validation", "brouillon"].includes(status) && (
    <div className="flex flex-wrap gap-1.5">
      {["en_production", "demande_cloture"].includes(status) && (
        <Button size="sm" variant="danger" onClick={() => setShowForceClose(true)} disabled={pending}>
          <ShieldAlert className="h-3.5 w-3.5" /> Clôture exceptionnelle
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setShowCancel(true)} disabled={pending}>
        <Ban className="h-3.5 w-3.5" /> Annuler l&apos;ODF
      </Button>
    </div>
  );

  if (status === "en_attente_validation" && canValidate) {
    return (
      <Card className="border-brand/30 bg-brand-soft/40">
        <CardBody className="space-y-3">
          <p className="text-sm font-medium text-foreground">En attente de validation</p>
          {!showRefuse ? (
            <div className="flex flex-wrap gap-2">
              <Button
                loading={pending}
                onClick={() => call("Ordre de fabrication validé — sous-ODF générés", () => validateProductionOrder(productionOrderId))}
              >
                <CheckCircle2 className="h-4 w-4" /> Valider et lancer
              </Button>
              <Button variant="danger" onClick={() => setShowRefuse(true)} disabled={pending}>
                <XCircle className="h-4 w-4" /> Refuser
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motif du refus (optionnel)"
                className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
                rows={2}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => call("Ordre de fabrication refusé", () => refuseProductionOrder(productionOrderId, reason))}
                  loading={pending}
                >
                  Confirmer le refus
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowRefuse(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  if (status === "en_production") {
    return (
      <div className="space-y-3">
        {canRequestClosure && (
          <Card className="border-brand/30 bg-brand-soft/40">
            <CardBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium text-foreground">En production</p>
                <p className="text-xs text-foreground-muted">
                  Possible uniquement lorsque tous les sous-ODF ont atteint leur quantité prévue.
                </p>
              </div>
              <Button
                loading={pending}
                onClick={() => call("Clôture demandée — en attente de validation par la direction", () => requestClosure(productionOrderId))}
              >
                <Flag className="h-4 w-4" /> Demander la clôture
              </Button>
            </CardBody>
          </Card>
        )}
        {adminActions}
        {renderMotifForms()}
      </div>
    );
  }

  if (status === "demande_cloture") {
    return (
      <div className="space-y-3">
        {canValidate && !showRenvoi && (
          <Card className="border-warning/30 bg-warning-soft/40">
            <CardBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <p className="text-sm font-medium text-foreground">Demande de clôture — contrôle de la direction requis</p>
              <div className="flex gap-2">
                <Button
                  loading={pending}
                  onClick={() => call("Clôture confirmée", () => confirmClosure(productionOrderId, true))}
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirmer la clôture
                </Button>
                <Button variant="secondary" onClick={() => setShowRenvoi(true)} disabled={pending}>
                  Renvoyer pour corrections
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
        {showRenvoi && (
          <Card>
            <CardBody className="space-y-2">
              <label className="block text-xs font-medium text-foreground-muted">Motif du renvoi (obligatoire)</label>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-brand/30"
                rows={2}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!reason.trim()}
                  loading={pending}
                  onClick={() => call("Ordre de fabrication renvoyé pour corrections", () => confirmClosure(productionOrderId, false, reason))}
                >
                  Confirmer le renvoi
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowRenvoi(false)}>
                  Annuler
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
        {adminActions}
        {renderMotifForms()}
      </div>
    );
  }

  if ((status === "brouillon" || status === "en_attente_validation") && (adminActions || null)) {
    return (
      <div className="space-y-3">
        {adminActions}
        {renderMotifForms()}
      </div>
    );
  }

  return null;

  function renderMotifForms() {
    return (
      <>
        {showForceClose && (
          <Card className="border-danger/30">
            <CardBody className="space-y-2">
              <label className="block text-xs font-medium text-foreground-muted">
                Motif de la clôture exceptionnelle (obligatoire)
              </label>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-danger/30"
                rows={2}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!reason.trim()}
                  loading={pending}
                  onClick={() => call("Ordre de fabrication clôturé exceptionnellement", () => forceCloseProductionOrder(productionOrderId, reason))}
                >
                  Confirmer la clôture exceptionnelle
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForceClose(false)}>
                  Annuler
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
        {showCancel && (
          <Card className="border-danger/30">
            <CardBody className="space-y-2">
              <label className="block text-xs font-medium text-foreground-muted">Motif de l&apos;annulation (obligatoire)</label>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-md border border-border bg-surface p-2 text-xs outline-none focus:ring-2 focus:ring-danger/30"
                rows={2}
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!reason.trim()}
                  loading={pending}
                  onClick={() => call("Ordre de fabrication annulé", () => cancelProductionOrder(productionOrderId, reason))}
                >
                  Confirmer l&apos;annulation
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>
                  Annuler
                </Button>
              </div>
            </CardBody>
          </Card>
        )}
      </>
    );
  }
}
