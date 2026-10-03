"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createCarrier,
  createVehicle,
  createZone,
  setCarrierActive,
  setVehicleActive,
  setZoneActive,
} from "./actions";

type Field =
  | { name: string; label: string; kind: "text"; placeholder?: string; required?: boolean; width?: string }
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[] };

const CREATE = { zone: createZone, carrier: createCarrier, vehicle: createVehicle } as const;
const TOGGLE = { zone: setZoneActive, carrier: setCarrierActive, vehicle: setVehicleActive } as const;

/** Formulaire d'ajout en ligne d'un référentiel de livraison (zone, transporteur, véhicule). */
export function InlineCreateForm({ kind, fields, label }: { kind: keyof typeof CREATE; fields: Field[]; label: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await CREATE[kind](fd);
          if (res?.error) toast.error("Ajout refusé", { description: res.error });
          else {
            toast.success(`${label} ajouté(e)`);
            formRef.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-2"
    >
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">{f.label}</span>
          {f.kind === "select" ? (
            <select name={f.name} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              required={f.required}
              placeholder={f.placeholder}
              className={`h-9 rounded-md border border-border bg-surface px-2 text-sm ${f.width ?? "w-44"}`}
            />
          )}
        </label>
      ))}
      <Button type="submit" size="sm" loading={pending}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </form>
  );
}

/** Interrupteur actif / inactif d'une ligne de référentiel. */
export function ActiveSwitch({ kind, id, actif }: { kind: keyof typeof TOGGLE; id: string; actif: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await TOGGLE[kind](id, !actif);
          if (res?.error) toast.error("Modification refusée", { description: res.error });
          else router.refresh();
        })
      }
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        actif ? "bg-success-soft text-success" : "bg-surface-muted text-foreground-muted"
      } disabled:opacity-50`}
    >
      {actif ? "Actif" : "Inactif"}
    </button>
  );
}
