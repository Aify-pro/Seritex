"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/table";
import { LIBELLES_CATEGORIE, type CategorieRubrique } from "@/lib/personnel/livre-paie";
import { ajouterDepartement, classerAtelier, classerDepartement, classerRubrique, rattacherEmployesAuxSections, traiterAlerte } from "./actions";

const select = "h-8 rounded-md border border-border bg-surface px-2 text-xs";

/* ------------------------------------------------------------------------ */
/* Rubriques de paie                                                        */
/* ------------------------------------------------------------------------ */

export interface RubriqueVue {
  code: string;
  libelle: string | null;
  categorie: CategorieRubrique | null;
}

export function RubriquesPanel({ rubriques, peutModifier }: { rubriques: RubriqueVue[]; peutModifier: boolean }) {
  const [pending, startTransition] = useTransition();
  const aClasser = rubriques.filter((r) => r.categorie === null);

  function classer(code: string, categorie: string) {
    if (!categorie) return;
    startTransition(async () => {
      const res = await classerRubrique(code, categorie);
      if (res.error) toast.error(res.error);
      else toast.success(`Rubrique ${code} classée`);
    });
  }

  const ligne = (r: RubriqueVue) => (
    <Tr key={r.code} className={r.categorie === null ? "bg-warning-soft/40" : undefined}>
      <Td className="font-mono text-xs">{r.code}</Td>
      <Td className="text-xs">{r.libelle ?? "—"}</Td>
      <Td>
        {peutModifier ? (
          <select value={r.categorie ?? ""} disabled={pending} onChange={(e) => classer(r.code, e.target.value)} className={select} aria-label={`Catégorie de la rubrique ${r.code}`}>
            {r.categorie === null && <option value="">À classer…</option>}
            {(Object.keys(LIBELLES_CATEGORIE) as CategorieRubrique[]).map((c) => (
              <option key={c} value={c}>
                {LIBELLES_CATEGORIE[c]}
              </option>
            ))}
          </select>
        ) : r.categorie ? (
          LIBELLES_CATEGORIE[r.categorie]
        ) : (
          <Badge tone="warning">À classer</Badge>
        )}
      </Td>
    </Tr>
  );

  return (
    <div className="space-y-3">
      {aClasser.length > 0 && (
        <p className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {aClasser.length} rubrique{aClasser.length > 1 ? "s" : ""} à classer : un livre de paie qui les contient ne peut pas être validé.
        </p>
      )}
      <details open={aClasser.length > 0}>
        <summary className="cursor-pointer text-sm text-foreground-muted">{rubriques.length} rubriques connues</summary>
        <div className="mt-2">
          <Table>
            <Thead>
              <tr>
                <Th>Code Sage</Th>
                <Th>Intitulé</Th>
                <Th>Compte dans le coût comme…</Th>
              </tr>
            </Thead>
            <Tbody>{[...aClasser, ...rubriques.filter((r) => r.categorie !== null)].map(ligne)}</Tbody>
          </Table>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Ateliers de la Fiche de tâches → sections                                */
/* ------------------------------------------------------------------------ */

export interface AtelierVue {
  atelier: string;
  libelle: string | null;
  sectionId: string | null;
  structure: boolean;
  nbEmployes: number;
}

export function AteliersPanel({ ateliers, sections, peutModifier }: { ateliers: AtelierVue[]; sections: { id: string; nom: string }[]; peutModifier: boolean }) {
  const [pending, startTransition] = useTransition();
  const valeur = (a: AtelierVue) => (a.structure ? "structure" : (a.sectionId ?? "aucune"));
  const aClasser = ateliers.filter((a) => !a.structure && !a.sectionId);

  function classer(atelier: string, cible: string) {
    startTransition(async () => {
      const res = await classerAtelier(atelier, cible);
      if (res.error) toast.error(res.error);
      else toast.success("Atelier classé");
    });
  }

  function rattacher() {
    startTransition(async () => {
      const res = await rattacherEmployesAuxSections();
      if (res.error) toast.error(res.error);
      else toast.success(res.rattaches ? `${res.rattaches} employé(s) rattaché(s)` : "Rien à rattacher");
    });
  }

  return (
    <div className="space-y-3">
      <Table>
        <Thead>
          <tr>
            <Th>Atelier (Fiche de tâches)</Th>
            <Th align="right">Employés</Th>
            <Th>Section de la plateforme</Th>
          </tr>
        </Thead>
        <Tbody>
          {ateliers.map((a) => (
            <Tr key={a.atelier} className={!a.structure && !a.sectionId ? "bg-warning-soft/40" : undefined}>
              <Td className="text-xs font-medium">{a.libelle ?? a.atelier}</Td>
              <Td align="right" className="text-xs">
                {a.nbEmployes}
              </Td>
              <Td>
                {peutModifier ? (
                  <select value={valeur(a)} disabled={pending} onChange={(e) => classer(a.atelier, e.target.value)} className={select} aria-label={`Section de l'atelier ${a.libelle ?? a.atelier}`}>
                    <option value="aucune">À classer…</option>
                    <option value="structure">Structure (aucune section d&apos;atelier)</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                ) : a.structure ? (
                  "Structure"
                ) : (
                  (sections.find((s) => s.id === a.sectionId)?.nom ?? <Badge tone="warning">À classer</Badge>)
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground-muted">
          {aClasser.length > 0 ? `${aClasser.length} atelier${aClasser.length > 1 ? "s" : ""} à classer. ` : ""}
          Après un classement, rattachez les employés déjà créés : seuls ceux qui n&apos;ont pas encore de section sont touchés.
        </p>
        {peutModifier && (
          <Button type="button" variant="secondary" size="sm" loading={pending} onClick={rattacher}>
            <Link2 className="h-3.5 w-3.5" /> Rattacher les employés aux sections
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Départements de la paie Sage → sections                                  */
/* ------------------------------------------------------------------------ */

export interface DepartementVue {
  code: string;
  libelle: string;
  sectionId: string | null;
  structure: boolean;
  nbEmployes: number;
}

export function DepartementsPanel({
  departements,
  sections,
  peutModifier,
  peutCreer,
}: {
  departements: DepartementVue[];
  sections: { id: string; nom: string }[];
  peutModifier: boolean;
  peutCreer: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [nouveau, setNouveau] = useState({ code: "", libelle: "" });
  const [seulementAClasser, setSeulementAClasser] = useState(false);
  const valeur = (d: DepartementVue) => (d.structure ? "structure" : (d.sectionId ?? "aucune"));
  const estAClasser = (d: DepartementVue) => !d.structure && !d.sectionId;
  const aClasser = departements.filter(estAClasser);
  const visibles = seulementAClasser ? aClasser : departements;

  function classer(code: string, cible: string) {
    startTransition(async () => {
      const res = await classerDepartement(code, cible);
      if (res.error) toast.error(res.error);
      else toast.success("Département classé");
    });
  }

  function rattacher() {
    startTransition(async () => {
      const res = await rattacherEmployesAuxSections();
      if (res.error) toast.error(res.error);
      else toast.success(res.rattaches ? `${res.rattaches} employé(s) rattaché(s)` : "Rien à rattacher");
    });
  }

  function ajouter() {
    startTransition(async () => {
      const res = await ajouterDepartement(nouveau);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Département ajouté");
        setNouveau({ code: "", libelle: "" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground-muted">
          {departements.length} départements, dont {aClasser.length} à classer.
        </p>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <input type="checkbox" checked={seulementAClasser} onChange={(e) => setSeulementAClasser(e.target.checked)} /> Voir seulement ceux à classer
        </label>
      </div>
      <Table>
        <Thead>
          <tr>
            <Th>Code Sage</Th>
            <Th>Département</Th>
            <Th align="right">Employés</Th>
            <Th>Section de la plateforme</Th>
          </tr>
        </Thead>
        <Tbody>
          {visibles.map((d) => (
            <Tr key={d.code} className={estAClasser(d) ? "bg-warning-soft/40" : undefined}>
              <Td className="font-mono text-xs">{d.code}</Td>
              <Td className="text-xs font-medium">{d.libelle}</Td>
              <Td align="right" className="text-xs">
                {d.nbEmployes}
              </Td>
              <Td>
                {peutModifier ? (
                  <select value={valeur(d)} disabled={pending} onChange={(e) => classer(d.code, e.target.value)} className={select} aria-label={`Section du département ${d.libelle}`}>
                    <option value="aucune">À classer…</option>
                    <option value="structure">Structure (aucune section d&apos;atelier)</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                ) : d.structure ? (
                  "Structure"
                ) : (
                  (sections.find((s) => s.id === d.sectionId)?.nom ?? <Badge tone="warning">À classer</Badge>)
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {peutCreer ? (
          <div className="flex flex-wrap items-end gap-2">
            <input value={nouveau.code} onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })} placeholder="Code (ex. 041)" maxLength={10} className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-xs" aria-label="Code du nouveau département" />
            <input value={nouveau.libelle} onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })} placeholder="Nom du département" maxLength={80} className="h-8 w-52 rounded-md border border-border bg-surface px-2 text-xs" aria-label="Nom du nouveau département" />
            <Button type="button" variant="secondary" size="sm" loading={pending} disabled={!nouveau.code.trim() || !nouveau.libelle.trim()} onClick={ajouter}>
              Ajouter un département
            </Button>
          </div>
        ) : (
          <span />
        )}
        {peutModifier && (
          <Button type="button" size="sm" loading={pending} onClick={rattacher}>
            <Link2 className="h-3.5 w-3.5" /> Rattacher les employés aux sections
          </Button>
        )}
      </div>
      <p className="text-xs text-foreground-muted">Après un classement, rattachez les employés déjà créés : seuls ceux qui n&apos;ont pas encore de section sont touchés.</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Alertes                                                                  */
/* ------------------------------------------------------------------------ */

export interface AlerteVue {
  id: string;
  gravite: "info" | "attention" | "critique";
  titre: string;
  detail: string | null;
  creeLe: string;
  statut: "ouverte" | "traitee";
  commentaire: string | null;
}

const TONE_GRAVITE = { info: "info", attention: "warning", critique: "danger" } as const;

export function AlertesPanel({ alertes, peutTraiter }: { alertes: AlerteVue[]; peutTraiter: boolean }) {
  const [pending, startTransition] = useTransition();
  const [commentaires, setCommentaires] = useState<Record<string, string>>({});
  const ouvertes = alertes.filter((a) => a.statut === "ouverte");

  function traiter(id: string) {
    startTransition(async () => {
      const res = await traiterAlerte(id, commentaires[id] ?? "");
      if (res.error) toast.error(res.error);
      else toast.success("Alerte traitée");
    });
  }

  if (alertes.length === 0) return <p className="text-sm text-foreground-muted">Aucune alerte.</p>;
  return (
    <div className="space-y-2">
      {[...ouvertes, ...alertes.filter((a) => a.statut === "traitee")].map((a) => (
        <div key={a.id} className={`rounded-md border p-3 text-sm ${a.statut === "ouverte" ? "border-border" : "border-border opacity-60"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge tone={TONE_GRAVITE[a.gravite]}>{a.gravite === "critique" ? "Critique" : a.gravite === "attention" ? "Attention" : "Info"}</Badge>
              <span className="font-medium text-foreground">{a.titre}</span>
            </div>
            <span className="text-xs text-foreground-muted">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(a.creeLe))}</span>
          </div>
          {a.detail && <p className="mt-1 text-xs text-foreground-muted">{a.detail}</p>}
          {a.statut === "traitee" && <p className="mt-1 text-xs text-foreground-muted">Traitée{a.commentaire ? ` : ${a.commentaire}` : ""}</p>}
          {a.statut === "ouverte" && peutTraiter && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={commentaires[a.id] ?? ""}
                onChange={(e) => setCommentaires({ ...commentaires, [a.id]: e.target.value })}
                placeholder="Commentaire (facultatif)"
                maxLength={500}
                className="h-8 min-w-[220px] flex-1 rounded-md border border-border bg-surface px-2 text-xs"
              />
              <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => traiter(a.id)}>
                Marquer comme traitée
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
