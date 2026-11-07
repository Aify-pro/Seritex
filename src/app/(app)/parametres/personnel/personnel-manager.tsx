"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Table, Thead, Th, Tbody, Tr, Td, EmptyRow } from "@/components/ui/table";
import { ConfirmDelete } from "@/app/(app)/parametres/couleurs/confirm-delete";
import { formatAmount } from "@/lib/utils";
import { LIBELLES_TYPE_EMPLOI, STATUTS_EMPLOYE, TYPES_CONTRAT, TYPES_EMPLOI, type StatutEmploye, type TypeContrat, type TypeEmploi } from "@/lib/personnel/import";
import { enregistrerEmploye, supprimerEmploye } from "./actions";

export interface EmployeVue {
  id: string;
  matricule: string;
  nom: string;
  prenom: string | null;
  fonction: string | null;
  typeContrat: TypeContrat | null;
  atelierSource: string | null;
  typeEmploi: TypeEmploi;
  statut: StatutEmploye;
  confidentiel: boolean;
  salaireBase: number | null;
  primesFixes: number | null;
  avantages: number | null;
  chargesPatronales: number | null;
  dateEntree: string | null;
  dateSortie: string | null;
  notes: string | null;
  sections: { sectionId: string; pourcentage: number }[];
}

export interface SectionOption {
  id: string;
  nom: string;
}

const TONE_STATUT = { actif: "success", suspendu: "warning", sorti: "neutral" } as const;
const champ = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";
const etiquette = "mb-1 block text-xs font-medium text-foreground";

/** Coût mensuel chargé d'une fiche (hors employé confidentiel : aucun montant). */
function coutMensuel(e: EmployeVue): number | null {
  if (e.confidentiel) return null;
  const parts = [e.salaireBase, e.primesFixes, e.avantages, e.chargesPatronales];
  return parts.every((p) => p === null) ? null : parts.reduce<number>((s, p) => s + (p ?? 0), 0);
}

