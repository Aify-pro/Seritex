"use client";

import { useState } from "react";
import { Camera, FilePlus2, Gauge, Plus, Wrench, TriangleAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addOdometerReading,
  addRemplacement,
  addService,
  addVehicleDocument,
  deleteVehicleDocument,
  endRemplacement,
  reportIssue,
  resolveIssue,
  setDocumentExemption,
  setTitulaire,
  setVehicleStatut,
  uploadVehiclePhoto,
} from "@/app/(app)/vehicules/actions";
import { ActionButton, ActionForm, DialogForm, Field, inputClass } from "./form-kit";

const today = () => new Date().toISOString().slice(0, 10);
type Employe = { id: string; nom: string; matricule: string };

function EmployeSelect({ name, employes, defaultValue, required }: { name: string; employes: Employe[]; defaultValue?: string; required?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} required={required} className={inputClass}>
      <option value="">{required ? "Choisir…" : "—"}</option>
      {employes.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nom} ({e.matricule})
        </option>
      ))}
    </select>
  );
}

// --- Statut ---------------------------------------------------------------------------

export function StatusControls({ id, statut, actif }: { id: string; statut: string; actif: boolean }) {
  if (!actif || statut === "vendu") {
    return (
      <ActionButton action={() => setVehicleStatut(id, "en_service", true)} success="Véhicule remis en service">
        Remettre en service
      </ActionButton>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-2">
      {statut === "immobilise" ? (
        <ActionButton action={() => setVehicleStatut(id, "en_service", true)} success="Véhicule remis en service">
          Lever l&apos;immobilisation
        </ActionButton>
      ) : (
        statut !== "en_panne" && (
          <ActionButton action={() => setVehicleStatut(id, "immobilise", true)} success="Véhicule immobilisé" variant="secondary">
            Immobiliser
          </ActionButton>
        )
      )}
      <ActionButton action={() => setVehicleStatut(id, "vendu", false)} success="Véhicule sorti du parc" variant="ghost" confirm="Véhicule vendu ou réformé ?">
        Sortir du parc
      </ActionButton>
    </span>
  );
}

// --- Photo et compteur ----------------------------------------------------------------

export function PhotoUpload({ id, hasPhoto }: { id: string; hasPhoto: boolean }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="ghost">
          <Camera className="h-3.5 w-3.5" /> {hasPhoto ? "Changer la photo" : "Ajouter une photo"}
        </Button>
      }
      title="Photo du véhicule"
      action={(fd) => uploadVehiclePhoto(id, fd)}
      success="Photo enregistrée"
      submitLabel="Enregistrer"
      size="sm"
    >
      <input type="file" name="fichier" accept="image/*" required className="text-sm" />
    </DialogForm>
  );
}

export function OdometerForm({ id }: { id: string }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <Gauge className="h-3.5 w-3.5" /> Relever le compteur
        </Button>
      }
      title="Relevé de compteur"
      description="Les pleins et les interventions enregistrent aussi le kilométrage."
      action={(fd) => addOdometerReading(id, fd)}
      success="Relevé enregistré"
      submitLabel="Enregistrer"
      size="sm"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kilométrage *">
          <input name="km" required inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Date">
          <input type="date" name="date" defaultValue={today()} max={today()} className={inputClass} />
        </Field>
      </div>
    </DialogForm>
  );
}

// --- Documents --------------------------------------------------------------------------

