"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileSearch, Plus, Trash2 } from "lucide-react";
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
  const c = trace.controle;
  const peutDeroger = canUnlock && !archived && c.statut === "ecart" && !c.derogationMotif && ["previsionnel", "en_preparation", "bon_pour_coupe"].includes(trace.statut);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Pièces du tracé (quantité posée par couche)</p>
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

      {lignes.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Aucune pièce. {trace.analyse ? "Pré-remplissez-les depuis le fichier du tracé ou ajoutez-les à la main." : "Déposez le fichier du tracé pour les pré-remplir, ou ajoutez-les à la main."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lignes.map((l, i) => {
            const source = trace.pieces.find((p) => p.semiFiniId === l.semiFiniId && p.taille === l.taille)?.source;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <select
                  value={l.semiFiniId}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, semiFiniId: e.target.value } : x)))}
                  className="h-8 min-w-40 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
                  aria-label="Semi-fini"
                >
                  <option value="">— Semi-fini —</option>
                  {semiFinis.map(([id, nom]) => (
                    <option key={id} value={id}>
                      {nom}
                    </option>
                  ))}
                </select>
                <select
                  value={l.taille}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, taille: e.target.value } : x)))}
                  className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
                  aria-label="Taille"
                >
                  <option value="">— Taille —</option>
                  {tailles.map((t) => (
                    <option key={t} value={t}>
                      {libelleTaille(t)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={l.quantite}
                  disabled={!editable}
                  onChange={(e) => setLignes((v) => v.map((x, j) => (j === i ? { ...x, quantite: e.target.value } : x)))}
                  className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-right text-sm disabled:opacity-60"
                  aria-label="Quantité par couche"
                />
                {/* Total du tracé : quantité par couche × plis (couches attribuées, ou plis prévus). */}
                {trace.nbPlis != null && Number(l.quantite) > 0 && (
                  <span className="text-xs font-medium text-foreground">
                    × {trace.nbPlis} plis = {Number(l.quantite) * trace.nbPlis} pièces
                  </span>
                )}
                {source && <span className="text-xs text-foreground-muted">{source === "dxf" ? "lu dans le fichier" : "saisi"}</span>}
                {editable && (
                  <button
                    type="button"
                    onClick={() => setLignes((v) => v.filter((_, j) => j !== i))}
                    className="text-foreground-muted hover:text-danger"
                    aria-label="Retirer cette pièce"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={() => setLignes((v) => [...v, { semiFiniId: "", taille: "", quantite: "1" }])}>
              <Plus className="h-3.5 w-3.5" /> Ajouter une pièce
            </Button>
            {trace.analyse && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                loading={pending}
                onClick={() =>
                  run(async () => {
                    const res = await preRemplirPiecesTrace(trace.id, fiche.id);
                    return res.error ? { error: res.error } : {};
                  }, "Pièces pré-remplies depuis le fichier du tracé")
                }
              >
                <FileSearch className="h-3.5 w-3.5" /> Pré-remplir depuis le fichier
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
            {c.detail.ecarts.map((e, i) => (
              <li key={i}>
                {e.semi_fini} {libelleTaille(e.taille)} : déclaré {e.declare}, dans le fichier {e.reconnu}
              </li>
            ))}
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
