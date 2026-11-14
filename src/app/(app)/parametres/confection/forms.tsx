"use client";

import { useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAgent, creerPostes, deletePoste, removeAgent, saveChaine, savePoste, saveTypeMachine } from "./actions";

export type SectionRow = { id: string; name: string };
export type TypeMachineRow = { id: string; nom: string; active: boolean };
export type PosteRow = { id: string; chaine_id: string | null; section_id: string; numero: number; libelle: string | null; type_machine_id: string | null; actif: boolean };
export type AgentRow = { id: string; chaine_id: string; user_id: string; nom: string };
export type ChaineRow = { id: string; section_id: string; nom: string; code: string; type: "permanente" | "support"; minutes_jour: number; active: boolean };
export type CompteRow = { id: string; nom: string; role: string };

const input = "h-8 rounded-md border border-border bg-surface px-2 text-sm";

/** Ligne de réglage enregistrée d'un clic (même principe que Paramètres > Véhicules). */
function InlineForm({
  action,
  children,
  label = "Enregistrer",
  reset = false,
  className = "px-5 py-3",
}: {
  action: (fd: FormData) => Promise<{ error?: string }>;
  children: ReactNode;
  label?: ReactNode;
  reset?: boolean;
  className?: string;
}) {
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
      className={`flex flex-wrap items-end gap-3 ${className}`}
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

export function ChaineForm({ c, sections, sectionId }: { c?: ChaineRow; sections: SectionRow[]; sectionId?: string }) {
  return (
    <InlineForm action={saveChaine} label={c ? "Enregistrer" : "Créer la chaîne"} reset={!c}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <L label="Nom">
        <input name="nom" defaultValue={c?.nom} placeholder="Bonneterie 1" required className={`${input} w-44`} />
      </L>
      <L label="Code (étiquettes)">
        <input name="code" defaultValue={c?.code} placeholder="BON-1" required maxLength={12} className={`${input} w-24 font-mono uppercase`} />
      </L>
      <L label="Section">
        <select name="section_id" defaultValue={c?.section_id ?? sectionId} className={input}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </L>
      <L label="Type">
        <select name="type" defaultValue={c?.type ?? "permanente"} className={input}>
          <option value="permanente">Permanente</option>
          <option value="support">Support</option>
        </select>
      </L>
      <L label="Minutes de travail / jour">
        <input name="minutes_jour" type="number" min={60} max={1440} defaultValue={c?.minutes_jour ?? 480} className={`${input} w-24`} />
      </L>
      {c && (
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={c.active} /> Active
        </label>
      )}
    </InlineForm>
  );
}

export function PostesPanel({ chaine, postes, types }: { chaine: ChaineRow; postes: PosteRow[]; types: TypeMachineRow[] }) {
  return (
    <div className="space-y-1">
      {postes.length === 0 ? (
        <InlineForm action={creerPostes} label="Créer les postes" className="py-1">
          <input type="hidden" name="chaine_id" value={chaine.id} />
          <input type="hidden" name="section_id" value={chaine.section_id} />
          <L label="Combien de postes dans cette chaîne ?">
            <input name="nombre" type="number" min={1} max={200} defaultValue={12} className={`${input} w-24`} />
          </L>
        </InlineForm>
      ) : (
        postes.map((p) => <PosteForm key={p.id} p={p} types={types} />)
      )}
      <InlineForm action={savePoste} label="Ajouter un poste" reset className="py-1">
        <input type="hidden" name="chaine_id" value={chaine.id} />
        <input type="hidden" name="section_id" value={chaine.section_id} />
        <L label="N°">
          <input name="numero" type="number" min={1} max={999} defaultValue={postes.length ? Math.max(...postes.map((p) => p.numero)) + 1 : 1} className={`${input} w-16`} />
        </L>
        <L label="Libellé (facultatif)">
          <input name="libelle" className={`${input} w-44`} />
        </L>
        <TypeSelect types={types} />
      </InlineForm>
    </div>
  );
}

function TypeSelect({ types, value }: { types: TypeMachineRow[]; value?: string | null }) {
  return (
    <L label="Machine">
      <select name="type_machine_id" defaultValue={value ?? ""} className={input}>
        <option value="">Poste manuel / non précisé</option>
        {types.filter((t) => t.active || t.id === value).map((t) => (
          <option key={t.id} value={t.id}>
            {t.nom}
          </option>
        ))}
      </select>
    </L>
  );
}

function PosteForm({ p, types }: { p: PosteRow; types: TypeMachineRow[] }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <InlineForm action={savePoste} className="py-1">
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="chaine_id" value={p.chaine_id ?? ""} />
        <input type="hidden" name="section_id" value={p.section_id} />
        <L label="N°">
          <input name="numero" type="number" min={1} max={999} defaultValue={p.numero} className={`${input} w-16`} />
        </L>
        <L label="Libellé">
          <input name="libelle" defaultValue={p.libelle ?? ""} className={`${input} w-44`} />
        </L>
        <TypeSelect types={types} value={p.type_machine_id} />
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="actif" defaultChecked={p.actif} /> Actif
        </label>
      </InlineForm>
      <InlineForm action={deletePoste} label={<Trash2 className="h-3.5 w-3.5" />} className="py-1">
        <input type="hidden" name="id" value={p.id} />
      </InlineForm>
    </div>
  );
}

