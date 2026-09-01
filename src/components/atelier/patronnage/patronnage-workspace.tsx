"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Wand2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Point } from "@/lib/patronnage/geometry";
import type { LibraryArticle } from "@/lib/patronnage/types";
import {
  previewDxfPieces,
  saveReferencePattern,
  type PreviewedPiece,
} from "@/app/(app)/atelier/patronnage/actions";

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

/**
 * Bibliothèque des patrons de référence — brique support du module
 * Patronnage. L'écran principal du module (liste des fiches de placement +
 * fiche détail avec tracés) vit dans page.tsx et fiche-detail-content.tsx ;
 * cette bibliothèque reste une page séparée (/atelier/patronnage/bibliotheque)
 * puisqu'elle sert de référence à toutes les fiches, pas à une seule.
 */
export function PatronBibliothequeManager({ initialLibrary }: { initialLibrary: LibraryArticle[] }) {
  const router = useRouter();
  return <BibliothequeTab library={initialLibrary} onChanged={() => router.refresh()} />;
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

