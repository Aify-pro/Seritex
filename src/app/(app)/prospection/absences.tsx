"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/app/(app)/parametres/couleurs/confirm-delete";
import { MOTIFS_ABSENCE, type MotifAbsence } from "@/lib/prospection/constantes";
import type { Absence } from "@/lib/prospection/serveur";
import { declarerAbsence, retirerAbsence, traiterAbsence } from "./actions";

const champ = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";

function Champ({ label, children, aide }: { label: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {aide && <span className="mt-0.5 block text-[11px] text-foreground-muted">{aide}</span>}
    </label>
  );
}

function FormulaireAbsence({
  commerciaux,
  aujourdhui,
  onFini,
}: {
  /** Renseigné pour la direction : elle peut saisir pour un commercial. */
  commerciaux: { appUserId: string; nom: string }[] | null;
  aujourdhui: string;
  onFini: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ app_user_id: "", debut: aujourdhui, fin: aujourdhui, motif: "permission" as MotifAbsence, commentaire: "" });
  const maj = (x: Partial<typeof v>) => setV({ ...v, ...x });

  function enregistrer() {
    startTransition(async () => {
      const res = await declarerAbsence({ ...v, app_user_id: v.app_user_id || null });
      if (res.error) toast.error("Absence non enregistrée", { description: res.error });
      else {
        toast.success(v.app_user_id ? "Absence enregistrée et validée" : "Absence déclarée, en attente de validation");
        onFini();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {commerciaux && (
          <div className="sm:col-span-2">
            <Champ label="Commercial" aide="Saisie par la direction pour un commercial : l'absence est validée d'office.">
              <select value={v.app_user_id} onChange={(e) => maj({ app_user_id: e.target.value })} className={champ}>
                <option value="">Moi-même</option>
                {commerciaux.map((c) => (
                  <option key={c.appUserId} value={c.appUserId}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </Champ>
          </div>
        )}
        <Champ label="Du">
          <input type="date" value={v.debut} onChange={(e) => maj({ debut: e.target.value, fin: v.fin < e.target.value ? e.target.value : v.fin })} className={champ} />
        </Champ>
        <Champ label="Au (inclus)">
          <input type="date" value={v.fin} min={v.debut} onChange={(e) => maj({ fin: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Motif">
          <select value={v.motif} onChange={(e) => maj({ motif: e.target.value as MotifAbsence })} className={champ}>
            {Object.entries(MOTIFS_ABSENCE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Commentaire">
          <input value={v.commentaire} maxLength={500} onChange={(e) => maj({ commentaire: e.target.value })} className={champ} />
        </Champ>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onFini} disabled={pending}>
          Annuler
        </Button>
        <Button type="button" size="sm" loading={pending} onClick={enregistrer}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

export function BoutonAbsence({ commerciaux, aujourdhui }: { commerciaux: { appUserId: string; nom: string }[] | null; aujourdhui: string }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOuvert(true)}>
        <Plus className="h-3.5 w-3.5" /> Déclarer une absence
      </Button>
      <Dialog open={ouvert} onOpenChange={setOuvert} title="Absence" size="md">
        <FormulaireAbsence commerciaux={commerciaux} aujourdhui={aujourdhui} onFini={() => setOuvert(false)} />
      </Dialog>
    </>
  );
}

export function TraiterAbsence({ absence }: { absence: Absence }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [refus, setRefus] = useState(false);
  const [motif, setMotif] = useState("");

  function traiter(decision: "validee" | "refusee") {
    startTransition(async () => {
      const res = await traiterAbsence(absence.id, decision, motif);
      if (res.error) toast.error("Absence non traitée", { description: res.error });
      else {
        toast.success(decision === "validee" ? "Absence validée" : "Absence refusée");
        setRefus(false);
        router.refresh();
      }
    });
  }

  if (refus) {
    return (
      <span className="flex items-center gap-1.5">
        <input
          autoFocus
          value={motif}
          maxLength={300}
          placeholder="Motif du refus"
          onChange={(e) => setMotif(e.target.value)}
          className="h-7 w-48 rounded-md border border-border bg-surface px-1.5 text-xs"
        />
        <Button type="button" size="sm" variant="danger" loading={pending} disabled={!motif.trim()} onClick={() => traiter("refusee")}>
          Refuser
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setRefus(false)}>
          Annuler
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button type="button" size="sm" variant="success" loading={pending} onClick={() => traiter("validee")}>
        <Check className="h-3.5 w-3.5" /> Valider
      </Button>
      <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setRefus(true)}>
        <X className="h-3.5 w-3.5" /> Refuser
      </Button>
    </span>
  );
}

export function RetirerAbsence({ absence }: { absence: Absence }) {
  return (
    <ConfirmDelete
      label={`l'absence du ${absence.debut}`}
      description="L'absence est retirée : un rapport redevient attendu ces jours-là."
      onConfirm={() => retirerAbsence(absence.id)}
    />
  );
}
