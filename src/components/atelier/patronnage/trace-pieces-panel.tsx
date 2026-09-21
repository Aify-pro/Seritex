"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PieceOverlay } from "@/components/atelier/patronnage/piece-overlay";
import {
  affecterFamille,
  getTraceDetail,
  listerOptionsAffectation,
  reanalyserTrace,
  type OptionsAffectation,
} from "@/app/(app)/atelier/patronnage/fiches-actions";
import type { LignePieceDetail, TraceAnalysisDetail, UnrecognizedFamilyDetail } from "@/lib/patronnage/detail";

/**
 * Pièces d'un tracé, visibles dans la vue étendue de sa ligne : toutes les
 * pièces reconnues (par patron, avec leur quantité) puis les pièces non
 * reconnues regroupées en familles. Sur chaque famille, l'administrateur peut
 * l'affecter à un patron — c'est l'apprentissage via le tracé. Rien n'est
 * proposé quand la reconnaissance est à 100 % : il n'y a alors rien à apprendre.
 *
 * Le détail est recalculé à l'ouverture (`getTraceDetail`) contre la
 * bibliothèque actuelle ; c'est le serveur qui recalcule la géométrie
 * apprise, l'écran ne transmet que l'index de la pièce et le choix humain.
 */
export function TracePiecesPanel({
  traceId,
  ficheId,
  complete,
  canLearn,
  onChanged,
}: {
  traceId: string;
  ficheId: string;
  complete: boolean;
  canLearn: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TraceAnalysisDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [lignesOuvertes, setLignesOuvertes] = useState(false);

  useEffect(() => {
    let annule = false;
    getTraceDetail(traceId, ficheId).then((res) => {
      if (annule) return;
      if ("error" in res) {
        setError(res.error);
        setDetail(null);
      } else {
        setError(null);
        setDetail(res);
      }
    });
    return () => {
      annule = true;
    };
  }, [traceId, ficheId, version]);

  function apresAffectation() {
    setVersion((v) => v + 1);
    onChanged();
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-foreground-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Analyse des pièces du tracé…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Button size="sm" variant="secondary" onClick={() => setLignesOuvertes((o) => !o)}>
          {lignesOuvertes ? "Masquer le détail pièce par pièce" : "Détail pièce par pièce (mm)"}
        </Button>
        {lignesOuvertes && <TableauPieces lignes={detail.lignes} />}
      </div>

      {detail.recognized.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground-muted">Pièces reconnues</p>
          <div className="space-y-2">
            {detail.recognized.map((g) => (
              <div key={g.patternPieceId} className="flex items-center gap-3 rounded-md border border-success/30 bg-success-soft/40 p-2">
                <PieceOverlay
                  candidatePoints={g.exampleCandidatePoints}
                  referencePoints={g.referencePoints}
                  innerPoints={g.exampleInnerPoints}
                  ok
                />
                <div className="flex-1 text-sm">
                  <p className="text-foreground">
                    {g.articleCode} · {g.size} · {g.pieceName}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    coupe (plein) et couture (fin) superposées à la référence (pointillés)
                    {g.mirroredCount > 0 && <span className="ml-1 text-warning">— dont {g.mirroredCount} en miroir</span>}
                  </p>
                </div>
                <Badge tone="success">×{g.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {!complete && detail.unrecognizedFamilies.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground-muted">
            Pièces non reconnues — regroupées par forme identique
          </p>
          <div className="space-y-2">
            {detail.unrecognizedFamilies.map((f) => (
              <FamilleNonReconnue
                key={f.indices[0]}
                famille={f}
                facteur={detail.scaleFactor}
                traceId={traceId}
                ficheId={ficheId}
                canLearn={canLearn}
                onLearned={apresAffectation}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const RATIOS: { valeur: number; libelle: string }[] = [
  { valeur: 0.01, libelle: "×0,01 (1 %)" },
  { valeur: 0.1, libelle: "×0,1 (10 %)" },
  { valeur: 1, libelle: "×1 (100 % — aucune correction)" },
  { valeur: 10, libelle: "×10 (1 000 %)" },
  { valeur: 100, libelle: "×100 (10 000 %)" },
  { valeur: 1000, libelle: "×1000 (100 000 %)" },
];

function libelleRatio(f: number): string {
  return RATIOS.find((r) => r.valeur === f)?.libelle ?? `×${f}`;
}

/**
 * Choix manuel du ratio d'échelle du fichier. La détection automatique
 * n'applique une correction que si une pièce est CONFIRMÉE par la bibliothèque :
 * sur un tracé sans équivalent exact elle reste à ×1. La personne qui charge
 * le fichier peut alors tester les ratios un à un et voir aussitôt le résultat
 * (dimensions en mm, pièces reconnues) ; « Automatique » relance la détection.
 */
export function SelecteurEchelle({
  traceId,
  ficheId,
  facteurApplique,
  onChanged,
}: {
  traceId: string;
  ficheId: string;
  facteurApplique: number;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function choisir(valeur: string) {
    if (!valeur) return;
    setError(null);
    startTransition(async () => {
      const res = await reanalyserTrace(traceId, ficheId, valeur === "auto" ? null : Number(valeur));
      if ("error" in res) setError(res.error);
      else onChanged();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="text-foreground-muted">
        Échelle appliquée : <span className="font-medium text-foreground">{libelleRatio(facteurApplique)}</span>
      </span>
      <span className="text-foreground-muted">· Tester un autre ratio :</span>
      <select
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
        value=""
        disabled={pending}
        onChange={(e) => choisir(e.target.value)}
      >
        <option value="">Choisir…</option>
        <option value="auto">Automatique (relancer la détection)</option>
        {RATIOS.map((r) => (
          <option key={r.valeur} value={r.valeur}>
            {r.libelle}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" />}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

const champ = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground";

function FamilleNonReconnue({
  famille,
  facteur,
  traceId,
  ficheId,
  canLearn,
  onLearned,
}: {
  famille: UnrecognizedFamilyDetail;
  facteur: number;
  traceId: string;
  ficheId: string;
  canLearn: boolean;
  onLearned: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const g = famille.bestGuess;
  const tailleDifferente = famille.nature === "taille_differente";

  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft/40 p-2">
      <div className="flex items-center gap-3">
        <PieceOverlay
          candidatePoints={famille.points}
          innerPoints={famille.innerPoints}
          referencePoints={g?.referencePoints}
          ok={false}
        />
        <div className="flex-1 text-sm">
          <p className="text-foreground">
            {famille.count} pièce(s) identique(s) (calque {famille.layer}) · {famille.largeurMm} × {famille.hauteurMm} mm
            {famille.mirroredCount > 0 && <span className="ml-1 text-warning">— dont {famille.mirroredCount} en miroir</span>}
          </p>
          {tailleDifferente && g ? (
            <p className="text-xs text-foreground-muted">
              <span className="font-medium text-warning">Taille différente probable</span> — ressemble à {g.articleCode} ·{" "}
              {g.size} · {g.pieceName} à {g.confidence}% (écart aire {g.areaDiffPct}%, périmètre {g.perimDiffPct}%, forme{" "}
              {g.shapeDiffPct}%). Jamais reconnue comme cette taille.
            </p>
          ) : g ? (
            <p className="text-xs text-foreground-muted">
              Aucune ressemblance suffisante — piste la plus éloignée : {g.articleCode} · {g.size} · {g.pieceName} (
              {g.confidence}%).
            </p>
          ) : (
            <p className="text-xs text-foreground-muted">Aucune piste dans la bibliothèque actuelle.</p>
          )}
        </div>
        {canLearn && !ouvert && (
          <Button size="sm" variant="secondary" onClick={() => setOuvert(true)}>
            Affecter
          </Button>
        )}
      </div>

      {canLearn && ouvert && (
        <FormulaireAffectation
          famille={famille}
          facteur={facteur}
          traceId={traceId}
          ficheId={ficheId}
          onCancel={() => setOuvert(false)}
          onLearned={onLearned}
        />
      )}
    </div>
  );
}

function FormulaireAffectation({
  famille,
  facteur,
  traceId,
  ficheId,
  onCancel,
  onLearned,
}: {
  famille: UnrecognizedFamilyDetail;
  facteur: number;
  traceId: string;
  ficheId: string;
  onCancel: () => void;
  onLearned: () => void;
}) {
  const g = famille.bestGuess;
  const [options, setOptions] = useState<OptionsAffectation | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [mode, setMode] = useState<"existant" | "nouveau">("nouveau");
  const [articleId, setArticleId] = useState(""); // "" = nouvel article
  const [articleCode, setArticleCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [patternId, setPatternId] = useState("");
  const [taille, setTaille] = useState("");
  const [nomPiece, setNomPiece] = useState(famille.nature === "taille_differente" ? (g?.pieceName ?? "") : "");
  const [quantite, setQuantite] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let annule = false;
    listerOptionsAffectation().then((res) => {
      if (annule) return;
      if ("error" in res) {
        setOptionsError(res.error);
        return;
      }
      setOptions(res);
      // Préremplit l'article de la piste la plus proche (autre taille probable ou piste éloignée).
      const proche = g ? res.articles.find((a) => a.code === g.articleCode) : undefined;
      if (proche) setArticleId(proche.id);
    });
    return () => {
      annule = true;
    };
  }, [g]);

  const article = options?.articles.find((a) => a.id === articleId);

  function valider() {
    setError(null);
    startTransition(async () => {
      const res = await affecterFamille(traceId, ficheId, {
        indice: famille.indices[0],
        nomPiece,
        quantiteAttendue: quantite,
        cible:
          mode === "existant"
            ? { mode: "existant", patternId }
            : {
                mode: "nouveau",
                articleId: articleId || undefined,
                articleCode: articleId ? undefined : articleCode,
                designation: articleId ? undefined : designation,
                taille,
              },
      });
      if ("error" in res) setError(res.error);
      else onLearned();
    });
  }

  const pret =
    nomPiece.trim().length > 0 &&
    (mode === "existant" ? patternId !== "" : taille.trim().length > 0 && (articleId !== "" || articleCode.trim().length > 0));

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface p-3">
      {famille.nature === "taille_differente" && (
        <p className="flex items-start gap-1.5 text-xs text-foreground-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          Vérifiez qu&apos;il s&apos;agit bien d&apos;une taille voulue et non d&apos;une erreur de la PAO : une pièce
          enregistrée ici devient une référence de la bibliothèque.
        </p>
      )}
      {optionsError && <p className="text-xs text-danger">{optionsError}</p>}
      <p className="text-xs text-foreground-muted">
        Sera enregistrée à l&apos;échelle <span className="font-medium text-foreground">{libelleRatio(facteur)}</span> —{" "}
        <span className="font-medium text-foreground">
          {famille.largeurMm} × {famille.hauteurMm} mm
        </span>
        . Si ces dimensions ne sont pas plausibles pour la pièce, corrigez d&apos;abord le ratio d&apos;échelle du tracé.
      </p>

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "nouveau"} onChange={() => setMode("nouveau")} /> Nouveau patron (nouvelle taille)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === "existant"} onChange={() => setMode("existant")} /> Patron existant
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-foreground-muted">
          Article
          <select
            className={champ}
            value={articleId}
            onChange={(e) => {
              setArticleId(e.target.value);
              setPatternId("");
            }}
          >
            {mode === "nouveau" && <option value="">+ Nouvel article…</option>}
            {mode === "existant" && <option value="">Choisir un article…</option>}
            {options?.articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.designation}
              </option>
            ))}
          </select>
        </label>

        {mode === "existant" ? (
          <label className="space-y-1 text-xs text-foreground-muted">
            Patron (taille)
            <select className={champ} value={patternId} onChange={(e) => setPatternId(e.target.value)} disabled={!article}>
              <option value="">Choisir…</option>
              {article?.patrons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.taille}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="space-y-1 text-xs text-foreground-muted">
            Taille
            <input className={champ} value={taille} onChange={(e) => setTaille(e.target.value)} placeholder="ex. L" />
          </label>
        )}

        {mode === "nouveau" && articleId === "" && (
          <>
            <label className="space-y-1 text-xs text-foreground-muted">
              Code du nouvel article
              <input className={champ} value={articleCode} onChange={(e) => setArticleCode(e.target.value)} />
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              Désignation
              <input className={champ} value={designation} onChange={(e) => setDesignation(e.target.value)} />
            </label>
          </>
        )}

        <label className="space-y-1 text-xs text-foreground-muted">
          Nom de la pièce
          <input className={champ} value={nomPiece} onChange={(e) => setNomPiece(e.target.value)} placeholder="ex. Devant" />
        </label>
        <label className="space-y-1 text-xs text-foreground-muted">
          Exemplaires attendus par vêtement
          <input
            type="number"
            min={1}
            max={50}
            className={champ}
            value={quantite}
            onChange={(e) => setQuantite(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Annuler
        </Button>
        <Button size="sm" onClick={valider} loading={pending} disabled={!pret}>
          Enregistrer dans la bibliothèque
        </Button>
      </div>
    </div>
  );
}

/** Une ligne par pièce du tracé : dimensions physiques (mm) et verdict du moteur. */
function TableauPieces({ lignes }: { lignes: LignePieceDetail[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-muted text-left text-foreground-muted">
          <tr>
            <th className="px-2 py-1.5 font-medium">N°</th>
            <th className="px-2 py-1.5 font-medium">Calque</th>
            <th className="px-2 py-1.5 font-medium">Dimensions (mm)</th>
            <th className="px-2 py-1.5 font-medium">Périmètre (mm)</th>
            <th className="px-2 py-1.5 font-medium">Surface (cm²)</th>
            <th className="px-2 py-1.5 font-medium">Résultat</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lignes.map((l) => (
            <tr key={l.index}>
              <td className="px-2 py-1.5 text-foreground-muted">{l.index + 1}</td>
              <td className="px-2 py-1.5 text-foreground-muted">{l.layer}</td>
              <td className="px-2 py-1.5 text-foreground">
                {l.largeurMm} × {l.hauteurMm}
              </td>
              <td className="px-2 py-1.5 text-foreground">{l.perimetreMm}</td>
              <td className="px-2 py-1.5 text-foreground">{l.surfaceCm2}</td>
              <td className="px-2 py-1.5">
                {l.reconnue && l.patron ? (
                  <span className="text-foreground">
                    <Badge tone="success">Reconnue</Badge> {l.patron.articleCode} · {l.patron.size} · {l.patron.pieceName} (
                    {l.score}%)
                    {l.enMiroir && <span className="ml-1 text-warning">miroir</span>}
                  </span>
                ) : (
                  <span className="text-foreground">
                    <Badge tone="danger">Non reconnue</Badge>{" "}
                    {l.nature === "taille_differente" ? (
                      <span className="text-warning">taille différente probable ({l.score}%)</span>
                    ) : (
                      <span className="text-foreground-muted">aucune ressemblance suffisante ({l.score}%)</span>
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
