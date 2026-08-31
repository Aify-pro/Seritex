"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileWarning,
  RotateCcw,
  Wand2,
  ClipboardCheck,
} from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Point } from "@/lib/patronnage/geometry";
import type { LibraryArticle } from "@/lib/patronnage/types";
import {
  previewDxfPieces,
  saveReferencePattern,
  compareTraceDxf,
  type PreviewedPiece,
  type CompareResult,
} from "@/app/(app)/atelier/patronnage/actions";

const THRESHOLD_DEFAULT = 92;

/* ============================================================
   Rendu SVG d'une pièce (candidat vs référence superposés)
   Pur rendu : toute la géométrie (aire, périmètre, signature,
   comparaison) est calculée côté serveur, jamais recalculée ici.
============================================================ */

function piecesBounds(pieces: Point[][]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pts of pieces) {
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function toSvgPath(points: Point[], bounds: ReturnType<typeof piecesBounds>, pad = 6): string {
  const w = bounds.maxX - bounds.minX || 1;
  const h = bounds.maxY - bounds.minY || 1;
  const scale = Math.min((100 - 2 * pad) / w, (100 - 2 * pad) / h);
  return (
    points
      .map(([x, y], i) => {
        const sx = pad + (x - bounds.minX) * scale;
        const sy = 100 - (pad + (y - bounds.minY) * scale);
        return `${i === 0 ? "M" : "L"}${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

function PieceOverlay({
  candidatePoints,
  referencePoints,
  ok,
}: {
  candidatePoints: Point[];
  referencePoints?: Point[] | null;
  ok?: boolean;
}) {
  const bounds = piecesBounds([candidatePoints, referencePoints ?? candidatePoints]);
  return (
    <svg viewBox="0 0 100 100" className="h-[72px] w-[72px] shrink-0">
      {referencePoints && (
        <path
          d={toSvgPath(referencePoints, bounds)}
          fill="none"
          className="stroke-foreground-muted/40"
          strokeWidth="1.5"
          strokeDasharray="3,2"
        />
      )}
      <path
        d={toSvgPath(candidatePoints, bounds)}
        className={cn(
          ok === false ? "fill-danger-soft stroke-danger" : ok === true ? "fill-success-soft stroke-success" : "fill-brand-soft stroke-brand"
        )}
        fillOpacity="0.6"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-foreground-muted">{label}</label>
      {children}
    </div>
  );
}

/* ============================================================
   Composant principal
============================================================ */

export function PatronnageWorkspace({ initialLibrary }: { initialLibrary: LibraryArticle[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"bibliotheque" | "comparaison">("bibliotheque");
  const library = initialLibrary;

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-border">
        {(
          [
            { id: "bibliotheque" as const, label: "Bibliothèque de patrons" },
            { id: "comparaison" as const, label: "Comparaison de tracé" },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              tab === t.id
                ? "border-brand font-medium text-brand"
                : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bibliotheque" && <BibliothequeTab library={library} onChanged={() => router.refresh()} />}
      {tab === "comparaison" && <ComparaisonTab library={library} />}
    </div>
  );
}

/* ============================================================
   Onglet Bibliothèque — import DXF réel en deux étapes
============================================================ */

interface DraftPiece extends PreviewedPiece {
  include: boolean;
  name: string;
  expectedCount: number;
}

function BibliothequeTab({ library, onChanged }: { library: LibraryArticle[]; onChanged: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [existingArticleId, setExistingArticleId] = useState("");
  const [articleCode, setArticleCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [size, setSize] = useState("M");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<DraftPiece[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setShowAdd(false);
    setExistingArticleId("");
    setArticleCode("");
    setDesignation("");
    setSize("M");
    setFile(null);
    setDraft(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAnalyze() {
    if (!file) {
      setError("Sélectionnez un fichier DXF");
      return;
    }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const result = await previewDxfPieces(fd);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDraft(
      result.pieces.map((p) => ({
        ...p,
        include: true,
        name: p.layer && p.layer !== "0" ? p.layer : `Pièce ${p.index + 1}`,
        expectedCount: 1,
      }))
    );
  }

  async function handleSave() {
    if (!file || !draft) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("size", size);
    if (existingArticleId) fd.set("existing_article_id", existingArticleId);
    else {
      fd.set("article_code", articleCode);
      fd.set("designation", designation);
    }
    fd.set(
      "pieces_meta",
      JSON.stringify(draft.map((d) => ({ index: d.index, include: d.include, name: d.name, expectedCount: d.expectedCount })))
    );
    const result = await saveReferencePattern(fd);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    resetForm();
    onChanged();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-lg text-sm text-foreground-muted">
          Chaque article référence un ou plusieurs patrons (un par taille), composés de pièces géométriques
          extraites de vrais fichiers DXF. Cette bibliothèque sert de référence à toute reconnaissance
          automatique d&apos;un tracé importé.
        </p>
        <Button size="sm" onClick={() => setShowAdd((v) => !v)} className="shrink-0">
          Ajouter un patron de référence
        </Button>
      </div>

      {showAdd && (
        <Card>
          <CardHeader title="Fiche de référencement du patron" />
          <CardBody className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
              </div>
            )}

            {!draft && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Rattacher à un article existant">
                    <select
                      value={existingArticleId}
                      onChange={(e) => setExistingArticleId(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                    >
                      <option value="">— Nouvel article —</option>
                      {library.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.articleCode} — {a.designation}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Taille de ce patron">
                    <input
                      value={size}
                      onChange={(e) => setSize(e.target.value.toUpperCase())}
                      placeholder="ex. M"
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                    />
                  </Field>
                </div>

                {!existingArticleId && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Code article">
                      <input
                        value={articleCode}
                        onChange={(e) => setArticleCode(e.target.value)}
                        placeholder="ex. TS-COL-V-002"
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      />
                    </Field>
                    <Field label="Désignation">
                      <input
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        placeholder="ex. T-shirt col V, manches courtes"
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      />
                    </Field>
                  </div>
                )}

                <Field label="Fichier DXF du patron">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".dxf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="w-full rounded-md border border-dashed border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground-muted"
                  />
                </Field>

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                    Annuler
                  </Button>
                  <Button type="button" size="sm" loading={busy} onClick={handleAnalyze}>
                    <Wand2 className="h-3.5 w-3.5" /> Analyser le tracé
                  </Button>
                </div>
              </>
            )}

            {draft && (
              <>
                <p className="text-xs text-foreground-muted">
                  {draft.length} contour(s) détecté(s) (calques repères/texte déjà exclus). Décochez ce qui n&apos;est
                  pas une pièce de coupe, nommez chaque pièce retenue et indiquez son nombre attendu par taille
                  placée.
                </p>
                <div className="space-y-2">
                  {draft.map((d, i) => (
                    <div key={d.index} className="flex items-center gap-3 rounded-md border border-border p-2">
                      <input
                        type="checkbox"
                        checked={d.include}
                        onChange={(e) =>
                          setDraft((prev) => prev!.map((row, idx) => (idx === i ? { ...row, include: e.target.checked } : row)))
                        }
                      />
                      <PieceOverlay candidatePoints={d.points} />
                      <div className="flex-1 space-y-1">
                        <input
                          value={d.name}
                          onChange={(e) =>
                            setDraft((prev) => prev!.map((row, idx) => (idx === i ? { ...row, name: e.target.value } : row)))
                          }
                          placeholder="Nom de la pièce"
                          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
                        />
                        <p className="text-xs text-foreground-muted">
                          calque {d.layer} · {d.area} u² · {d.perimeter} u de périmètre
                        </p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        value={d.expectedCount}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev!.map((row, idx) => (idx === i ? { ...row, expectedCount: Number(e.target.value) || 1 } : row))
                          )
                        }
                        title="Nombre attendu par taille placée"
                        className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                    Revenir
                  </Button>
                  <Button type="button" size="sm" loading={busy} onClick={handleSave}>
                    Enregistrer le patron
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <div className="space-y-4">
        {library.length === 0 && (
          <Card>
            <CardBody className="text-sm text-foreground-muted">
              Aucun patron de référence enregistré pour le moment.
            </CardBody>
          </Card>
        )}
        {library.map((art) => (
          <Card key={art.id}>
            <CardHeader
              title={art.articleCode}
              description={art.designation}
              action={<span className="text-xs text-foreground-muted">seuil de reconnaissance : {art.tolerancePct}%</span>}
            />
            <div className="divide-y divide-border">
              {art.patterns.map((pat) => (
                <div key={pat.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-10 shrink-0 text-xs font-medium text-foreground">{pat.size}</span>
                  <div className="flex gap-4 overflow-x-auto">
                    {pat.pieces.map((piece) => (
                      <div key={piece.id} className="flex shrink-0 items-center gap-2">
                        <PieceOverlay candidatePoints={piece.points} />
                        <div className="text-xs">
                          <p className="text-foreground">{piece.name}</p>
                          <p className="text-foreground-muted">
                            ×{piece.expectedCount} · {Math.round(piece.area)} u²
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Onglet Comparaison — import réel du tracé à contrôler
============================================================ */

function ComparaisonTab({ library }: { library: LibraryArticle[] }) {
  const [declaredArticle, setDeclaredArticle] = useState(library[0]?.id ?? "");
  const [declaredSize, setDeclaredSize] = useState(library[0]?.patterns[0]?.size ?? "");
  const [threshold, setThreshold] = useState(THRESHOLD_DEFAULT);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [overrides, setOverrides] = useState<Record<number, { pieceId: string; label: string; reason: string }>>({});
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);

  const declaredArticleObj = library.find((a) => a.id === declaredArticle);
  const availableSizes = declaredArticleObj?.patterns.map((p) => p.size) ?? [];

  const allReferencePieces = useMemo(
    () =>
      library.flatMap((a) =>
        a.patterns.flatMap((p) => p.pieces.map((piece) => ({ articleCode: a.articleCode, size: p.size, piece })))
      ),
    [library]
  );

  async function handleCompare() {
    if (!file) {
      setError("Sélectionnez le fichier DXF du tracé à contrôler");
      return;
    }
    if (!declaredArticle || !declaredSize) {
      setError("Sélectionnez l'article et la taille déclarés");
      return;
    }
    setBusy(true);
    setError(null);
    setOverrides({});
    const fd = new FormData();
    fd.set("file", file);
    fd.set("article_id", declaredArticle);
    fd.set("size", declaredSize);
    fd.set("threshold", String(threshold));
    const res = await compareTraceDxf(fd);
    setBusy(false);
    if ("error" in res) {
      setError(res.error);
      setResult(null);
      return;
    }
    setResult(res);
  }

  if (library.length === 0) {
    return (
      <Card>
        <CardBody className="text-sm text-foreground-muted">
          Ajoutez au moins un patron de référence dans l&apos;onglet Bibliothèque avant de pouvoir comparer un tracé.
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Déclaration du tracé reçu" />
        <CardBody className="space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Article déclaré">
              <select
                value={declaredArticle}
                onChange={(e) => {
                  setDeclaredArticle(e.target.value);
                  const first = library.find((a) => a.id === e.target.value)?.patterns[0]?.size ?? "";
                  setDeclaredSize(first);
                }}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
              >
                {library.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.articleCode}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Taille déclarée">
              <select
                value={declaredSize}
                onChange={(e) => setDeclaredSize(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
              >
                {availableSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seuil de tolérance zéro (%)">
              <input
                type="number"
                min={50}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
              />
            </Field>
          </div>

          <Field label="Fichier DXF du tracé à contrôler">
            <input
              type="file"
              accept=".dxf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-md border border-dashed border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground-muted"
            />
          </Field>

          <div className="flex justify-end">
            <Button size="sm" loading={busy} onClick={handleCompare}>
              <Wand2 className="h-3.5 w-3.5" /> Lancer la reconnaissance
            </Button>
          </div>
        </CardBody>
      </Card>

      {result && (
        <div className="space-y-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border px-5 py-4",
              result.globalAccepted ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft"
            )}
          >
            {result.globalAccepted ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <XCircle className="h-5 w-5 text-danger" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">
                {result.globalAccepted ? "Tracé accepté" : "Tracé refusé — tolérance zéro"}
              </p>
              <p className="text-xs text-foreground-muted">
                {result.countMismatch &&
                  `Nombre de pièces détecté (${result.totalDetected}) différent du nombre attendu (${result.totalExpected}). `}
                {result.globalAccepted
                  ? "Toutes les pièces détectées correspondent au patron déclaré au-dessus du seuil."
                  : "Au moins une pièce ne correspond pas au patron déclaré avec une confiance suffisante, ou le compte de pièces diffère. Aucune correction n'est appliquée automatiquement."}
              </p>
            </div>
          </div>

          <Card>
            <div className="divide-y divide-border">
              {result.rows.map((row) => {
                const override = overrides[row.index];
                const isCorrecting = correctingIndex === row.index;
                const accepted = row.accepted || Boolean(override);
                const flagLabel = override ? "Corrigé manuellement" : row.accepted ? "Reconnu" : "Non reconnu";
                const tone: "success" | "danger" = accepted ? "success" : "danger";

                return (
                  <div key={row.index} className="px-5 py-3.5">
                    <div className="flex items-start gap-3">
                      <PieceOverlay
                        candidatePoints={row.points}
                        referencePoints={row.best?.referencePoints ?? null}
                        ok={accepted}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={tone} dot>
                            {flagLabel}
                          </Badge>
                          {override ? (
                            <span className="text-sm text-foreground">
                              Réassigné à : <span className="font-medium">{override.label}</span>
                            </span>
                          ) : row.best ? (
                            <span className="text-sm text-foreground">
                              Meilleure correspondance :{" "}
                              <span className="font-medium">
                                {row.best.articleCode} · {row.best.size} · {row.best.pieceName}
                              </span>
                            </span>
                          ) : (
                            <span className="text-sm text-foreground-muted">Aucune correspondance trouvée</span>
                          )}
                          {row.best && <span className="text-xs text-foreground-muted">confiance {row.best.confidence}%</span>}
                        </div>

                        {row.best && (
                          <div className="mt-1.5 flex gap-4 text-xs text-foreground-muted">
                            <span>Δ aire {row.best.areaDiffPct}%</span>
                            <span>Δ périmètre {row.best.perimDiffPct}%</span>
                            <span>Δ forme {row.best.shapeDiffPct}%</span>
                            <span>seuil requis {threshold}%</span>
                          </div>
                        )}

                        {!row.accepted && !override && !isCorrecting && (
                          <button
                            onClick={() => setCorrectingIndex(row.index)}
                            className="mt-2 flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground"
                          >
                            <RotateCcw className="h-3 w-3" /> Corriger manuellement
                          </button>
                        )}

                        {isCorrecting && (
                          <ManualCorrectionForm
                            options={allReferencePieces}
                            onCancel={() => setCorrectingIndex(null)}
                            onValidate={(pieceId, label, reason) => {
                              setOverrides((prev) => ({ ...prev, [row.index]: { pieceId, label, reason } }));
                              setCorrectingIndex(null);
                            }}
                          />
                        )}

                        {override && (
                          <p className="mt-1.5 flex items-center gap-1 text-xs text-foreground-muted">
                            <ClipboardCheck className="h-3 w-3" /> Motif : {override.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-foreground">
            <FileWarning className="h-3.5 w-3.5 shrink-0" />
            <span>
              Les corrections manuelles ci-dessus sont un aide-mémoire visuel pour cette session : elles ne sont pas
              encore enregistrées en base ni reliées à un circuit de validation formel (à faire évoluer avec le
              module Ordre de coupe).
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ManualCorrectionForm({
  options,
  onCancel,
  onValidate,
}: {
  options: { articleCode: string; size: string; piece: { id: string; name: string } }[];
  onCancel: () => void;
  onValidate: (pieceId: string, label: string, reason: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2.5 space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <p className="text-xs text-foreground-muted">
        Réassigner cette pièce à la correspondance réelle constatée visuellement, puis motiver la correction
        (obligatoire — reste soumis à validation du responsable production avant tout lancement de coupe).
      </p>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
      >
        <option value="">— Choisir la pièce réelle —</option>
        {options.map((r) => (
          <option key={r.piece.id} value={r.piece.id}>
            {r.articleCode} · {r.size} · {r.piece.name}
          </option>
        ))}
      </select>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motif de la correction (obligatoire)"
        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
        <Button
          size="sm"
          disabled={!selected || !reason.trim()}
          onClick={() => {
            const opt = options.find((o) => o.piece.id === selected);
            if (opt && reason.trim()) onValidate(selected, `${opt.articleCode} · ${opt.size} · ${opt.piece.name}`, reason);
          }}
        >
          Valider la correction
        </Button>
      </div>
    </div>
  );
}
