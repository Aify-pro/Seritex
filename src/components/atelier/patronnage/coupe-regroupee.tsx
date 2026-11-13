"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSearch, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FichePlacement, TracePlacement } from "@/lib/patronnage/types";
import {
  enregistrerPiecesTrace,
  preRemplirPiecesTrace,
  derogerControleTrace,
  catalogueTrace,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

/**
 * Ordres de coupe regroupés (étapes 3a et 3c, migrations 0149 et 0155,
 * décisions S41-S47) : un tracé porte n'importe quel ensemble de semi-finis,
 * composé par la PAO selon l'efficience ; chaque couche du matelas appartient
 * à un article d'ODF (son tissu, sa couleur, son grammage) qui doit avoir TOUS
 * les semi-finis du tracé. Le fichier du tracé fait référence : les pièces s'en
 * pré-remplissent et la base contrôle qu'elles lui correspondent.
 */

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;

type LignePiece = { semiFiniId: string; taille: string; quantite: string };

/**
 * Pièces d'un tracé regroupé (0155) : semi-fini, taille et quantité posée par
 * couche. Pré-remplies depuis le fichier du tracé, modifiables à la main, et
 * contrôlées par la base contre ce que le fichier contient (D2).
 */
export function PiecesTraceEditor({
  fiche,
  trace,
  editable,
  canUnlock,
  archived,
  onChanged,
}: {
  fiche: FichePlacement;
  trace: TracePlacement;
  editable: boolean;
  canUnlock: boolean;
  archived: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const signature = JSON.stringify(trace.pieces);
  const depuisTrace = (): LignePiece[] => trace.pieces.map((p) => ({ semiFiniId: p.semiFiniId, taille: p.taille, quantite: String(p.quantiteParCouche) }));
  const [lignes, setLignes] = useState<LignePiece[]>(depuisTrace);
  const [motif, setMotif] = useState("");
  // Les pièces enregistrées ont changé (rechargement, pré-remplissage) : on repart d'elles.
  const [signatureVue, setSignatureVue] = useState(signature);
  if (signatureVue !== signature) {
    setSignatureVue(signature);
    setLignes(depuisTrace());
  }

  // Ordre de tracé sans article d'ODF : toutes les pièces et toutes les
  // tailles sont proposées (aucune nomenclature ne les apporte encore).
  const sansOdf = fiche.lignesRegroupees.length === 0;
  const [catalogue, setCatalogue] = useState<{ semiFinis: { id: string; nom: string }[]; tailles: string[] } | null>(null);
  useEffect(() => {
    if (!sansOdf || !editable) return;
    let annule = false;
    catalogueTrace().then((c) => {
      if (!annule) setCatalogue(c);
    });
    return () => {
      annule = true;
    };
  }, [sansOdf, editable]);
  const semiFinis = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of fiche.lignesRegroupees) for (const sf of l.semiFinis) m.set(sf.id, sf.nom);
    for (const sf of catalogue?.semiFinis ?? []) m.set(sf.id, sf.nom);
    for (const p of trace.pieces) m.set(p.semiFiniId, p.semiFiniNom);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [fiche.lignesRegroupees, trace.pieces, catalogue]);
  const tailles = useMemo(() => {
    const t = new Set<string>();
    for (const l of fiche.lignesRegroupees) for (const x of l.tailles) t.add(x);
    for (const x of catalogue?.tailles ?? []) t.add(x);
    for (const p of trace.pieces) t.add(p.taille);
    // Ordre du référentiel quand il est connu (XS avant S), sinon alphabétique.
    const ordre = catalogue?.tailles ?? [];
    return [...t].sort((a, b) => (ordre.indexOf(a) + 1 || 999) - (ordre.indexOf(b) + 1 || 999) || a.localeCompare(b));
  }, [fiche.lignesRegroupees, trace.pieces, catalogue]);

  function run(action: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error(res.error);
      else {
        toast.success(ok);
        onChanged();
      }
    });
  }

  const modifie = JSON.stringify(lignes) !== JSON.stringify(depuisTrace());

  // Vue en tableau : pièces (lignes) × tailles (colonnes), y compris celles que
  // le fichier contient sans qu'elles soient déclarées.
  const [rangeesAjoutees, setRangeesAjoutees] = useState<string[]>([]);
  const [colonnesAjoutees, setColonnesAjoutees] = useState<string[]>([]);
  const ecartsParCle = useMemo(
    () => new Map((trace.controle.statut === "ecart" && !trace.controle.derogationMotif ? (trace.controle.detail?.ecarts ?? []) : []).map((e) => [`${e.semi_fini_id}|${e.taille}`, e])),
    [trace.controle]
  );
  const rangees = useMemo(
    () => [...new Set([...lignes.map((l) => l.semiFiniId), ...[...ecartsParCle.keys()].map((k) => k.split("|")[0]), ...rangeesAjoutees].filter(Boolean))],
    [lignes, ecartsParCle, rangeesAjoutees]
  );
  const colonnes = useMemo(() => {
    const c = new Set([...lignes.map((l) => l.taille), ...[...ecartsParCle.keys()].map((k) => k.split("|")[1]), ...colonnesAjoutees].filter(Boolean));
    return tailles.filter((t) => c.has(t)).concat([...c].filter((t) => !tailles.includes(t)));
  }, [lignes, ecartsParCle, colonnesAjoutees, tailles]);
  // Une pièce présente seulement dans le fichier prend le nom donné par le contrôle.
  const nomSemiFini = (id: string) =>
    semiFinis.find(([x]) => x === id)?.[1] ??
    trace.pieces.find((p) => p.semiFiniId === id)?.semiFiniNom ??
    [...ecartsParCle.values()].find((e) => e.semi_fini_id === id)?.semi_fini ??
    "?";
  const valeur = (sf: string, t: string) => lignes.find((l) => l.semiFiniId === sf && l.taille === t)?.quantite ?? "";
  const definir = (sf: string, t: string, v: string) =>
    setLignes((ls) => {
      const sans = ls.filter((l) => !(l.semiFiniId === sf && l.taille === t));
      return v.trim() === "" || Number(v) <= 0 ? sans : [...sans, { semiFiniId: sf, taille: t, quantite: v }];
    });
  const c = trace.controle;
  const peutDeroger = canUnlock && !archived && c.statut === "ecart" && !c.derogationMotif && ["previsionnel", "en_preparation", "bon_pour_coupe"].includes(trace.statut);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground-muted">Quantité posée par couche, par pièce et par taille</p>
        {c.statut === "conforme" && (
          <Badge tone="success" dot>
            Conforme au fichier du tracé
          </Badge>
        )}
        {c.statut === "ecart" && (
          <Badge tone={c.derogationMotif ? "warning" : "danger"} dot>
            {c.derogationMotif ? "Écart accepté par dérogation" : "Écart avec le fichier du tracé"}
          </Badge>
        )}
        {c.statut === "non_verifie" && <Badge tone="neutral">Sans contrôle du tracé</Badge>}
      </div>

      {lignes.length === 0 && ecartsParCle.size === 0 ? (
        <p className="text-sm text-foreground-muted">
          Aucune pièce. {trace.analyse ? "Reprenez-les depuis le fichier du tracé ou ajoutez-les à la main." : "Déposez le fichier du tracé pour les pré-remplir, ou ajoutez-les à la main."}
        </p>
      ) : (
        // Une ligne par pièce (semi-fini), une colonne par taille : quantité posée par couche.
        // Un écart avec le fichier s'affiche dans la case (« fichier : 4 »).
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs text-foreground-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Pièce</th>
                {colonnes.map((t) => (
                  <th key={t} className="px-2 py-1.5 text-center font-medium">
                    {libelleTaille(t)}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-right font-medium">Par couche{trace.nbPlis ? ` · × ${trace.nbPlis} plis` : ""}</th>
                {editable && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rangees.map((sf) => {
                const parCouche = colonnes.reduce((s, t) => s + (Number(valeur(sf, t)) || 0), 0);
                return (
                  <tr key={sf}>
                    <td className="px-3 py-1.5 font-medium">{nomSemiFini(sf)}</td>
                    {colonnes.map((t) => {
                      const ecart = ecartsParCle.get(`${sf}|${t}`);
                      return (
                        <td key={t} className="px-2 py-1 text-center align-top">
                          <input
                            inputMode="numeric"
                            value={valeur(sf, t)}
                            disabled={!editable}
                            onChange={(e) => definir(sf, t, e.target.value)}
                            className={`h-8 w-16 rounded-md border bg-surface px-2 text-right text-sm disabled:opacity-60 ${ecart ? "border-danger" : "border-border"}`}
                            aria-label={`${nomSemiFini(sf)} ${libelleTaille(t)}`}
                          />
                          {ecart && <span className="block text-[11px] text-danger">fichier : {ecart.reconnu}</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {parCouche}
                      {trace.nbPlis ? <span className="text-xs text-foreground-muted"> → {parCouche * trace.nbPlis}</span> : null}
                    </td>
                    {editable && (
                      <td className="pr-2 text-center">
                        <button
                          type="button"
                          onClick={() => setLignes((v) => v.filter((l) => l.semiFiniId !== sf))}
                          className="text-foreground-muted hover:text-danger"
                          aria-label={`Retirer ${nomSemiFini(sf)}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value=""
              onChange={(e) => e.target.value && setRangeesAjoutees((v) => [...v, e.target.value])}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
              aria-label="Ajouter une pièce"
            >
              <option value="">+ Pièce…</option>
              {semiFinis.filter(([id]) => !rangees.includes(id)).map(([id, nom]) => (
                <option key={id} value={id}>
                  {nom}
                </option>
              ))}
            </select>
            <select
              value=""
              onChange={(e) => e.target.value && setColonnesAjoutees((v) => [...v, e.target.value])}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
              aria-label="Ajouter une taille"
            >
              <option value="">+ Taille…</option>
              {tailles.filter((t) => !colonnes.includes(t)).map((t) => (
                <option key={t} value={t}>
                  {libelleTaille(t)}
                </option>
              ))}
            </select>
            {trace.analyse && (
              <Button
                size="sm"
                variant={c.statut === "ecart" && !c.derogationMotif ? "primary" : "secondary"}
                type="button"
                loading={pending}
                onClick={() =>
                  run(async () => {
                    const res = await preRemplirPiecesTrace(trace.id, fiche.id);
                    return res.error ? { error: res.error } : {};
                  }, "Pièces reprises du fichier du tracé")
                }
              >
                <FileSearch className="h-3.5 w-3.5" /> Reprendre les pièces du fichier
              </Button>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            loading={pending}
            disabled={!modifie}
            onClick={() =>
              run(
                () =>
                  enregistrerPiecesTrace(
                    trace.id,
                    fiche.id,
                    lignes.map((l) => ({ semiFiniId: l.semiFiniId, taille: l.taille, quantite: Math.trunc(Number(l.quantite) || 0) }))
                  ),
                "Pièces enregistrées"
              )
            }
          >
            Enregistrer les pièces
          </Button>
        </div>
      )}

      {c.statut === "ecart" && c.detail && (
        <div className="space-y-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-foreground">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" /> Ce que le fichier contient ne correspond pas aux pièces déclarées
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {c.detail.ecarts.length > 0 && <li>{c.detail.ecarts.length} case(s) du tableau diffèrent du fichier (en rouge, avec la quantité du fichier).</li>}
            {c.detail.hors_semi_fini.map((e, i) => (
              <li key={`h${i}`}>
                {e.semi_fini} {libelleTaille(e.taille)} : pièce d&apos;un ancien patron de produit fini (à migrer vers ses semi-finis)
              </li>
            ))}
            {c.detail.quantites_non_entieres.map((e, i) => (
              <li key={`q${i}`}>
                {e.semi_fini} {libelleTaille(e.taille)} : le nombre de pièces du fichier n&apos;est pas un nombre entier d&apos;exemplaires du patron
              </li>
            ))}
            {c.detail.pieces_non_reconnues > 0 && (
              <li>
                {c.detail.pieces_non_reconnues} pièce{c.detail.pieces_non_reconnues > 1 ? "s" : ""} du fichier non reconnue{c.detail.pieces_non_reconnues > 1 ? "s" : ""} dans la bibliothèque de patrons
              </li>
            )}
          </ul>
          <p className="text-foreground-muted">Le tracé ne peut pas passer « Bon pour coupe » tant que cet écart n&apos;est pas corrigé ou accepté par un responsable.</p>
        </div>
      )}
      {c.derogationMotif && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <CheckCircle2 className="h-3.5 w-3.5" /> Dérogation{c.derogationLe ? ` du ${new Date(c.derogationLe).toLocaleDateString("fr-FR")}` : ""} : {c.derogationMotif}
        </p>
      )}
      {peutDeroger && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder="Motif de la dérogation (obligatoire)"
            className="h-8 min-w-64 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
          />
          <Button
            size="sm"
            variant="secondary"
            type="button"
            loading={pending}
            disabled={!motif.trim()}
            onClick={() => run(() => derogerControleTrace(trace.id, fiche.id, motif.trim()), "Dérogation enregistrée")}
          >
            Accepter l&apos;écart
          </Button>
        </div>
      )}
    </div>
  );
}