export function DocumentDialog({
  vehicleId,
  types,
  typeId,
  label,
  variant = "secondary",
}: {
  vehicleId: string;
  types: { id: string; libelle: string }[];
  typeId?: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const libelle = types.find((t) => t.id === typeId)?.libelle;
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant={variant}>
          <FilePlus2 className="h-3.5 w-3.5" /> {label}
        </Button>
      }
      title={libelle ? `${libelle} : nouveau document` : "Nouveau document"}
      description="Le document le plus récent fait foi ; l'ancien reste dans l'historique."
      action={(fd) => addVehicleDocument(vehicleId, fd)}
      success="Document enregistré"
      submitLabel="Enregistrer le document"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type *">
          <select name="type_id" defaultValue={typeId ?? ""} required className={inputClass}>
            <option value="">Choisir…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.libelle}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Numéro">
          <input name="numero" className={inputClass} />
        </Field>
        <Field label="Fait le (début)">
          <input type="date" name="date_debut" defaultValue={today()} className={inputClass} />
        </Field>
        <Field label="Expire le *">
          <input type="date" name="date_fin" required className={inputClass} />
        </Field>
        <Field label="Organisme" hint="Assureur, centre de visite, mairie…">
          <input name="organisme" className={inputClass} />
        </Field>
        <Field label="Montant payé (FCFA)" hint="Compte dans les coûts du véhicule.">
          <input name="montant" inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Scan ou photo du document" className="sm:col-span-2">
          <input type="file" name="fichier" accept="image/*,application/pdf" className="text-sm" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input name="notes" maxLength={500} className={inputClass} />
        </Field>
      </div>
    </DialogForm>
  );
}

export function ExemptionButton({ vehicleId, typeId, exempt }: { vehicleId: string; typeId: string; exempt: boolean }) {
  return exempt ? (
    <ActionButton action={() => setDocumentExemption(vehicleId, typeId, false)} success="Document à nouveau suivi" variant="ghost">
      Suivre à nouveau
    </ActionButton>
  ) : (
    <ActionButton
      action={(motif) => setDocumentExemption(vehicleId, typeId, true, motif)}
      success="Marqué non concerné"
      variant="ghost"
      askReason="Pourquoi ce véhicule n'est pas concerné ?"
    >
      Non concerné
    </ActionButton>
  );
}

export function DeleteDocumentButton({ vehicleId, documentId }: { vehicleId: string; documentId: string }) {
  return (
    <ActionButton action={() => deleteVehicleDocument(vehicleId, documentId)} success="Document supprimé" variant="ghost" confirm="Supprimer ce document ?">
      Supprimer
    </ActionButton>
  );
}

// --- Chauffeur ----------------------------------------------------------------------------

export function TitulaireForm({ vehicleId, employes, currentId }: { vehicleId: string; employes: Employe[]; currentId: string | null }) {
  const [employeId, setEmployeId] = useState(currentId ?? "");
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant={currentId ? "secondary" : "primary"}>
          <UserRound className="h-3.5 w-3.5" /> {currentId ? "Changer de titulaire" : "Désigner le titulaire"}
        </Button>
      }
      title="Chauffeur titulaire"
      description="Le changement de titulaire est rare. Pour une absence ou une panne, préférez un remplacement daté."
      action={(fd) => setTitulaire(vehicleId, employeId || null, String(fd.get("debut") ?? ""), String(fd.get("motif") ?? ""))}
      success="Titulaire enregistré"
      submitLabel="Enregistrer"
      size="sm"
    >
      <div className="space-y-3">
        <Field label="Titulaire">
          <select value={employeId} onChange={(e) => setEmployeId(e.target.value)} className={inputClass}>
            <option value="">Aucun (retirer le titulaire)</option>
            {employes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nom} ({e.matricule})
              </option>
            ))}
          </select>
        </Field>
        <Field label="À partir du">
          <input type="date" name="debut" required defaultValue={today()} className={inputClass} />
        </Field>
        <Field label="Motif">
          <input name="motif" maxLength={200} className={inputClass} />
        </Field>
      </div>
    </DialogForm>
  );
}

export function RemplacementForm({ vehicleId, employes }: { vehicleId: string; employes: Employe[] }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <Plus className="h-3.5 w-3.5" /> Remplacement
        </Button>
      }
      title="Remplacement du chauffeur"
      description="Absence, congé, panne… Le remplaçant conduit le véhicule sur cette période."
      action={(fd) => addRemplacement(vehicleId, fd)}
      success="Remplacement enregistré"
      submitLabel="Enregistrer"
      size="sm"
    >
      <div className="space-y-3">
        <Field label="Remplaçant *">
          <EmployeSelect name="employe_id" employes={employes} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Du *">
            <input type="date" name="debut" required defaultValue={today()} className={inputClass} />
          </Field>
          <Field label="Au" hint="Vide = jusqu'à nouvel ordre.">
            <input type="date" name="fin" className={inputClass} />
          </Field>
        </div>
        <Field label="Motif">
          <input name="motif" maxLength={200} placeholder="ex. Congé annuel" className={inputClass} />
        </Field>
      </div>
    </DialogForm>
  );
}

