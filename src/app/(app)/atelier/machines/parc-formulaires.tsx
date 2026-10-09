"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/app/(app)/parametres/couleurs/confirm-delete";
import { ETATS_ECRAN, SECHAGES, TYPES_MACHINE, type EcranCadre, type EtatEcran, type Machine } from "@/lib/atelier/parc";
import { changerEtatEcran, enregistrerEcran, enregistrerMachine, supprimerEcran, supprimerMachine } from "./actions";

const champ = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));

function Champ({ label, children, aide }: { label: string; children: React.ReactNode; aide?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {aide && <span className="mt-0.5 block text-[11px] text-foreground-muted">{aide}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------------ */
/* Machines                                                                 */
/* ------------------------------------------------------------------------ */

function FormulaireMachine({ machine, voitCouts, onFini }: { machine: Machine | null; voitCouts: boolean; onFini: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    nom: machine?.nom ?? "",
    type: machine?.type ?? "carrousel_manuel",
    nb_stations: String(machine?.nbStations ?? 6),
    nb_tetes: String(machine?.nbTetes ?? 6),
    format_max_l_cm: machine?.formatMaxLCm != null ? String(machine.formatMaxLCm) : "",
    format_max_h_cm: machine?.formatMaxHCm != null ? String(machine.formatMaxHCm) : "",
    sechage: machine?.sechage ?? "flash",
    cadence_pieces_h: machine?.cadencePiecesH != null ? String(machine.cadencePiecesH) : "",
    notes: machine?.notes ?? "",
    active: machine?.active ?? true,
    cout_horaire: machine?.coutHoraire != null ? String(machine.coutHoraire) : "",
  });
  const maj = (x: Partial<typeof v>) => setV({ ...v, ...x });

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerMachine(machine?.id ?? null, {
        nom: v.nom,
        type: v.type,
        nb_stations: Number(v.nb_stations),
        nb_tetes: Number(v.nb_tetes),
        format_max_l_cm: num(v.format_max_l_cm),
        format_max_h_cm: num(v.format_max_h_cm),
        sechage: v.sechage,
        cadence_pieces_h: num(v.cadence_pieces_h),
        notes: v.notes,
        active: v.active,
        ...(voitCouts ? { cout_horaire: num(v.cout_horaire) } : {}),
      });
      if (res.error) toast.error("Machine non enregistrée", { description: res.error });
      else {
        toast.success("Machine enregistrée");
        onFini();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Nom">
          <input value={v.nom} maxLength={80} onChange={(e) => maj({ nom: e.target.value })} placeholder="Carrousel 6 couleurs" className={champ} />
        </Champ>
        <Champ label="Type">
          <select value={v.type} onChange={(e) => maj({ type: e.target.value as Machine["type"] })} className={champ}>
            {Object.entries(TYPES_MACHINE).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Stations (bras)">
          <input inputMode="numeric" value={v.nb_stations} onChange={(e) => maj({ nb_stations: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Têtes (couleurs par passage)">
          <input inputMode="numeric" value={v.nb_tetes} onChange={(e) => maj({ nb_tetes: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Format d'impression max (cm)" aide="Largeur × hauteur de la zone imprimable.">
          <span className="flex items-center gap-1.5">
            <input inputMode="decimal" value={v.format_max_l_cm} placeholder="40" onChange={(e) => maj({ format_max_l_cm: e.target.value })} className={champ} />
            ×
            <input inputMode="decimal" value={v.format_max_h_cm} placeholder="50" onChange={(e) => maj({ format_max_h_cm: e.target.value })} className={champ} />
          </span>
        </Champ>
        <Champ label="Séchage">
          <select value={v.sechage} onChange={(e) => maj({ sechage: e.target.value as Machine["sechage"] })} className={champ}>
            {Object.entries(SECHAGES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Cadence (pièces/heure)" aide="Toutes couleurs comprises : un tour de carrousel.">
          <input inputMode="numeric" value={v.cadence_pieces_h} placeholder="120" onChange={(e) => maj({ cadence_pieces_h: e.target.value })} className={champ} />
        </Champ>
        {voitCouts && (
          <Champ label="Coût horaire machine + équipe (F)" aide="Direction seulement. Remplace le taux horaire de l'atelier dans le prix de revient.">
            <input inputMode="decimal" value={v.cout_horaire} placeholder="—" onChange={(e) => maj({ cout_horaire: e.target.value })} className={champ} />
          </Champ>
        )}
        <Champ label="Notes">
          <input value={v.notes} maxLength={500} onChange={(e) => maj({ notes: e.target.value })} className={champ} />
        </Champ>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={v.active} onChange={(e) => maj({ active: e.target.checked })} />
          Machine en service
        </label>
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

export function BoutonMachine({ machine, voitCouts }: { machine?: Machine; voitCouts: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      {machine ? (
        <button type="button" onClick={() => setOuvert(true)} aria-label={`Modifier ${machine.nom}`} className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground">
          <Pencil className="h-4 w-4" />
        </button>
      ) : (
        <Button type="button" size="sm" onClick={() => setOuvert(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter une machine
        </Button>
      )}
      <Dialog open={ouvert} onOpenChange={setOuvert} title={machine ? `Modifier ${machine.nom}` : "Nouvelle machine"} size="lg">
        <FormulaireMachine machine={machine ?? null} voitCouts={voitCouts} onFini={() => setOuvert(false)} />
      </Dialog>
    </>
  );
}

export function SupprimerMachine({ machine }: { machine: Machine }) {
  return (
    <ConfirmDelete
      label={machine.nom}
      description="La machine est retirée du parc. Pour la garder dans l'historique, décochez plutôt « Machine en service »."
      onConfirm={() => supprimerMachine(machine.id)}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Écrans                                                                   */
/* ------------------------------------------------------------------------ */

function FormulaireEcran({ ecran, onFini }: { ecran: EcranCadre | null; onFini: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    code: ecran?.code ?? "",
    largeur_cm: ecran ? String(ecran.largeurCm) : "",
    hauteur_cm: ecran ? String(ecran.hauteurCm) : "",
    maillage: ecran ? String(ecran.maillage) : "77",
    couleur_maille: ecran?.couleurMaille ?? "blanche",
    etat: ecran?.etat ?? "disponible",
    travail: ecran?.travail ?? "",
    emplacement: ecran?.emplacement ?? "",
    notes: ecran?.notes ?? "",
  });
  const maj = (x: Partial<typeof v>) => setV({ ...v, ...x });

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerEcran(ecran?.id ?? null, {
        code: v.code,
        largeur_cm: num(v.largeur_cm) ?? 0,
        hauteur_cm: num(v.hauteur_cm) ?? 0,
        maillage: Number(v.maillage),
        couleur_maille: v.couleur_maille,
        etat: v.etat,
        travail: v.travail,
        emplacement: v.emplacement,
        notes: v.notes,
      });
      if (res.error) toast.error("Écran non enregistré", { description: res.error });
      else {
        toast.success("Écran enregistré");
        onFini();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Code">
          <input value={v.code} maxLength={30} onChange={(e) => maj({ code: e.target.value })} placeholder="E-077-01" className={`${champ} font-mono`} />
        </Champ>
        <Champ label="Format intérieur du cadre (cm)">
          <span className="flex items-center gap-1.5">
            <input inputMode="decimal" value={v.largeur_cm} placeholder="50" onChange={(e) => maj({ largeur_cm: e.target.value })} className={champ} />
            ×
            <input inputMode="decimal" value={v.hauteur_cm} placeholder="60" onChange={(e) => maj({ hauteur_cm: e.target.value })} className={champ} />
          </span>
        </Champ>
        <Champ label="Maillage (fils/cm)" aide="43 : aplats épais, blanc couvrant · 77 : polyvalent · 90-120 : trame fine.">
          <input inputMode="numeric" value={v.maillage} onChange={(e) => maj({ maillage: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Couleur de la maille" aide="Jaune : limite la diffusion de la lumière (trames fines).">
          <select value={v.couleur_maille} onChange={(e) => maj({ couleur_maille: e.target.value as EcranCadre["couleurMaille"] })} className={champ}>
            <option value="blanche">Blanche</option>
            <option value="jaune">Jaune</option>
          </select>
        </Champ>
        <Champ label="État">
          <select value={v.etat} onChange={(e) => maj({ etat: e.target.value as EtatEcran })} className={champ}>
            {Object.entries(ETATS_ECRAN).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Champ>
        {v.etat === "insole" && (
          <Champ label="Travail insolé">
            <input value={v.travail} maxLength={120} placeholder="OF-2026-012 · rouge" onChange={(e) => maj({ travail: e.target.value })} className={champ} />
          </Champ>
        )}
        <Champ label="Emplacement">
          <input value={v.emplacement} maxLength={60} placeholder="Rack A" onChange={(e) => maj({ emplacement: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Notes">
          <input value={v.notes} maxLength={500} onChange={(e) => maj({ notes: e.target.value })} className={champ} />
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

export function BoutonEcran({ ecran }: { ecran?: EcranCadre }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      {ecran ? (
        <button type="button" onClick={() => setOuvert(true)} aria-label={`Modifier ${ecran.code}`} className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground">
          <Pencil className="h-4 w-4" />
        </button>
      ) : (
        <Button type="button" size="sm" onClick={() => setOuvert(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un écran
        </Button>
      )}
      <Dialog open={ouvert} onOpenChange={setOuvert} title={ecran ? `Modifier ${ecran.code}` : "Nouvel écran"} size="lg">
        <FormulaireEcran ecran={ecran ?? null} onFini={() => setOuvert(false)} />
      </Dialog>
    </>
  );
}

export function SupprimerEcran({ ecran }: { ecran: EcranCadre }) {
  return <ConfirmDelete label={ecran.code} description="L'écran est retiré du parc." onConfirm={() => supprimerEcran(ecran.id)} />;
}

/** Changement d'état sur place ; « Insolé » demande le travail porté par l'écran. */
export function EtatEcranSelect({ ecran, editable }: { ecran: EcranCadre; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [travail, setTravail] = useState(ecran.travail ?? "");
  const [attenteTravail, setAttenteTravail] = useState(false);
  const ton: Record<EtatEcran, string> = {
    disponible: "text-success",
    insole: "text-brand",
    a_recuperer: "text-warning",
    hors_service: "text-danger",
  };

  function changer(etat: EtatEcran, t: string | null) {
    startTransition(async () => {
      const res = await changerEtatEcran(ecran.id, etat, t);
      if (res.error) toast.error("État non changé", { description: res.error });
      else {
        setAttenteTravail(false);
        router.refresh();
      }
    });
  }

  if (!editable) return <span className={`text-xs font-medium ${ton[ecran.etat]}`}>{ETATS_ECRAN[ecran.etat]}</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <select
        value={attenteTravail ? "insole" : ecran.etat}
        disabled={pending}
        onChange={(e) => {
          const etat = e.target.value as EtatEcran;
          if (etat === "insole") setAttenteTravail(true);
          else changer(etat, null);
        }}
        className={`h-7 rounded-md border border-border bg-surface px-1.5 text-xs font-medium ${ton[attenteTravail ? "insole" : ecran.etat]}`}
      >
        {Object.entries(ETATS_ECRAN).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {attenteTravail && (
        <>
          <input
            autoFocus
            value={travail}
            maxLength={120}
            placeholder="Travail (ex. OF-012 · rouge)"
            onChange={(e) => setTravail(e.target.value)}
            className="h-7 w-48 rounded-md border border-border bg-surface px-1.5 text-xs"
          />
          <Button type="button" size="sm" loading={pending} onClick={() => changer("insole", travail)}>
            OK
          </Button>
        </>
      )}
    </span>
  );
}
