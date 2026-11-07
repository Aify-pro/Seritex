"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, Download, FileUp, Pencil, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/table";
import { formatAmount } from "@/lib/utils";
import { COLONNES_LISTE, COLONNES_PRESENCE, ENTETES_LISTE, LIBELLES_IMPORT, type LigneImport, type TypeImport } from "@/lib/personnel/import";
import type { Comparatif } from "@/lib/personnel/livre-paie";
import { abandonnerImport, appliquerImport, corrigerLigneImport, creerApercuImport, exclureLigneImport } from "./actions";

export type ComparatifVue = Comparatif & { mois_courant: string; mois_deja_importe: boolean; nb_inactifs?: number };

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
  motifValidation: string | null;
  rubriquesAClasser: string[];
  comparatif: ComparatifVue | null;
  /** Lignes de l'aperçu, fournies seulement pour un import encore à valider. */
  lignes: LigneImport[] | null;
}

const TONE = { apercu: "warning", applique: "success", abandonne: "neutral" } as const;
const LIBELLE = { apercu: "À valider", applique: "Appliqué", abandonne: "Abandonné" } as const;
const champ = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

const dateHeure = (v: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
const moisLisible = (iso: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 7)}-01T00:00:00Z`));
const moisDefaut = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export function ImportPanel({ imports, peutDeposer, peutValider }: { imports: ImportVue[]; peutDeposer: boolean; peutValider: boolean }) {
  const [type, setType] = useState<TypeImport>("paie");
  const [pending, startTransition] = useTransition();

  function deposer(formData: FormData) {
    startTransition(async () => {
      const res = await creerApercuImport(formData);
      if (res.error) toast.error(res.error);
      else toast.success("Fichier lu : vérifiez l'aperçu avant de valider");
    });
  }

  return (
    <div className="space-y-4">
      {peutDeposer && (
        <form action={deposer} className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Que voulez-vous importer ?</label>
              <select name="type" value={type} onChange={(e) => setType(e.target.value as TypeImport)} className={champ}>
                {(["paie", "fiches", "presence"] as TypeImport[]).map((t) => (
                  <option key={t} value={t}>
                    {LIBELLES_IMPORT[t]}
                  </option>
                ))}
              </select>
            </div>
            {type === "paie" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Mois de la paie</label>
                <input type="month" name="mois" required defaultValue={moisDefaut()} className={champ} />
              </div>
            )}
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-foreground">Fichier</label>
              <input
                type="file"
                name="fichier"
                required
                accept={type === "fiches" ? ".xlsx,.csv,text/csv" : ".csv,.txt,text/csv,text/plain"}
                className="block w-full text-sm"
              />
            </div>
            <Button type="submit" size="sm" loading={pending}>
              <FileUp className="h-3.5 w-3.5" /> Lire le fichier
            </Button>
          </div>
          <p className="text-xs text-foreground-muted">
            {type === "paie" && "Le livre de paie exporté de Sage, tel quel (une ligne par employé et par rubrique). Le mois se choisit ici : le fichier n'en contient pas."}
            {type === "fiches" && (
              <>
                Excel au format spécial — colonnes : <span className="font-mono">{COLONNES_LISTE.map((c) => ENTETES_LISTE[c]).join(" ; ")}</span>. Un matricule déjà connu est sauté, un matricule inconnu est ajouté.{" "}
                <a href="/api/personnel/export?modele=1" className="inline-flex items-center gap-1 text-brand hover:underline">
                  <Download className="h-3 w-3" /> Télécharger le modèle
                </a>
              </>
            )}
            {type === "presence" && (
              <>
                CSV provisoire — colonnes : <span className="font-mono">{COLONNES_PRESENCE.join(" ; ")}</span> (viendra du programme de pointage).
              </>
            )}{" "}
            Rien n&apos;est enregistré tant que vous n&apos;avez pas validé l&apos;aperçu.
          </p>
        </form>
      )}

      {imports.length === 0 && <p className="text-sm text-foreground-muted">Aucun import pour l&apos;instant.</p>}
      {imports.map((imp) => (
        <CarteImport key={imp.id} imp={imp} peutValider={peutValider} pending={pending} startTransition={startTransition} />
      ))}
    </div>
  );
}

type Filtre = "toutes" | "a_enregistrer" | "erreurs" | "alertes" | "sautees" | "exclues";

const estAEnregistrer = (l: LigneImport) => (l.action === "creer" || l.action === "modifier") && l.erreurs.length === 0 && !l.exclue;
const FILTRES: Record<Filtre, (l: LigneImport) => boolean> = {
  toutes: () => true,
  a_enregistrer: estAEnregistrer,
  erreurs: (l) => l.erreurs.length > 0,
  alertes: (l) => l.avertissements.length > 0 && l.erreurs.length === 0 && !l.exclue,
  sautees: (l) => l.action === "ignorer" && !l.exclue,
  exclues: (l) => l.exclue === true,
};

const nomDeLigne = (l: LigneImport) => {
  const d = l.donnees as { nom?: string | null; prenom?: string | null; nom_affiche?: string };
  return d.nom_affiche ?? (`${d.nom ?? ""} ${d.prenom ?? ""}`.trim() || "—");
};

const PAR_PAGE = 50;

function CarteImport({ imp, peutValider, pending, startTransition }: { imp: ImportVue; peutValider: boolean; pending: boolean; startTransition: (cb: () => Promise<void>) => void }) {
  const [motif, setMotif] = useState("");
  const lignes = imp.lignes ?? [];
  const compte = (f: Filtre) => lignes.filter(FILTRES[f]).length;
  const [filtre, setFiltre] = useState<Filtre>(() => (lignes.some(FILTRES.erreurs) ? "erreurs" : "a_enregistrer"));
  const [affichees, setAffichees] = useState(PAR_PAGE);
  const [aCorriger, setACorriger] = useState<LigneImport | null>(null);
  const alerteForte = imp.comparatif?.alertes.some((a) => a.gravite === "critique") ?? false;
  const bloque = imp.nbErreurs > 0 || imp.rubriquesAClasser.length > 0;
  const modifiable = imp.statut === "apercu" && imp.lignes !== null;
  const peutCorriger = modifiable && imp.type !== "paie";

  const agir = (action: () => Promise<{ error?: string }>, succes: string) =>
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else if (succes) toast.success(succes);
    });

  const choisir = (f: Filtre) => {
    setFiltre(f);
    setAffichees(PAR_PAGE);
  };

  const pastille = (f: Filtre, libelle: string, tone: "neutral" | "info" | "danger" | "warning") =>
    compte(f) > 0 || f === "toutes" ? (
      <button type="button" onClick={() => choisir(f)} aria-pressed={filtre === f} className={`rounded-full ring-offset-1 transition ${filtre === f ? "ring-2 ring-brand" : "opacity-90 hover:opacity-100"}`} title="Filtrer les lignes">
        <Badge tone={tone}>{libelle}</Badge>
      </button>
    ) : null;

  const filtrees = lignes.filter(FILTRES[filtre]);

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="text-sm">
          <span className="font-medium text-foreground">{LIBELLES_IMPORT[imp.type]}</span>
          <span className="text-foreground-muted">
            {" "}
            · {imp.nomFichier ?? "fichier"}
            {imp.mois ? ` · ${moisLisible(imp.mois)}` : ""} · déposé le {dateHeure(imp.creeLe)}
            {imp.appliqueLe ? ` · appliqué le ${dateHeure(imp.appliqueLe)}` : ""}
          </span>
          {imp.motifValidation && <span className="block text-xs text-foreground-muted">Motif de validation : {imp.motifValidation}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {modifiable ? (
            <>
              {pastille("toutes", `${imp.nbLignes} ligne${imp.nbLignes > 1 ? "s" : ""}`, "neutral")}
              {pastille("a_enregistrer", `${compte("a_enregistrer")} à enregistrer`, "info")}
              {pastille("erreurs", `${compte("erreurs")} en erreur`, "danger")}
              {pastille("alertes", `${compte("alertes")} en alerte`, "warning")}
              {pastille("sautees", `${compte("sautees")} sautée${compte("sautees") > 1 ? "s" : ""}`, "neutral")}
              {pastille("exclues", `${compte("exclues")} exclue${compte("exclues") > 1 ? "s" : ""}`, "neutral")}
            </>
          ) : (
            <>
              <Badge tone="neutral">
                {imp.nbLignes} ligne{imp.nbLignes > 1 ? "s" : ""}
              </Badge>
              {imp.nbCreations > 0 && <Badge tone="info">{imp.nbCreations} à enregistrer</Badge>}
              {imp.nbErreurs > 0 && <Badge tone="danger">{imp.nbErreurs} en erreur</Badge>}
            </>
          )}
          {imp.comparatif?.alertes.some((a) => a.gravite === "critique") && <Badge tone="danger">Alerte</Badge>}
          <Badge tone={TONE[imp.statut]}>{LIBELLE[imp.statut]}</Badge>
        </div>
      </div>

      {modifiable && (
        <div className="space-y-3 border-t border-border p-3">
          {imp.rubriquesAClasser.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Rubriques de paie à classer : <span className="font-mono">{imp.rubriquesAClasser.join(", ")}</span>. Classez-les dans l&apos;onglet « Rubriques de paie », puis déposez à nouveau le fichier.
              </span>
            </p>
          )}
          {imp.comparatif && <BlocComparatif c={imp.comparatif} />}

          <p className="text-xs text-foreground-muted">
            Cliquez sur une pastille pour filtrer les lignes.{" "}
            {peutCorriger ? "Corrigez une ligne ou excluez-la : le fichier est contrôlé de nouveau à chaque modification." : "Pour un livre de paie, on peut exclure une ligne mais pas retoucher les montants : corrigez le livre dans Sage si besoin."}
          </p>

          <Table>
            <Thead>
              <tr>
                <Th>Ligne</Th>
                <Th>Matricule</Th>
                <Th>Nom</Th>
                <Th>Action</Th>
                <Th>Contrôle</Th>
                <Th />
              </tr>
            </Thead>
            <Tbody>
              {filtrees.length === 0 && (
                <Tr>
                  <Td className="py-4 text-center text-xs text-foreground-muted" >
                    Aucune ligne dans ce filtre.
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                  <Td />
                </Tr>
              )}
              {filtrees.slice(0, affichees).map((l) => (
                <Tr key={l.ligne} className={l.exclue ? "opacity-60" : undefined}>
                  <Td className="text-xs">{l.ligne}</Td>
                  <Td className="font-mono text-xs">{l.matricule || "—"}</Td>
                  <Td className="text-xs">{nomDeLigne(l)}</Td>
                  <Td>
                    <Badge tone={l.exclue ? "neutral" : l.action === "creer" ? "success" : l.action === "modifier" ? "info" : "neutral"}>
                      {l.exclue ? "Exclue" : l.action === "creer" ? (imp.type === "fiches" ? "Ajout" : "Enregistrement") : l.action === "modifier" ? (imp.type === "fiches" ? "Complément" : "Mise à jour") : "Sautée"}
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
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      {peutCorriger && !l.exclue && l.brut && (
                        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setACorriger(l)}>
                          <Pencil className="h-3.5 w-3.5" /> Corriger
                        </Button>
                      )}
                      {l.exclue ? (
                        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => agir(() => exclureLigneImport(imp.id, l.ligne, false), "Ligne réintégrée")}>
                          <Undo2 className="h-3.5 w-3.5" /> Réintégrer
                        </Button>
                      ) : l.action !== "ignorer" || l.erreurs.length > 0 ? (
                        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => agir(() => exclureLigneImport(imp.id, l.ligne, true), "Ligne exclue")}>
                          <Ban className="h-3.5 w-3.5" /> Exclure
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {filtrees.length > affichees && (
            <div className="flex items-center justify-between text-xs text-foreground-muted">
              <span>
                {affichees} lignes affichées sur {filtrees.length}.
              </span>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAffichees(affichees + PAR_PAGE)}>
                Afficher {Math.min(PAR_PAGE, filtrees.length - affichees)} de plus
              </Button>
            </div>
          )}

          {alerteForte && peutValider && (
            <div>
              <label className="mb-1 block text-xs font-medium text-danger">Motif de la validation (obligatoire : livre identique ou quasi identique)</label>
              <textarea value={motif} onChange={(e) => setMotif(e.target.value)} rows={2} maxLength={500} className="w-full rounded-md border border-border bg-surface p-2 text-sm" placeholder="Pourquoi ce livre est-il valide malgré l'alerte ?" />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" loading={pending} onClick={() => agir(() => abandonnerImport(imp.id), "Import abandonné")}>
              Abandonner
            </Button>
            {peutValider && (
              <Button type="button" size="sm" loading={pending} disabled={bloque || (alerteForte && motif.trim().length < 10)} onClick={() => agir(() => appliquerImport(imp.id, motif), "Import appliqué")}>
                {bloque ? "Corrigez ou excluez les lignes en erreur" : "Valider et appliquer"}
              </Button>
            )}
          </div>
        </div>
      )}

      {aCorriger && (
        <Dialog open onOpenChange={(o) => !o && setACorriger(null)} title={`Corriger la ligne ${aCorriger.ligne}`} description="Les valeurs viennent du fichier ; seule la ligne de l'aperçu est modifiée, pas le fichier." size="md">
          <CorrectionLigne
            ligne={aCorriger}
            pending={pending}
            onAnnuler={() => setACorriger(null)}
            onEnregistrer={(valeurs) =>
              startTransition(async () => {
                const res = await corrigerLigneImport(imp.id, aCorriger.ligne, valeurs);
                if (res.error) toast.error(res.error);
                else {
                  toast.success("Ligne corrigée : fichier contrôlé de nouveau");
                  setACorriger(null);
                }
              })
            }
          />
        </Dialog>
      )}
    </div>
  );
}

function CorrectionLigne({ ligne, pending, onAnnuler, onEnregistrer }: { ligne: LigneImport; pending: boolean; onAnnuler: () => void; onEnregistrer: (valeurs: Record<string, string>) => void }) {
  const [valeurs, setValeurs] = useState<Record<string, string>>(ligne.brut ?? {});
  return (
    <div className="space-y-3">
      {ligne.erreurs.length > 0 && (
        <ul className="space-y-0.5 rounded-md bg-danger-soft p-2 text-xs text-danger">
          {ligne.erreurs.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.keys(valeurs).map((colonne) => (
          <div key={colonne}>
            <label className="mb-1 block text-xs font-medium text-foreground">{colonne}</label>
            <input value={valeurs[colonne]} onChange={(e) => setValeurs({ ...valeurs, [colonne]: e.target.value })} className={`${champ} w-full`} />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onAnnuler}>
          Annuler
        </Button>
        <Button type="button" size="sm" loading={pending} onClick={() => onEnregistrer(valeurs)}>
          Enregistrer la correction
        </Button>
      </div>
    </div>
  );
}

function BlocComparatif({ c }: { c: ComparatifVue }) {
  const signe = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div className="space-y-2 rounded-md bg-surface-muted/60 p-3 text-sm">
      <p className="font-medium text-foreground">Comparaison avec le livre précédent{c.mois_precedent ? ` (${moisLisible(c.mois_precedent)})` : ""}</p>
      <div className="grid gap-2 text-xs sm:grid-cols-4">
        <div>
          <p className="text-foreground-muted">Coût du mois</p>
          <p className="text-sm font-semibold">{formatAmount(c.total_courant)}</p>
        </div>
        <div>
          <p className="text-foreground-muted">Mois précédent</p>
          <p className="text-sm font-semibold">{c.total_precedent === null ? "—" : formatAmount(c.total_precedent)}</p>
        </div>
        <div>
          <p className="text-foreground-muted">Variation</p>
          <p className="text-sm font-semibold">{c.variation_pct === null ? "—" : `${signe(c.variation_pct)} %`}</p>
        </div>
        <div>
          <p className="text-foreground-muted">Employés payés</p>
          <p className="text-sm font-semibold">
            {c.nb_payes}
            {c.mois_precedent ? ` (avant : ${c.nb_payes_precedent})` : ""}
          </p>
        </div>
      </div>
      {c.ecart_sage_total !== 0 && (
        <p className="text-xs text-foreground-muted">
          Coût total de Sage {c.ecart_sage_total > 0 ? "supérieur" : "inférieur"} de {formatAmount(Math.abs(c.ecart_sage_total))} à la somme des rubriques (prêts, congés, taxes patronales…) : le coût total de Sage fait foi, le détail par rubrique reste consultable.
        </p>
      )}
      {c.mois_deja_importe && <p className="text-xs text-warning">Ce mois a déjà été importé : les montants des employés de ce fichier seront remplacés.</p>}
      {c.identiques_pct !== null && <p className="text-xs text-foreground-muted">{c.identiques_pct} % des employés ont exactement le même coût que le mois précédent.</p>}
      {c.alertes.map((a) => (
        <p key={a.titre} className={`flex items-start gap-2 rounded-md p-2 text-xs ${a.gravite === "critique" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">{a.titre}.</span> {a.detail}
          </span>
        </p>
      ))}
      {(c.nouveaux.length > 0 || c.disparus.length > 0) && (
        <p className="text-xs text-foreground-muted">
          {c.nouveaux.length > 0 && <>Nouveaux payés : {c.nouveaux.slice(0, 15).join(", ")}{c.nouveaux.length > 15 ? "…" : ""}. </>}
          {c.disparus.length > 0 && <>Payés le mois précédent et absents : {c.disparus.slice(0, 15).join(", ")}{c.disparus.length > 15 ? "…" : ""}.</>}
        </p>
      )}
      {c.gros_ecarts.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-foreground-muted">{c.gros_ecarts.length} employé{c.gros_ecarts.length > 1 ? "s" : ""} avec un écart de 30 % ou plus</summary>
          <ul className="mt-1 space-y-0.5">
            {c.gros_ecarts.map((g) => (
              <li key={g.matricule}>
                <span className="font-mono">{g.matricule}</span> {g.nom} : {formatAmount(g.precedent)} → {formatAmount(g.courant)} ({signe(g.variation_pct)} %)
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
