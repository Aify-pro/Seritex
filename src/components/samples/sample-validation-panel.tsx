"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, CircleDashed, ThumbsDown, Undo2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateSample, rejectSample, cancelSampleValidation } from "@/lib/actions/samples";
import { formatDateTime } from "@/lib/utils";

/** Une des deux signatures attendues sur l'échantillon (migrations 0099/0100). */
export interface SampleValidationSide {
  at: string | null;
  byName: string | null;
  comment: string | null;
  /** Côté client seulement : saisie par le commercial pour le compte du client. */
  onBehalf?: boolean;
}

export interface SampleValidations {
  client: SampleValidationSide;
  direction: SampleValidationSide;
}

/**
 * Double validation de l'échantillon (demande Ayman, 06/10) : la fiche
 * imprimée porte un cartouche signé par le client et par la direction, voici
 * son pendant numérique. La fiche ne passe « validée » — et l'ODF ne peut
 * donc être lancé — que lorsque les deux signatures sont posées ; c'est la
 * base qui le calcule, cet écran ne fait que montrer où on en est.
 *
 * Une réponse négative de l'une des deux parties fait basculer la fiche tout
 * de suite et efface la validation déjà posée par l'autre.
 */
export function SampleValidationPanel({
  sampleId,
  validations,
  permissions,
}: {
  sampleId: string;
  validations: SampleValidations;
  permissions: {
    /** Le client lui-même, ou le commercial qui enregistre sa réponse. */
    canValidateClient: boolean;
    /** Direction / administrateur (module validation_echantillon). */
    canValidateDirection: boolean;
    /** Répondre « à ajuster » ou « refusé ». */
    canReject: boolean;
    /** Retirer une validation posée par erreur — direction et administrateur. */
    canCancel: boolean;
    /** Le staff enregistre pour le compte du client : le libellé le dit. */
    actsForClient: boolean;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");

  const bothDone = !!validations.client.at && !!validations.direction.at;

  function run(action: () => Promise<{ error?: string }>, done: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(done);
        setComment("");
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-3">
      <div>
        <p className="text-xs font-semibold text-foreground">Validation de l&apos;échantillon</p>
        <p className="text-[11px] text-foreground-muted">
          Deux signatures attendues : le client et la direction. Tant que les deux ne sont pas posées, la fiche reste en
          validation et l&apos;ordre de fabrication ne peut pas être lancé.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Side
          title="Client"
          side={validations.client}
          canValidate={permissions.canValidateClient}
          validateLabel={permissions.actsForClient ? "Enregistrer la validation du client" : "Je valide"}
          onValidate={() => run(() => validateSample(sampleId, "client", comment), "Validation du client enregistrée")}
          canCancel={permissions.canCancel}
          onCancel={() => run(() => cancelSampleValidation(sampleId, "client"), "Validation du client retirée")}
          pending={pending}
        />
        <Side
          title="Direction"
          side={validations.direction}
          canValidate={permissions.canValidateDirection}
          validateLabel="Valider (direction)"
          onValidate={() => run(() => validateSample(sampleId, "direction", comment), "Validation de la direction enregistrée")}
          canCancel={permissions.canCancel}
          onCancel={() => run(() => cancelSampleValidation(sampleId, "direction"), "Validation de la direction retirée")}
          pending={pending}
        />
      </div>

      {(permissions.canValidateClient || permissions.canValidateDirection || permissions.canReject) && !bothDone && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Commentaire (optionnel) — joint à la décision"
          rows={2}
          className="w-full rounded-md border border-border bg-surface p-2 text-xs"
        />
      )}

      {permissions.canReject && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => run(() => rejectSample(sampleId, "a_ajuster", comment), "Échantillon à ajuster")}
          >
            <Wrench className="h-3.5 w-3.5" /> À ajuster
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={pending}
            onClick={() => run(() => rejectSample(sampleId, "refuse", comment), "Échantillon refusé")}
          >
            <ThumbsDown className="h-3.5 w-3.5" /> Refuser
          </Button>
          <span className="text-[11px] text-foreground-muted">efface la validation déjà posée</span>
        </div>
      )}
    </div>
  );
}

function Side({
  title,
  side,
  canValidate,
  validateLabel,
  onValidate,
  canCancel,
  onCancel,
  pending,
}: {
  title: string;
  side: SampleValidationSide;
  canValidate: boolean;
  validateLabel: string;
  onValidate: () => void;
  canCancel: boolean;
  onCancel: () => void;
  pending: boolean;
}) {
  const done = !!side.at;

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {done ? <Check className="h-3.5 w-3.5 text-success" /> : <CircleDashed className="h-3.5 w-3.5 text-foreground-muted" />}
        {title}
      </p>
      {done ? (
        <>
          <p className="text-[11px] text-foreground-muted">
            {side.byName ?? "—"} · {formatDateTime(side.at)}
            {side.onBehalf ? " · enregistré par le commercial" : ""}
          </p>
          {side.comment && <p className="text-[11px] italic text-foreground-muted">« {side.comment} »</p>}
          {canCancel && (
            <button
              disabled={pending}
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-[11px] text-foreground-muted hover:text-danger disabled:opacity-50"
            >
              <Undo2 className="h-3 w-3" /> Retirer
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-[11px] text-foreground-muted">En attente</p>
          {canValidate && (
            <Button size="sm" variant="success" loading={pending} onClick={onValidate}>
              <Check className="h-3.5 w-3.5" /> {validateLabel}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
