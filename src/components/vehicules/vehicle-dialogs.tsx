"use client";

import { useState } from "react";
import { Plus, Pencil, Fuel } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VEHICLE_TYPE_LABELS } from "@/lib/types/domain";
import { VEHICLE_ENERGIE_LABELS, VEHICLE_USAGE_LABELS } from "@/lib/vehicules/labels";
import { createVehicle, updateVehicle } from "@/app/(app)/vehicules/actions";
import { createFuelVoucher } from "@/app/(app)/vehicules/bons/actions";
import { DialogForm, Field, inputClass } from "./form-kit";

export interface VehicleDefaults {
  type?: string;
  libelle?: string;
  immatriculation?: string | null;
  usage?: string | null;
  marque?: string | null;
  modele?: string | null;
  annee?: number | null;
  couleur?: string | null;
  energie?: string | null;
  reservoir_litres?: number | null;
  numero_chassis?: string | null;
  carte_grise_numero?: string | null;
  date_mise_circulation?: string | null;
  capacite_note?: string | null;
  notes?: string | null;
}

function VehicleFields({ d, withKm }: { d: VehicleDefaults; withKm?: boolean }) {
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Field label="Nom du véhicule *" className="sm:col-span-2">
          <input name="libelle" required defaultValue={d.libelle ?? ""} placeholder="Camion livraison 1" className={inputClass} />
        </Field>
        <Field label="Immatriculation">
          <input name="immatriculation" defaultValue={d.immatriculation ?? ""} placeholder="2632JP01" className={`${inputClass} uppercase`} />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={d.type ?? "voiture"} className={inputClass}>
            {Object.entries(VEHICLE_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Usage" hint="Les tournées proposent d'abord les véhicules « Livraison ».">
          <select name="usage" defaultValue={d.usage ?? ""} className={inputClass}>
            <option value="">Non précisé</option>
            {Object.entries(VEHICLE_USAGE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Carburant">
          <select name="energie" defaultValue={d.energie ?? ""} className={inputClass}>
            <option value="">Non précisé</option>
            {Object.entries(VEHICLE_ENERGIE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Field label="Marque">
          <input name="marque" defaultValue={d.marque ?? ""} className={inputClass} />
        </Field>
        <Field label="Modèle">
          <input name="modele" defaultValue={d.modele ?? ""} className={inputClass} />
        </Field>
        <Field label="Année">
          <input name="annee" inputMode="numeric" defaultValue={d.annee ?? ""} className={inputClass} />
        </Field>
        <Field label="Couleur">
          <input name="couleur" defaultValue={d.couleur ?? ""} className={inputClass} />
        </Field>
        <Field label="Réservoir (litres)" hint="Sert à contrôler les pleins.">
          <input name="reservoir_litres" inputMode="decimal" defaultValue={d.reservoir_litres ?? ""} className={inputClass} />
        </Field>
        <Field label="Capacité de chargement">
          <input name="capacite_note" defaultValue={d.capacite_note ?? ""} placeholder="ex. 40 cartons" className={inputClass} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <Field label="N° de carte grise">
          <input name="carte_grise_numero" defaultValue={d.carte_grise_numero ?? ""} className={inputClass} />
        </Field>
        <Field label="1re mise en circulation">
          <input type="date" name="date_mise_circulation" defaultValue={d.date_mise_circulation ?? ""} className={inputClass} />
        </Field>
        <Field label="N° de châssis">
          <input name="numero_chassis" defaultValue={d.numero_chassis ?? ""} className={`${inputClass} uppercase`} />
        </Field>
        {withKm && (
          <Field label="Kilométrage actuel">
            <input name="km" inputMode="numeric" placeholder="ex. 84500" className={inputClass} />
          </Field>
        )}
      </fieldset>

      <Field label="Notes">
        <textarea name="notes" rows={2} defaultValue={d.notes ?? ""} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
      </Field>
    </div>
  );
}

export function NewVehicleButton() {
  return (
    <DialogForm
      trigger={
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" /> Nouveau véhicule
        </Button>
      }
      title="Nouveau véhicule"
      description="Les documents, le chauffeur et l'entretien se renseignent ensuite sur la fiche."
      action={createVehicle}
      success="Véhicule ajouté"
      submitLabel="Enregistrer le véhicule"
      size="lg"
    >
      <VehicleFields d={{}} withKm />
    </DialogForm>
  );
}

export function EditVehicleButton({ id, defaults }: { id: string; defaults: VehicleDefaults }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <Pencil className="h-3.5 w-3.5" /> Modifier
        </Button>
      }
      title="Modifier le véhicule"
      action={(fd) => updateVehicle(id, fd)}
      success="Fiche mise à jour"
      submitLabel="Enregistrer"
      size="lg"
    >
      <VehicleFields d={defaults} />
    </DialogForm>
  );
}

export interface VoucherVehicleOption {
  id: string;
  label: string;
  blocage: string | null;
  titulaireId: string | null;
  kmActuel: number | null;
}

export function NewFuelVoucherButton({
  vehicles,
  employes,
  stations,
  defaultVehicleId,
}: {
  vehicles: VoucherVehicleOption[];
  employes: { id: string; nom: string; matricule: string }[];
  stations: { id: string; nom: string }[];
  defaultVehicleId?: string;
}) {
  const firstUsable = vehicles.find((v) => !v.blocage)?.id ?? "";
  const [vehicleId, setVehicleId] = useState(defaultVehicleId && vehicles.some((v) => v.id === defaultVehicleId && !v.blocage) ? defaultVehicleId : firstUsable);
  const selected = vehicles.find((v) => v.id === vehicleId);
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant={defaultVehicleId ? "secondary" : "primary"}>
          <Fuel className="h-3.5 w-3.5" /> Nouveau bon de carburant
        </Button>
      }
      title="Demande de bon de carburant"
      description="Le bon est validé par le responsable logistique, puis imprimé. Au retour, on saisit le ticket : montant, litres et kilométrage."
      action={createFuelVoucher}
      success="Demande enregistrée"
      submitLabel="Enregistrer la demande"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Véhicule *" className="sm:col-span-2" hint={selected?.blocage ? `Immobilisé : ${selected.blocage}` : undefined}>
          <select name="vehicle_id" required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputClass}>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id} disabled={!!v.blocage}>
                {v.label}
                {v.blocage ? ` (immobilisé : ${v.blocage})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bénéficiaire (chauffeur)">
          <select key={vehicleId} name="beneficiaire_id" defaultValue={selected?.titulaireId ?? ""} className={inputClass}>
            <option value="">—</option>
            {employes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom} ({e.matricule})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Montant du bon (FCFA) *">
          <input name="montant_demande" required inputMode="numeric" placeholder="ex. 30000" className={inputClass} />
        </Field>
        <Field label="Kilométrage au départ" hint={selected?.kmActuel != null ? `Dernier relevé : ${new Intl.NumberFormat("fr-FR").format(selected.kmActuel)} km` : undefined}>
          <input name="km_demande" inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Station">
          <select name="station_id" defaultValue="" className={inputClass}>
            <option value="">Toute station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Motif ou mission" className="sm:col-span-2">
          <input name="motif" maxLength={200} placeholder="ex. Tournée Yopougon - Abobo" className={inputClass} />
        </Field>
      </div>
    </DialogForm>
  );
}
