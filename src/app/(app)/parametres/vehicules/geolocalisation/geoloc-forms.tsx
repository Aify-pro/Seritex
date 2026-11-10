"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { autoLinkDevices, createVehicleFromDevice, linkDevice, saveFreetrackSettings, syncFreetrackNow, testFreetrack } from "./actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string }>, ok = "Enregistré") =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error("Échec", { description: r.error });
      else toast.success(r.message ?? ok);
      router.refresh();
    });
  return { pending, run };
}

function L({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-foreground-muted">{hint}</span>}
    </label>
  );
}

export function ConnectionForm({
  baseUrl,
  email,
  actif,
  frequence,
  passwordSetAt,
}: {
  baseUrl: string;
  email: string | null;
  actif: boolean;
  frequence: number;
  passwordSetAt: string | null;
}) {
  const { pending, run } = useAction();
  return (
    <form action={(fd) => run(() => saveFreetrackSettings(fd))} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      <L label="Adresse de la plateforme">
        <input name="base_url" defaultValue={baseUrl} className={input} />
      </L>
      <L label="Identifiant (e-mail)">
        <input name="email" type="email" autoComplete="off" defaultValue={email ?? ""} className={input} />
      </L>
      <L
        label="Mot de passe"
        hint={
          passwordSetAt
            ? `Défini le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(passwordSetAt))}. Laissez vide pour le conserver.`
            : "Chiffré dans le coffre-fort de la base ; il ne sera plus jamais affiché."
        }
      >
        <input name="password" type="password" autoComplete="new-password" placeholder={passwordSetAt ? "••••••••" : ""} className={input} />
      </L>
      <L label="Synchroniser toutes les">
        <select name="frequence_minutes" defaultValue={frequence} className={input}>
          {[5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </L>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="actif" defaultChecked={actif} className="h-4 w-4" />
        Synchronisation automatique active
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function ConnectionButtons({ disabled }: { disabled: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" disabled={disabled} loading={pending} onClick={() => run(testFreetrack)}>
        Tester la connexion
      </Button>
      <Button size="sm" variant="secondary" disabled={disabled} loading={pending} onClick={() => run(syncFreetrackNow)}>
        Synchroniser maintenant
      </Button>
    </div>
  );
}

export function DeviceRow({
  device,
  vehicles,
  linkedVehicleId,
  canCreate,
}: {
  device: { deviceId: number; nom: string; etat: string; signalLe: string | null };
  vehicles: { id: string; label: string; deviceId: number | null }[];
  linkedVehicleId: string | null;
  canCreate: boolean;
}) {
  const { pending, run } = useAction();
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2 text-sm font-medium">{device.nom}</td>
      <td className="px-4 py-2 text-xs text-foreground-muted">
        {device.etat === "online" ? "en ligne" : device.etat === "ack" ? "à l'arrêt, connecté" : "hors ligne"}
        {device.signalLe ? ` · ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(device.signalLe))}` : ""}
      </td>
      <td className="px-4 py-2">
        <select
          defaultValue={linkedVehicleId ?? ""}
          disabled={pending}
          onChange={(e) => run(() => linkDevice(device.deviceId, e.target.value), e.target.value ? "Traceur relié" : "Traceur délié")}
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm"
        >
          <option value="">Non relié</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {v.deviceId && v.deviceId !== device.deviceId ? " (relié à un autre traceur)" : ""}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2 text-right">
        {!linkedVehicleId && canCreate && (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => createVehicleFromDevice(device.deviceId, device.nom))}>
            Créer le véhicule
          </Button>
        )}
      </td>
    </tr>
  );
}

export function AutoLinkButton({ devices }: { devices: { deviceId: number; nom: string }[] }) {
  const { pending, run } = useAction();
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => autoLinkDevices(devices))}>
      Relier par immatriculation
    </Button>
  );
}
