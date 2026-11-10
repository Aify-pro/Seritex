"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Receipt } from "lucide-react";
import { createFine, createIncident, markGpsEventsSeen, setFineStatut, treatGpsEvent, updateIncident } from "@/app/(app)/vehicules/actions";
import { ActionButton, DialogForm, Field, inputClass } from "./form-kit";
import { FINE_STATUT_LABELS } from "@/lib/vehicules/labels";

const today = () => new Date().toISOString().slice(0, 10);
type Employe = { id: string; nom: string; matricule: string };

// --- Alertes GPS ---------------------------------------------------------------------------

export function GpsEventActions({ id, statut }: { id: string; statut: string }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {statut === "nouvelle" && (
        <ActionButton action={() => treatGpsEvent(id, "vue")} success="Alerte marquée comme vue" variant="ghost">
          Vu
        </ActionButton>
      )}
      <ActionButton action={(c) => treatGpsEvent(id, "classee", c)} success="Alerte classée" variant="ghost" askReason="Suite donnée (ex. chauffeur prévenu)">
        Classer
      </ActionButton>
    </span>
  );
}

export function MarkAllSeenButton({ vehicleId }: { vehicleId?: string }) {
  return (
    <ActionButton action={() => markGpsEventsSeen(vehicleId)} success="Alertes marquées comme vues" variant="secondary">
      Tout marquer comme vu
    </ActionButton>
  );
}

// --- Sinistres ----------------------------------------------------------------------------

function DriverSelect({ employes }: { employes: Employe[] }) {
  return (
    <select name="conducteur_id" defaultValue="" className={inputClass}>
      <option value="">Retrouvé automatiquement (chauffeur à cette date)</option>
      {employes.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nom} ({e.matricule})
        </option>
      ))}
    </select>
  );
}

export function IncidentDialog({ vehicleId, employes }: { vehicleId: string; employes: Employe[] }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <ShieldAlert className="h-3.5 w-3.5" /> Déclarer un sinistre
        </Button>
      }
      title="Déclarer un sinistre"
      description="Accident, accrochage, vol, vandalisme… Le conducteur est retrouvé automatiquement par l'affectation à cette date si vous ne le choisissez pas."
      action={(fd) => createIncident(vehicleId, fd)}
      success="Sinistre déclaré"
      submitLabel="Déclarer"
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date *">
          <input type="date" name="date" required defaultValue={today()} max={today()} className={inputClass} />
        </Field>
        <Field label="Heure">
          <input type="time" name="heure" defaultValue="12:00" className={inputClass} />
        </Field>
        <Field label="Lieu">
          <input name="lieu" maxLength={200} className={inputClass} />
        </Field>
        <Field label="Que s'est-il passé ? *" className="sm:col-span-3">
          <textarea name="description" required rows={3} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Conducteur" className="sm:col-span-2">
          <DriverSelect employes={employes} />
        </Field>
        <Field label="Responsabilité">
          <select name="responsabilite" defaultValue="inconnue" className={inputClass}>
            <option value="inconnue">À établir</option>
            <option value="seritex">Notre conducteur</option>
            <option value="tiers">Le tiers</option>
            <option value="partagee">Partagée</option>
          </select>
        </Field>
        <Field label="Tiers impliqué" className="sm:col-span-2">
          <input name="tiers" maxLength={500} placeholder="Nom, véhicule, assurance du tiers" className={inputClass} />
        </Field>
        <Field label="N° de dossier assurance">
          <input name="assureur_dossier" maxLength={80} className={inputClass} />
        </Field>
        <Field label="Coût estimé (FCFA)">
          <input name="cout_reel" inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Constat amiable">
          <input type="file" name="constat" accept="image/*,application/pdf" className="text-sm" />
        </Field>
        <Field label="Photo">
          <input type="file" name="photo" accept="image/*" className="text-sm" />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" name="immobiliser" className="h-4 w-4" /> Immobiliser le véhicule (ni tournée, ni bon de carburant) jusqu&apos;à nouvel ordre
        </label>
      </div>
    </DialogForm>
  );
}

export function IncidentFollowUp({
  vehicleId,
  incident,
}: {
  vehicleId: string;
  incident: { id: string; statut: string; cout_reel: number | null; rembourse: number | null; assureur_dossier: string | null };
}) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="ghost">
          Suivi
        </Button>
      }
      title="Suivi du sinistre"
      action={(fd) => updateIncident(vehicleId, incident.id, fd)}
      success="Sinistre mis à jour"
      submitLabel="Enregistrer"
      size="sm"
    >
      <div className="space-y-3">
        <Field label="Étape">
          <select name="statut" defaultValue={incident.statut} className={inputClass}>
            <option value="declare">Déclaré</option>
            <option value="expertise">En expertise</option>
            <option value="en_reparation">En réparation</option>
            <option value="clos">Clos</option>
          </select>
        </Field>
        <Field label="N° de dossier assurance">
          <input name="assureur_dossier" defaultValue={incident.assureur_dossier ?? ""} className={inputClass} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Coût réel (FCFA)">
            <input name="cout_reel" inputMode="numeric" defaultValue={incident.cout_reel ?? ""} className={inputClass} />
          </Field>
          <Field label="Remboursé par l'assurance">
            <input name="rembourse" inputMode="numeric" defaultValue={incident.rembourse ?? ""} className={inputClass} />
          </Field>
        </div>
      </div>
    </DialogForm>
  );
}

// --- Amendes ------------------------------------------------------------------------------

export function FineDialog({ vehicleId, employes }: { vehicleId: string; employes: Employe[] }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <Receipt className="h-3.5 w-3.5" /> Enregistrer une amende
        </Button>
      }
      title="Amende"
      description="Le conducteur responsable est retrouvé automatiquement par l'affectation à la date, et la position GPS du véhicule à l'heure indiquée est relevée."
      action={(fd) => createFine(vehicleId, fd)}
      success="Amende enregistrée"
      submitLabel="Enregistrer"
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date de l'infraction *">
          <input type="date" name="date" required max={today()} className={inputClass} />
        </Field>
        <Field label="Heure *" hint="Sert à retrouver la position GPS.">
          <input type="time" name="heure" required className={inputClass} />
        </Field>
        <Field label="Montant (FCFA) *">
          <input name="montant" required inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Motif *" className="sm:col-span-2">
          <input name="motif" required maxLength={300} placeholder="ex. Excès de vitesse, stationnement gênant" className={inputClass} />
        </Field>
        <Field label="N° du procès-verbal">
          <input name="reference" maxLength={60} className={inputClass} />
        </Field>
        <Field label="Lieu" className="sm:col-span-3">
          <input name="lieu" maxLength={200} className={inputClass} />
        </Field>
        <Field label="Conducteur" className="sm:col-span-2">
          <DriverSelect employes={employes} />
        </Field>
        <Field label="Avis de contravention">
          <input type="file" name="fichier" accept="image/*,application/pdf" className="text-sm" />
        </Field>
      </div>
    </DialogForm>
  );
}

export function FineStatutSelect({ vehicleId, id, statut }: { vehicleId: string; id: string; statut: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={statut}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          const r = await setFineStatut(vehicleId, id, e.target.value);
          if (r.error) toast.error("Modification refusée", { description: r.error });
          else toast.success("Amende mise à jour");
          router.refresh();
        })
      }
      className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
    >
      {Object.entries(FINE_STATUT_LABELS).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
