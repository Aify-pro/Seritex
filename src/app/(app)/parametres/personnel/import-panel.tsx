"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/table";
import { COLONNES_IMPORT, LIBELLES_IMPORT, type LigneImport, type TypeImport } from "@/lib/personnel/import";
import { abandonnerImport, appliquerImport, creerApercuImport } from "./actions";

export interface ImportVue {
  id: string;
  type: TypeImport;
  nomFichier: string | null;
  mois: string | null;
  statut: "apercu" | "applique" | "abandonne";
  nbLignes: number;
  nbErreurs: number;
  nbCreations: number;
  nbModifications: number;
  creeLe: string;
  appliqueLe: string | null;
  /** Lignes de l'aperçu, fournies seulement pour un import encore à valider. */
  lignes: LigneImport[] | null;
}

const TONE = { apercu: "warning", applique: "success", abandonne: "neutral" } as const;
const LIBELLE = { apercu: "À valider", applique: "Appliqué", abandonne: "Abandonné" } as const;

const dateHeure = (v: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));

export function ImportPanel({ imports, peutDeposer, peutValider }: { imports: ImportVue[]; peutDeposer: boolean; peutValider: boolean }) {
  const [type, setType] = useState<TypeImport>("fiches");
  const [pending, startTransition] = useTransition();

  function deposer(formData: FormData) {
    startTransition(async () => {
      const res = await creerApercuImport(formData);
      if (res.error) toast.error(res.error);
      else toast.success("Fichier lu : vérifiez l'aperçu avant de valider");
    });
  }

  const agir = (action: () => Promise<{ error?: string }>, succes: string) =>
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else toast.success(succes);
    });

  return (
    <div className="space-y-4">
      {peutDeposer && (
        <form action={deposer} className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Type de fichier</label>
              <select name="type" value={type} onChange={(e) => setType(e.target.value as TypeImport)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
                {(Object.keys(LIBELLES_IMPORT) as TypeImport[]).map((t) => (
                  <option key={t} value={t}>
                    {LIBELLES_IMPORT[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-foreground">Fichier CSV</label>
              <input type="file" name="fichier" accept=".csv,text/csv,text/plain" required className="block w-full text-sm" />
            </div>
            <Button type="submit" size="sm" loading={pending}>
              <FileUp className="h-3.5 w-3.5" /> Lire le fichier
            </Button>
          </div>
          <p className="text-xs text-foreground-muted">
            Colonnes attendues : <span className="font-mono">{COLONNES_IMPORT[type].join(" ; ")}</span>. Rien n&apos;est enregistré tant que vous n&apos;avez pas validé l&apos;aperçu.
          </p>
        </form>
      )}

      {imports.length === 0 && <p className="text-sm text-foreground-muted">Aucun import pour l&apos;instant.</p>}

      {imports.map((imp) => (
        <div key={imp.id} className="rounded-md border border-border">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div className="text-sm">
              <span className="font-medium text-foreground">{LIBELLES_IMPORT[imp.type]}</span>
              <span className="text-foreground-muted">
                {" "}
                · {imp.nomFichier ?? "fichier"}
                {imp.mois ? ` · ${imp.mois.slice(0, 7)}` : ""} · déposé le {dateHeure(imp.creeLe)}
                {imp.appliqueLe ? ` · appliqué le ${dateHeure(imp.appliqueLe)}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{imp.nbLignes} ligne{imp.nbLignes > 1 ? "s" : ""}</Badge>
              {imp.nbCreations > 0 && <Badge tone="info">{imp.nbCreations} à créer</Badge>}
              {imp.nbModifications > 0 && <Badge tone="info">{imp.nbModifications} à mettre à jour</Badge>}
              {imp.nbErreurs > 0 && <Badge tone="danger">{imp.nbErreurs} en erreur</Badge>}
              <Badge tone={TONE[imp.statut]}>{LIBELLE[imp.statut]}</Badge>
            </div>
          </div>

          {imp.statut === "apercu" && imp.lignes && (
            <div className="space-y-2 border-t border-border p-3">
              <Table>
                <Thead>
                  <tr>
                    <Th>Ligne</Th>
                    <Th>Matricule</Th>
                    <Th>Action</Th>
                    <Th>Contrôle</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {imp.lignes
                    .filter((l) => l.erreurs.length > 0 || l.avertissements.length > 0)
                    .concat(imp.lignes.filter((l) => l.erreurs.length === 0 && l.avertissements.length === 0).slice(0, 10))
                    .slice(0, 60)
                    .map((l) => (
                      <Tr key={l.ligne}>
                        <Td className="text-xs">{l.ligne}</Td>
                        <Td className="font-mono text-xs">{l.matricule || "—"}</Td>
                        <Td>
                          <Badge tone={l.action === "creer" ? "success" : l.action === "modifier" ? "info" : "neutral"}>
                            {l.action === "creer" ? "Création" : l.action === "modifier" ? "Mise à jour" : "Ignorée"}
                          </Badge>
                        </Td>
                        <Td className="text-xs">
                          {l.erreurs.map((e) => (
                            <span key={e} className="block text-danger">
                              {e}
                            </span>
                          ))}
                          {l.avertissements.map((a) => (
                            <span key={a} className="block text-warning">
                              {a}
                            </span>
                          ))}
                          {l.erreurs.length === 0 && l.avertissements.length === 0 && <span className="text-foreground-muted">Conforme</span>}
                        </Td>
                      </Tr>
                    ))}
                </Tbody>
              </Table>
              <p className="text-xs text-foreground-muted">Les lignes en erreur et en alerte sont affichées en premier, avec quelques lignes conformes pour exemple.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => agir(() => abandonnerImport(imp.id), "Import abandonné")}>
                  Abandonner
                </Button>
                {peutValider && (
                  <Button type="button" size="sm" loading={pending} disabled={imp.nbErreurs > 0} onClick={() => agir(() => appliquerImport(imp.id), "Import appliqué")}>
                    {imp.nbErreurs > 0 ? "Corrigez le fichier pour valider" : "Valider et appliquer"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
