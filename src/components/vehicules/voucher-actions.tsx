"use client";

import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelFuelVoucher, justifyFuelVoucher, refuseFuelVoucher, validateFuelVoucher } from "@/app/(app)/vehicules/bons/actions";
import { ActionButton, DialogForm, Field, inputClass } from "./form-kit";

/** Boutons du circuit d'un bon : valider / refuser (logistique), annuler, justifier. */
export function VoucherActions({
  id,
  statut,
  canValidate,
  canModify,
  justification,
}: {
  id: string;
  statut: string;
  canValidate: boolean;
  canModify: boolean;
  justification: { date: string; heure: string; montant: number | null; litres: number | null; km: number | null; montantDemande: number; kmDemande: number | null };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {statut === "demande" && canValidate && (
        <>
          <ActionButton action={() => validateFuelVoucher(id)} success="Bon validé : il peut être imprimé" variant="primary">
            Valider le bon
          </ActionButton>
          <ActionButton action={(m) => refuseFuelVoucher(id, m)} success="Demande refusée" askReason="Motif du refus" variant="secondary">
            Refuser
          </ActionButton>
        </>
      )}
      {(statut === "valide" || statut === "justifie") && canModify && (
        <DialogForm
          trigger={
            <Button size="sm" variant={statut === "valide" ? "primary" : "secondary"}>
              <Receipt className="h-3.5 w-3.5" /> {statut === "valide" ? "Saisir le ticket du plein" : "Corriger la justification"}
            </Button>
          }
          title="Justification du plein"
          description="Recopiez le ticket de la station. Le kilométrage devient un relevé de compteur ; la consommation et les écarts sont calculés aussitôt."
          action={(fd) => justifyFuelVoucher(id, fd)}
          success="Plein enregistré"
          submitLabel="Enregistrer le plein"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date du plein *">
              <input type="date" name="date_plein" required defaultValue={justification.date} max={new Date().toISOString().slice(0, 10)} className={inputClass} />
            </Field>
            <Field label="Heure">
              <input type="time" name="heure_plein" defaultValue={justification.heure} className={inputClass} />
            </Field>
            <Field label="Montant du ticket (FCFA) *" hint={`Bon de ${new Intl.NumberFormat("fr-FR").format(justification.montantDemande)} FCFA`}>
              <input name="montant_reel" required inputMode="numeric" defaultValue={justification.montant ?? ""} className={inputClass} />
            </Field>
            <Field label="Litres *">
              <input name="litres" required inputMode="decimal" defaultValue={justification.litres ?? ""} className={inputClass} />
            </Field>
            <Field label="Kilométrage au compteur *" hint={justification.kmDemande !== null ? `Au départ : ${new Intl.NumberFormat("fr-FR").format(justification.kmDemande)} km` : undefined}>
              <input name="km_plein" required inputMode="numeric" defaultValue={justification.km ?? ""} className={inputClass} />
            </Field>
            <Field label="Photo du ticket">
              <input type="file" name="fichier" accept="image/*,application/pdf" className="text-sm" />
            </Field>
          </div>
        </DialogForm>
      )}
      {(statut === "demande" || statut === "valide") && (canModify || canValidate) && (
        <ActionButton action={(m) => cancelFuelVoucher(id, m)} success="Bon annulé" askReason="Motif de l'annulation" variant="ghost">
          Annuler le bon
        </ActionButton>
      )}
    </div>
  );
}
