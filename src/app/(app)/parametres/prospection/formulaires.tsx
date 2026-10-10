"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDelete } from "@/app/(app)/parametres/couleurs/confirm-delete";
import { JOURS_SEMAINE, RECEPTION_CANAL, TYPES_JOUR, type TypeJour } from "@/lib/prospection/constantes";
import type { CanalProspection, Commercial, ReglagesProspection } from "@/lib/prospection/serveur";
import {
  ajouterJourFerie,
  enregistrerCalendrier,
  enregistrerCanal,
  enregistrerCommercial,
  supprimerCommercial,
  supprimerJourFerie,
} from "./actions";

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

export interface OptionCompte {
  id: string;
  nom: string;
  email: string;
}
export interface OptionSage {
  coNo: number;
  nom: string;
}

/* ------------------------------------------------------------------------ */
/* Commerciaux                                                              */
/* ------------------------------------------------------------------------ */

function FormulaireCommercial({
  commercial,
  comptes,
  representants,
  onFini,
}: {
  commercial: Commercial | null;
  comptes: OptionCompte[];
  representants: OptionSage[];
  onFini: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    app_user_id: commercial?.appUserId ?? "",
    sage_representant_no: commercial?.sageRepresentantNo != null ? String(commercial.sageRepresentantNo) : "",
    whatsapp: commercial?.whatsapp ?? "",
    telegram_chat_id: commercial?.telegramChatId ?? "",
    email_pro: commercial?.emailPro ?? "",
    zone: commercial?.zone ?? "",
    soumis_obligation: commercial?.soumisObligation ?? true,
    actif: commercial?.actif ?? true,
    notes: commercial?.notes ?? "",
  });
  const maj = (x: Partial<typeof v>) => setV({ ...v, ...x });

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerCommercial(commercial?.id ?? null, {
        ...v,
        sage_representant_no: v.sage_representant_no ? Number(v.sage_representant_no) : null,
      });
      if (res.error) toast.error("Commercial non enregistré", { description: res.error });
      else {
        toast.success("Commercial enregistré");
        onFini();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Compte Seritex">
          {commercial ? (
            <input value={`${commercial.nom} · ${commercial.email}`} disabled className={`${champ} opacity-70`} />
          ) : (
            <select
              value={v.app_user_id}
              onChange={(e) => {
                const compte = comptes.find((c) => c.id === e.target.value);
                maj({ app_user_id: e.target.value, email_pro: v.email_pro || compte?.email || "" });
              }}
              className={champ}
            >
              <option value="">— Choisir —</option>
              {comptes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom} · {c.email}
                </option>
              ))}
            </select>
          )}
        </Champ>
        <Champ label="Collaborateur Sage" aide="Rattache les clients Sage dont il est le représentant.">
          <select value={v.sage_representant_no} onChange={(e) => maj({ sage_representant_no: e.target.value })} className={champ}>
            <option value="">— Aucun —</option>
            {representants.map((r) => (
              <option key={r.coNo} value={r.coNo}>
                {r.nom} (n° {r.coNo})
              </option>
            ))}
          </select>
        </Champ>
        <Champ label="Numéro WhatsApp" aide="Celui depuis lequel il envoie ses rapports. 07 00 00 00 01 devient +225 0700000001.">
          <input value={v.whatsapp} inputMode="tel" placeholder="07 00 00 00 01" onChange={(e) => maj({ whatsapp: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Identifiant Telegram (chat id)" aide="Facultatif. Donné par le bot au premier message.">
          <input value={v.telegram_chat_id} inputMode="numeric" onChange={(e) => maj({ telegram_chat_id: e.target.value })} className={champ} />
        </Champ>
        <Champ label="E-mail professionnel" aide="Boîte suivie par le tri des e-mails.">
          <input value={v.email_pro} type="email" onChange={(e) => maj({ email_pro: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Zone / secteur">
          <input value={v.zone} maxLength={80} placeholder="Plateau, Cocody…" onChange={(e) => maj({ zone: e.target.value })} className={champ} />
        </Champ>
        <Champ label="Notes">
          <input value={v.notes} maxLength={500} onChange={(e) => maj({ notes: e.target.value })} className={champ} />
        </Champ>
        <div className="space-y-2 self-end pb-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.soumis_obligation} onChange={(e) => maj({ soumis_obligation: e.target.checked })} />
            Rapport quotidien obligatoire
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={v.actif} onChange={(e) => maj({ actif: e.target.checked })} />
            Commercial actif
          </label>
        </div>
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

export function BoutonCommercial({
  commercial,
  comptes,
  representants,
}: {
  commercial?: Commercial;
  comptes: OptionCompte[];
  representants: OptionSage[];
}) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      {commercial ? (
        <button type="button" onClick={() => setOuvert(true)} aria-label={`Modifier ${commercial.nom}`} className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground">
          <Pencil className="h-4 w-4" />
        </button>
      ) : (
        <Button type="button" size="sm" onClick={() => setOuvert(true)}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un commercial
        </Button>
      )}
      <Dialog open={ouvert} onOpenChange={setOuvert} title={commercial ? `Modifier ${commercial.nom}` : "Nouveau commercial"} size="lg">
        <FormulaireCommercial commercial={commercial ?? null} comptes={comptes} representants={representants} onFini={() => setOuvert(false)} />
      </Dialog>
    </>
  );
}

export function SupprimerCommercial({ commercial }: { commercial: Commercial }) {
  return (
    <ConfirmDelete
      label={commercial.nom}
      description="Le compte n'est plus suivi par le module Prospection. Pour garder son historique, décochez plutôt « Commercial actif »."
      onConfirm={() => supprimerCommercial(commercial.id)}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Calendrier                                                               */
/* ------------------------------------------------------------------------ */

export function FormulaireCalendrier({ reglages, editable }: { reglages: ReglagesProspection; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [types, setTypes] = useState<TypeJour[]>(reglages.typesJour);
  const [rappel, setRappel] = useState(reglages.heureRappel);
  const [alerte, setAlerte] = useState(reglages.heureAlerte);

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerCalendrier({ types_jour: types, heure_rappel: rappel, heure_alerte: alerte });
      if (res.error) toast.error("Calendrier non enregistré", { description: res.error });
      else {
        toast.success("Calendrier enregistré");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {JOURS_SEMAINE.map((jour, i) => (
          <Champ key={jour} label={jour}>
            <select
              value={types[i]}
              disabled={!editable}
              onChange={(e) => setTypes(types.map((t, j) => (j === i ? (e.target.value as TypeJour) : t)))}
              className={champ}
            >
              {Object.entries(TYPES_JOUR).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Champ>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Champ label="Rappel au commercial" aide="Le jour même, s'il n'a encore envoyé aucun rapport.">
          <input type="time" value={rappel} disabled={!editable} onChange={(e) => setRappel(e.target.value)} className={champ} />
        </Champ>
        <Champ label="Alerte commercial + direction" aide="Le lendemain matin, si la journée est restée sans rapport.">
          <input type="time" value={alerte} disabled={!editable} onChange={(e) => setAlerte(e.target.value)} className={champ} />
        </Champ>
      </div>
      {editable && (
        <div className="flex justify-end">
          <Button type="button" size="sm" loading={pending} onClick={enregistrer}>
            Enregistrer le calendrier
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Jours fériés                                                             */
/* ------------------------------------------------------------------------ */

export function AjoutJourFerie() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [jour, setJour] = useState("");
  const [libelle, setLibelle] = useState("");

  function ajouter() {
    startTransition(async () => {
      const res = await ajouterJourFerie({ jour, libelle });
      if (res.error) toast.error("Jour férié non ajouté", { description: res.error });
      else {
        setJour("");
        setLibelle("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Champ label="Date">
        <input type="date" value={jour} onChange={(e) => setJour(e.target.value)} className={champ} />
      </Champ>
      <div className="min-w-48 flex-1">
        <Champ label="Libellé">
          <input value={libelle} maxLength={80} placeholder="Tabaski" onChange={(e) => setLibelle(e.target.value)} className={champ} />
        </Champ>
      </div>
      <Button type="button" size="sm" loading={pending} disabled={!jour || !libelle.trim()} onClick={ajouter}>
        <Plus className="h-3.5 w-3.5" /> Ajouter
      </Button>
    </div>
  );
}

export function SupprimerJourFerie({ jour, libelle }: { jour: string; libelle: string }) {
  return (
    <ConfirmDelete
      label={libelle}
      description="Ce jour redevient un jour normal : un rapport sera attendu s'il tombe sur un jour de visites."
      onConfirm={() => supprimerJourFerie(jour)}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Canaux                                                                   */
/* ------------------------------------------------------------------------ */

export function LigneCanal({ canal, editable }: { canal: CanalProspection; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({
    reception_active: canal.receptionActive,
    envoi_rappels: canal.envoiRappels,
    envoi_alertes: canal.envoiAlertes,
    identifiant: canal.identifiant ?? "",
  });
  const modifie =
    v.reception_active !== canal.receptionActive ||
    v.envoi_rappels !== canal.envoiRappels ||
    v.envoi_alertes !== canal.envoiAlertes ||
    v.identifiant !== (canal.identifiant ?? "");

  function enregistrer() {
    startTransition(async () => {
      const res = await enregistrerCanal({ canal: canal.canal, ...v });
      if (res.error) toast.error("Canal non enregistré", { description: res.error });
      else {
        toast.success(`${canal.libelle} enregistré`);
        router.refresh();
      }
    });
  }

  const caseACocher = (cle: "reception_active" | "envoi_rappels" | "envoi_alertes") => (
    <input type="checkbox" checked={v[cle]} disabled={!editable} onChange={(e) => setV({ ...v, [cle]: e.target.checked })} aria-label={cle} />
  );

  return (
    <tr>
      <td className="px-5 py-2.5">
        <p className="font-medium text-foreground">{canal.libelle}</p>
        <p className="text-xs text-foreground-muted">{RECEPTION_CANAL[canal.canal]}</p>
      </td>
      <td className="px-3 py-2.5 text-center">{caseACocher("reception_active")}</td>
      <td className="px-3 py-2.5 text-center">{caseACocher("envoi_rappels")}</td>
      <td className="px-3 py-2.5 text-center">{caseACocher("envoi_alertes")}</td>
      <td className="px-3 py-2.5">
        <input
          value={v.identifiant}
          maxLength={120}
          disabled={!editable}
          placeholder={canal.canal === "whatsapp" ? "Numéro dédié" : canal.canal === "telegram" ? "@nom_du_bot" : ""}
          onChange={(e) => setV({ ...v, identifiant: e.target.value })}
          className="h-8 w-full min-w-40 rounded-md border border-border bg-surface px-2 text-xs"
        />
      </td>
      <td className="px-5 py-2.5 text-right">
        {editable && modifie && (
          <Button type="button" size="sm" loading={pending} onClick={enregistrer}>
            Enregistrer
          </Button>
        )}
      </td>
    </tr>
  );
}