export function PersonnelManager({
  employes,
  sections,
  peutCreer,
  peutModifier,
  peutSupprimer,
}: {
  employes: EmployeVue[];
  sections: SectionOption[];
  peutCreer: boolean;
  peutModifier: boolean;
  peutSupprimer: boolean;
}) {
  const [recherche, setRecherche] = useState("");
  const [filtreSection, setFiltreSection] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<"" | StatutEmploye>("actif");
  const [edition, setEdition] = useState<EmployeVue | "nouveau" | null>(null);
  const nomSection = useMemo(() => new Map(sections.map((s) => [s.id, s.nom])), [sections]);

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return employes.filter(
      (e) =>
        (!filtreStatut || e.statut === filtreStatut) &&
        (!filtreSection || e.sections.some((s) => s.sectionId === filtreSection)) &&
        (!q || `${e.nom} ${e.prenom ?? ""}`.toLowerCase().includes(q) || e.matricule.toLowerCase().includes(q) || (e.fonction ?? "").toLowerCase().includes(q))
    );
  }, [employes, recherche, filtreSection, filtreStatut]);

  const totalMensuel = visibles.reduce((s, e) => s + (coutMensuel(e) ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-foreground-muted" />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Nom, matricule ou fonction" className={`${champ} pl-8`} />
        </div>
        <select value={filtreSection} onChange={(e) => setFiltreSection(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" aria-label="Section">
          <option value="">Toutes les sections</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nom}
            </option>
          ))}
        </select>
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as "" | StatutEmploye)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" aria-label="Statut">
          <option value="">Tous les statuts</option>
          {STATUTS_EMPLOYE.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <a href="/api/personnel/export" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-muted">
          <Download className="h-3.5 w-3.5" /> Exporter Excel
        </a>
        {peutCreer && (
          <Button type="button" size="sm" onClick={() => setEdition("nouveau")}>
            <Plus className="h-3.5 w-3.5" /> Ajouter un employé
          </Button>
        )}
      </div>

      <Table>
        <Thead>
          <tr>
            <Th>Matricule</Th>
            <Th>Nom</Th>
            <Th>Fonction</Th>
            <Th>Contrat</Th>
            <Th>Type</Th>
            <Th>Section</Th>
            <Th align="right">Coût fiche</Th>
            <Th>Statut</Th>
            <Th />
          </tr>
        </Thead>
        <Tbody>
          {visibles.length === 0 && <EmptyRow colSpan={9}>Aucun employé ne correspond.</EmptyRow>}
          {visibles.map((e) => (
            <Tr key={e.id}>
              <Td className="font-mono text-xs">{e.matricule}</Td>
              <Td className="font-medium">{e.nom}{e.prenom ? ` ${e.prenom}` : ""}</Td>
              <Td>{e.fonction ?? "—"}</Td>
              <Td>{e.typeContrat ?? "—"}</Td>
              <Td>{LIBELLES_TYPE_EMPLOI[e.typeEmploi]}</Td>
              <Td>
                {e.sections.length === 0
                  ? "—"
                  : e.sections.map((s) => `${nomSection.get(s.sectionId) ?? "?"}${s.pourcentage < 100 ? ` ${s.pourcentage} %` : ""}`).join(", ")}
              </Td>
              <Td align="right">{e.confidentiel ? <Badge tone="accent">Confidentiel</Badge> : formatAmount(coutMensuel(e))}</Td>
              <Td>
                <Badge tone={TONE_STATUT[e.statut]}>{e.statut}</Badge>
              </Td>
              <Td align="right">
                <div className="flex justify-end gap-1">
                  {peutModifier && (
                    <button type="button" onClick={() => setEdition(e)} aria-label={`Modifier ${e.nom}`} className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {peutSupprimer && (
                    <ConfirmDelete
                      label={e.nom}
                      description="La fiche, sa paie et sa présence importées sont supprimées. Pour garder l'historique, passez plutôt l'employé au statut « sorti »."
                      onConfirm={() => supprimerEmploye(e.id)}
                    />
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      <p className="text-xs text-foreground-muted">
        {visibles.length} employé{visibles.length > 1 ? "s" : ""}. Le coût réel d&apos;un mois vient du livre de paie importé (voir plus bas), pas de la fiche.{totalMensuel > 0 ? ` Montants saisis sur les fiches affichées : ${formatAmount(totalMensuel)}.` : ""}
      </p>

      <Dialog open={edition !== null} onOpenChange={(o) => !o && setEdition(null)} title={edition === "nouveau" ? "Nouvel employé" : edition ? `Modifier ${edition.nom}` : ""} size="lg">
        {edition && <FormulaireEmploye key={edition === "nouveau" ? "nouveau" : edition.id} employe={edition === "nouveau" ? null : edition} sections={sections} onFini={() => setEdition(null)} />}
      </Dialog>
    </div>
  );
}

function FormulaireEmploye({ employe, sections, onFini }: { employe: EmployeVue | null; sections: SectionOption[]; onFini: () => void }) {
  const [pending, startTransition] = useTransition();
  const [confidentiel, setConfidentiel] = useState(employe?.confidentiel ?? false);
  const [repartition, setRepartition] = useState<{ sectionId: string; pourcentage: string }[]>(
    employe?.sections.map((s) => ({ sectionId: s.sectionId, pourcentage: String(s.pourcentage) })) ?? []
  );
  const total = repartition.reduce((s, r) => s + (Number(r.pourcentage) || 0), 0);

  function enregistrer(formData: FormData) {
    const nombre = (nom: string) => {
      const v = String(formData.get(nom) ?? "").replace(/[\s ]/g, "").replace(",", ".");
      return v === "" ? null : Number(v);
    };
    const date = (nom: string) => String(formData.get(nom) ?? "") || null;
    startTransition(async () => {
      const res = await enregistrerEmploye(employe?.id ?? null, {
        matricule: String(formData.get("matricule") ?? ""),
        nom: String(formData.get("nom") ?? ""),
        prenom: String(formData.get("prenom") ?? ""),
        type_contrat: (String(formData.get("type_contrat") ?? "") || null) as TypeContrat | null,
        fonction: String(formData.get("fonction") ?? ""),
        type_emploi: String(formData.get("type_emploi")) as TypeEmploi,
        statut: String(formData.get("statut")) as StatutEmploye,
        confidentiel,
        salaire_base: confidentiel ? null : nombre("salaire_base"),
        primes_fixes: confidentiel ? null : nombre("primes_fixes"),
        avantages: confidentiel ? null : nombre("avantages"),
        charges_patronales: confidentiel ? null : nombre("charges_patronales"),
        date_entree: date("date_entree"),
        date_sortie: date("date_sortie"),
        notes: String(formData.get("notes") ?? ""),
        sections: repartition.filter((r) => r.sectionId).map((r) => ({ section_id: r.sectionId, pourcentage: Number(r.pourcentage) || 0 })),
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Fiche enregistrée");
        onFini();
      }
    });
  }

  const montant = (nom: string, libelle: string, valeur: number | null | undefined) => (
    <div>
      <label className={etiquette}>{libelle}</label>
      <input name={nom} inputMode="decimal" defaultValue={valeur ?? ""} disabled={confidentiel} className={`${champ} disabled:opacity-50`} placeholder="F CFA / mois" />
    </div>
  );

  return (
    <form action={enregistrer} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={etiquette}>Matricule</label>
          <input name="matricule" required defaultValue={employe?.matricule} className={champ} />
        </div>
        <div>
          <label className={etiquette}>Nom</label>
          <input name="nom" required defaultValue={employe?.nom} className={champ} />
        </div>
        <div>
          <label className={etiquette}>Prénom</label>
          <input name="prenom" defaultValue={employe?.prenom ?? ""} className={champ} />
        </div>
        <div>
          <label className={etiquette}>Fonction</label>
          <input name="fonction" defaultValue={employe?.fonction ?? ""} className={champ} />
        </div>
        <div>
          <label className={etiquette}>Contrat</label>
          <select name="type_contrat" defaultValue={employe?.typeContrat ?? ""} className={champ}>
            <option value="">—</option>
            {TYPES_CONTRAT.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={etiquette}>Statut</label>
          <select name="statut" defaultValue={employe?.statut ?? "actif"} className={champ}>
            {STATUTS_EMPLOYE.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className={etiquette}>Type</label>
          <select name="type_emploi" defaultValue={employe?.typeEmploi ?? "production_directe"} className={champ}>
            {TYPES_EMPLOI.map((t) => (
              <option key={t} value={t}>
                {LIBELLES_TYPE_EMPLOI[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Section(s) d&apos;affectation</p>
          <button type="button" className="text-xs text-brand hover:underline" onClick={() => setRepartition([...repartition, { sectionId: "", pourcentage: repartition.length === 0 ? "100" : "0" }])}>
            + Ajouter une section
          </button>
        </div>
        {repartition.length === 0 && <p className="text-xs text-foreground-muted">Aucune section : l&apos;employé n&apos;est rattaché à aucun atelier (structure, par exemple).</p>}
        {repartition.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={r.sectionId}
              onChange={(e) => setRepartition(repartition.map((x, j) => (j === i ? { ...x, sectionId: e.target.value } : x)))}
              className={`${champ} flex-1`}
              aria-label="Section"
            >
              <option value="">Choisir…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom}
                </option>
              ))}
            </select>
            <input
              value={r.pourcentage}
              inputMode="decimal"
              onChange={(e) => setRepartition(repartition.map((x, j) => (j === i ? { ...x, pourcentage: e.target.value } : x)))}
              className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm"
              aria-label="Pourcentage"
            />
            <span className="text-xs text-foreground-muted">%</span>
            <button type="button" aria-label="Retirer" onClick={() => setRepartition(repartition.filter((_, j) => j !== i))} className="rounded-md p-1 text-foreground-muted hover:bg-surface-muted hover:text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {repartition.length > 0 && (
          <p className={`text-xs ${Math.abs(total - 100) < 0.01 ? "text-foreground-muted" : "text-danger"}`}>Total : {total} % (doit faire 100 %)</p>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-md border border-dashed border-border p-3 text-sm">
        <input type="checkbox" checked={confidentiel} onChange={(e) => setConfidentiel(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-medium text-foreground">Confidentiel</span>
          <span className="block text-xs text-foreground-muted">Aucun salaire n&apos;est enregistré pour cet employé : son coût entre dans un poste de structure global (onglet Charges).</span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-4">
        {montant("salaire_base", "Salaire de base", employe?.salaireBase)}
        {montant("primes_fixes", "Primes fixes", employe?.primesFixes)}
        {montant("avantages", "Avantages", employe?.avantages)}
        {montant("charges_patronales", "Charges patronales", employe?.chargesPatronales)}
        <div>
          <label className={etiquette}>Entrée</label>
          <input type="date" name="date_entree" defaultValue={employe?.dateEntree ?? ""} className={champ} />
        </div>
        <div>
          <label className={etiquette}>Sortie</label>
          <input type="date" name="date_sortie" defaultValue={employe?.dateSortie ?? ""} className={champ} />
        </div>
        <div className="sm:col-span-4">
          <label className={etiquette}>Notes</label>
          <input name="notes" defaultValue={employe?.notes ?? ""} maxLength={500} className={champ} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onFini}>
          Annuler
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