export function PostesCommunsPanel({ section, postes, types }: { section: SectionRow; postes: PosteRow[]; types: TypeMachineRow[] }) {
  return (
    <div className="space-y-1 px-5 py-3">
      {postes.map((p) => (
        <PosteForm key={p.id} p={p} types={types} />
      ))}
      <InlineForm action={savePoste} label="Ajouter un poste commun" reset className="py-1">
        <input type="hidden" name="section_id" value={section.id} />
        <L label="N°">
          <input name="numero" type="number" min={1} max={999} defaultValue={postes.length ? Math.max(...postes.map((p) => p.numero)) + 1 : 1} className={`${input} w-16`} />
        </L>
        <L label="Libellé">
          <input name="libelle" placeholder="Pose des étiquettes" className={`${input} w-52`} />
        </L>
        <TypeSelect types={types} />
      </InlineForm>
    </div>
  );
}

export function AgentsPanel({ chaine, agents, comptes }: { chaine: ChaineRow; agents: AgentRow[]; comptes: CompteRow[] }) {
  const libres = comptes.filter((c) => !agents.some((a) => a.user_id === c.id));
  return (
    <div className="space-y-1">
      {agents.length === 0 && <p className="text-sm text-foreground-muted">Aucun agent : seuls les responsables peuvent ravitailler cette chaîne.</p>}
      {agents.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-sm">
          <span className="font-medium">{a.nom}</span>
          <InlineForm action={removeAgent} label="Retirer" className="py-0">
            <input type="hidden" name="id" value={a.id} />
          </InlineForm>
        </div>
      ))}
      <InlineForm action={addAgent} label="Ajouter l'agent" reset className="py-1">
        <input type="hidden" name="chaine_id" value={chaine.id} />
        <L label="Compte de l'agent">
          <select name="user_id" defaultValue="" className={`${input} w-64`} required>
            <option value="" disabled>
              Choisir un compte…
            </option>
            {libres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nom} — {c.role}
              </option>
            ))}
          </select>
        </L>
      </InlineForm>
    </div>
  );
}

export function TypeMachineForm({ t }: { t?: TypeMachineRow }) {
  return (
    <InlineForm action={saveTypeMachine} label={t ? "Enregistrer" : "Ajouter"} reset={!t}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <L label="Type de machine">
        <input name="nom" defaultValue={t?.nom} placeholder="Surjeteuse 4 fils" required className={`${input} w-64`} />
      </L>
      {t && (
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={t.active} /> Active
        </label>
      )}
    </InlineForm>
  );
}