export function EndRemplacementButton({ vehicleId, assignmentId }: { vehicleId: string; assignmentId: string }) {
  return (
    <ActionButton action={() => endRemplacement(vehicleId, assignmentId, today())} success="Remplacement terminé" variant="ghost">
      Terminer aujourd&apos;hui
    </ActionButton>
  );
}

// --- Pannes et entretien --------------------------------------------------------------------

export function IssueForm({ vehicleId, employes, defaultConducteur }: { vehicleId: string; employes: Employe[]; defaultConducteur?: string }) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant="secondary">
          <TriangleAlert className="h-3.5 w-3.5" /> Signaler une panne
        </Button>
      }
      title="Signaler une panne"
      description="Une panne immobilisante met le véhicule « en panne » : ni tournée ni bon de carburant jusqu'à sa clôture."
      action={(fd) => reportIssue(vehicleId, fd)}
      success="Panne signalée"
      submitLabel="Signaler"
    >
      <div className="space-y-3">
        <Field label="Description *">
          <textarea name="description" required rows={3} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gravité">
            <select name="gravite" defaultValue="mineure" className={inputClass}>
              <option value="mineure">Mineure : le véhicule roule</option>
              <option value="immobilisante">Immobilisante : le véhicule ne roule plus</option>
            </select>
          </Field>
          <Field label="Signalée par le chauffeur">
            <EmployeSelect name="conducteur_id" employes={employes} defaultValue={defaultConducteur} />
          </Field>
        </div>
        <Field label="Photo">
          <input type="file" name="fichier" accept="image/*,application/pdf" className="text-sm" />
        </Field>
      </div>
    </DialogForm>
  );
}

export function ResolveIssueButton({ vehicleId, issueId }: { vehicleId: string; issueId: string }) {
  return (
    <ActionButton action={(r) => resolveIssue(vehicleId, issueId, r)} success="Panne close" variant="ghost" askReason="Comment a-t-elle été réglée ?">
      Clore sans intervention
    </ActionButton>
  );
}

export function ServiceForm({
  vehicleId,
  types,
  openIssues,
  issueId,
  label = "Nouvelle intervention",
}: {
  vehicleId: string;
  types: { id: string; libelle: string }[];
  openIssues: { id: string; description: string }[];
  issueId?: string;
  label?: string;
}) {
  return (
    <DialogForm
      trigger={
        <Button size="sm" variant={issueId ? "ghost" : "primary"}>
          <Wrench className="h-3.5 w-3.5" /> {label}
        </Button>
      }
      title="Intervention d'entretien ou de réparation"
      description="Le kilométrage saisi devient un relevé de compteur et sert aux rappels d'entretien."
      action={(fd) => addService(vehicleId, fd)}
      success="Intervention enregistrée"
      submitLabel="Enregistrer"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type *">
          <select name="type_id" required defaultValue={issueId ? (types.find((t) => /parat/i.test(t.libelle))?.id ?? "") : ""} className={inputClass}>
            <option value="">Choisir…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.libelle}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date *">
          <input type="date" name="date_intervention" required defaultValue={today()} max={today()} className={inputClass} />
        </Field>
        <Field label="Kilométrage">
          <input name="km" inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Coût (FCFA)">
          <input name="cout" inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Garage">
          <input name="garage" maxLength={120} className={inputClass} />
        </Field>
        <Field label="Clôt la panne">
          <select name="issue_id" defaultValue={issueId ?? ""} className={inputClass}>
            <option value="">Aucune</option>
            {openIssues.map((i) => (
              <option key={i.id} value={i.id}>
                {i.description.slice(0, 60)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Travaux réalisés" className="sm:col-span-2">
          <textarea name="description" rows={2} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Facture" className="sm:col-span-2">
          <input type="file" name="fichier" accept="image/*,application/pdf" className="text-sm" />
        </Field>
      </div>
    </DialogForm>
  );
}

export { ActionForm };
