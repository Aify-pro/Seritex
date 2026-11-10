"use client";

import { useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addFuelPrice, saveDocumentType, saveFuelSettings, saveServiceType, saveStation } from "./actions";

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

/** Ligne de réglage enregistrée d'un clic (formulaire en ligne). */
function InlineForm({ action, children, label = "Enregistrer", reset = false }: { action: (fd: FormData) => Promise<{ error?: string }>; children: ReactNode; label?: string; reset?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const res = await action(fd);
          if (res.error) toast.error("Enregistrement refusé", { description: res.error });
          else {
            toast.success("Enregistré");
            if (reset) ref.current?.reset();
            router.refresh();
          }
        })
      }
      className="flex flex-wrap items-end gap-3 px-5 py-3"
    >
      {children}
      <Button type="submit" size="sm" variant={reset ? "primary" : "secondary"} loading={pending}>
        {label}
      </Button>
    </form>
  );
}

function L({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span className="mb-1 block text-[11px] font-medium text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex h-8 items-center gap-1.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4" />
      {label}
    </label>
  );
}

export interface DocumentTypeRow {
  id: string;
  libelle: string;
  bloquant: boolean;
  obligatoire: boolean;
  preavis_jours: number;
  urgence_jours: number;
  actif: boolean;
}

export function DocumentTypeForm({ t }: { t?: DocumentTypeRow }) {
  return (
    <InlineForm action={(fd) => saveDocumentType(t?.id ?? null, fd)} label={t ? "Enregistrer" : "Ajouter"} reset={!t}>
      <L label={t ? "Document" : "Nouveau type de document"}>
        <input name="libelle" required defaultValue={t?.libelle ?? ""} className={`${input} w-48`} />
      </L>
      <L label="Signaler dès (jours avant)">
        <input name="preavis_jours" inputMode="numeric" defaultValue={t?.preavis_jours ?? 30} className={`${input} w-20`} />
      </L>
      <L label="Urgent à (jours avant)">
        <input name="urgence_jours" inputMode="numeric" defaultValue={t?.urgence_jours ?? 7} className={`${input} w-20`} />
      </L>
      <Check name="bloquant" label="Bloquant" defaultChecked={t?.bloquant ?? false} />
      <Check name="obligatoire" label="Obligatoire" defaultChecked={t?.obligatoire ?? true} />
      {t && <Check name="actif" label="Suivi" defaultChecked={t.actif} />}
    </InlineForm>
  );
}

export interface ServiceTypeRow {
  id: string;
  libelle: string;
  intervalle_jours: number | null;
  intervalle_km: number | null;
  actif: boolean;
}

export function ServiceTypeForm({ t }: { t?: ServiceTypeRow }) {
  return (
    <InlineForm action={(fd) => saveServiceType(t?.id ?? null, fd)} label={t ? "Enregistrer" : "Ajouter"} reset={!t}>
      <L label={t ? "Intervention" : "Nouveau type d'intervention"}>
        <input name="libelle" required defaultValue={t?.libelle ?? ""} className={`${input} w-48`} />
      </L>
      <L label="Tous les (jours)">
        <input name="intervalle_jours" inputMode="numeric" defaultValue={t?.intervalle_jours ?? ""} placeholder="—" className={`${input} w-24`} />
      </L>
      <L label="Tous les (km)">
        <input name="intervalle_km" inputMode="numeric" defaultValue={t?.intervalle_km ?? ""} placeholder="—" className={`${input} w-28`} />
      </L>
      {t && <Check name="actif" label="Actif" defaultChecked={t.actif} />}
    </InlineForm>
  );
}

export function FuelSettingsForm({
  plafond,
  conso,
  prix,
  ecartKm,
  distance,
}: {
  plafond: number | null;
  conso: number;
  prix: number;
  ecartKm: number;
  distance: number;
}) {
  return (
    <InlineForm action={saveFuelSettings}>
      <L label="Plafond d'un bon (FCFA)">
        <input name="plafond_bon" inputMode="numeric" defaultValue={plafond ?? ""} placeholder="Aucun" className={`${input} w-32`} />
      </L>
      <L label="Écart de consommation signalé (%)">
        <input name="ecart_consommation_pct" inputMode="numeric" defaultValue={conso} className={`${input} w-20`} />
      </L>
      <L label="Écart de prix au litre signalé (%)">
        <input name="ecart_prix_pct" inputMode="numeric" defaultValue={prix} className={`${input} w-20`} />
      </L>
      <L label="Écart compteur / GPS signalé (%)">
        <input name="ecart_km_gps_pct" inputMode="numeric" defaultValue={ecartKm} className={`${input} w-20`} />
      </L>
      <L label="Distance max. à la station (m)">
        <input name="distance_station_max_m" inputMode="numeric" defaultValue={distance} className={`${input} w-24`} />
      </L>
    </InlineForm>
  );
}

export function FuelPriceForm() {
  return (
    <InlineForm action={addFuelPrice} label="Ajouter" reset>
      <L label="Carburant">
        <select name="energie" className={input}>
          <option value="gasoil">Gasoil</option>
          <option value="essence">Essence</option>
        </select>
      </L>
      <L label="Prix du litre (FCFA)">
        <input name="prix_litre" required inputMode="numeric" className={`${input} w-28`} />
      </L>
      <L label="Applicable à partir du">
        <input type="date" name="depuis" required defaultValue={new Date().toISOString().slice(0, 10)} className={input} />
      </L>
    </InlineForm>
  );
}

export interface StationRow {
  id: string;
  nom: string;
  adresse: string | null;
  latitude: number | null;
  longitude: number | null;
  actif: boolean;
}

export function StationForm({ s }: { s?: StationRow }) {
  return (
    <InlineForm action={(fd) => saveStation(s?.id ?? null, fd)} label={s ? "Enregistrer" : "Ajouter"} reset={!s}>
      <L label={s ? "Station" : "Nouvelle station"}>
        <input name="nom" required defaultValue={s?.nom ?? ""} className={`${input} w-44`} />
      </L>
      <L label="Adresse">
        <input name="adresse" defaultValue={s?.adresse ?? ""} className={`${input} w-56`} />
      </L>
      <L label="Latitude">
        <input name="latitude" inputMode="decimal" defaultValue={s?.latitude ?? ""} className={`${input} w-24`} />
      </L>
      <L label="Longitude">
        <input name="longitude" inputMode="decimal" defaultValue={s?.longitude ?? ""} className={`${input} w-24`} />
      </L>
      {s && <Check name="actif" label="Active" defaultChecked={s.actif} />}
    </InlineForm>
  );
}
