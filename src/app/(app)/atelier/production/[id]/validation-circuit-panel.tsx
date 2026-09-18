"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { SAMPLE_STATUS_LABELS, type SampleRequestStatus } from "@/lib/types/domain";
import { attesterComptabiliteOdf, attesterInfographieOdf } from "../actions";

type EchantillonLigne = { description: string; statuses: SampleRequestStatus[] };

/**
 * Circuit de validation d'un ODF avant soumission (migration 0050) —
 * remplace, côté PDF, la section « Traçabilité du cycle de vie » (odf-pdf.ts) ;
 * cette version écran reste visible après soumission comme trace de qui a
 * approuvé quoi. Comptabilité et infographie sont deux attestations
 * manuelles ; les échantillons sont calculés (aucune case à cocher : au
 * moins un échantillon "Validé" par article qui en porte un) ; le chef de
 * production, c'est l'acte de soumission lui-même (soumis_le/par).
 */
export function ValidationCircuitPanel({
  productionOrderId,
  modifiable,
  comptabilite,
  infographie,
  soumis,
  canAttesterComptabilite,
  canAttesterInfographie,
  echantillons,
}: {
  productionOrderId: string;
  modifiable: boolean;
  comptabilite: { valideLe: string | null; validePar: string | null };
  infographie: { requise: boolean; valideLe: string | null; validePar: string | null };
  soumis: { le: string | null; par: string | null };
  canAttesterComptabilite: boolean;
  canAttesterInfographie: boolean;
  echantillons: EchantillonLigne[];
}) {
  const [pending, startTransition] = useTransition();

  function attester(action: typeof attesterComptabiliteOdf, label: string) {
    startTransition(async () => {
      const res = await action(productionOrderId);
      if (res.error) toast.error(`${label} refusée`, { description: res.error });
      else toast.success(`${label} enregistrée`);
    });
  }

  const echantillonsBloquants = echantillons.filter((e) => !e.statuses.includes("valide"));

  return (
    <Card>
      <CardHeader
        title="Circuit de validation"
        description="Avant de pouvoir être soumis à validation, un ODF doit réunir ces approbations."
      />
      <CardBody className="space-y-3">
        <CircuitRow
          label="Comptabilité"
          detail="Compte client en règle"
          done={!!comptabilite.valideLe}
          doneAt={comptabilite.valideLe}
          doneBy={comptabilite.validePar}
          action={
            modifiable && canAttesterComptabilite && !comptabilite.valideLe ? (
              <Button size="sm" loading={pending} onClick={() => attester(attesterComptabiliteOdf, "Validation comptabilité")}>
                Compte client clean
              </Button>
            ) : null
          }
        />

        <CircuitRow
          label="Infographie"
          detail={infographie.requise ? "Visuels/maquette à valider" : "Non requis — aucun article n'exige de visuel"}
          done={!infographie.requise || !!infographie.valideLe}
          doneAt={infographie.valideLe}
          doneBy={infographie.validePar}
          notRequired={!infographie.requise}
          action={
            modifiable && infographie.requise && canAttesterInfographie && !infographie.valideLe ? (
              <Button size="sm" loading={pending} onClick={() => attester(attesterInfographieOdf, "Validation infographie")}>
                Visuels validés
              </Button>
            ) : null
          }
        />

        <CircuitRow
          label="Échantillons"
          detail={
            echantillons.length === 0
              ? "Non requis — aucun échantillon lié"
              : echantillonsBloquants.length === 0
                ? `${echantillons.length} article(s) avec échantillon validé`
                : echantillonsBloquants.map((e) => `${e.description} (${e.statuses.map((s) => SAMPLE_STATUS_LABELS[s]).join(", ") || "aucun"})`).join(" · ")
          }
          done={echantillonsBloquants.length === 0}
          notRequired={echantillons.length === 0}
        />

        <CircuitRow
          label="Chef de production"
          detail="Soumission de l'ODF à validation"
          done={!!soumis.le}
          doneAt={soumis.le}
          doneBy={soumis.par}
        />
      </CardBody>
    </Card>
  );
}

function CircuitRow({
  label,
  detail,
  done,
  doneAt,
  doneBy,
  notRequired,
  action,
}: {
  label: string;
  detail: string;
  done: boolean;
  doneAt?: string | null;
  doneBy?: string | null;
  notRequired?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : notRequired ? (
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
        ) : (
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-foreground-muted">{detail}</p>
          {done && doneAt && (
            <p className="mt-0.5 text-xs text-foreground-muted">
              {formatDateTime(doneAt)}
              {doneBy ? ` — ${doneBy}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!action && (
          <Badge tone={done ? "success" : notRequired ? "neutral" : "warning"}>
            {done ? "Validé" : notRequired ? "Non requis" : "En attente"}
          </Badge>
        )}
        {action}
      </div>
    </div>
  );
}
