"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PieceOverlay } from "@/components/atelier/patronnage/piece-overlay";
import type { LibraryArticle, LibraryPattern } from "@/lib/patronnage/types";
import {
  deleteReferenceArticle,
  deleteReferencePattern,
  previewDxfPieces,
  replaceReferencePattern,
  saveReferencePattern,
  type PreviewedPiece,
} from "@/app/(app)/atelier/patronnage/actions";

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
export function PatronBibliothequeManager({
  initialLibrary,
  productModels,
  canModify,
  canDelete,
}: {
  initialLibrary: LibraryArticle[];
  /** Modèles actifs : un nouvel article de patronnage est forcément rattaché à l'un d'eux (A5). */
  productModels: { id: string; name: string }[];
  canModify: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  return (
    <BibliothequeTab
      library={initialLibrary}
      productModels={productModels}
      canModify={canModify}
      canDelete={canDelete}
      onChanged={() => router.refresh()}
    />
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

/** Reprend nom et quantité des pièces d'un patron à mettre à jour : la pièce de même taille la plus proche en surface. */
function prefillFromExisting(pieces: PreviewedPiece[], existing: LibraryPattern["pieces"]): DraftPiece[] {
  const libres = [...existing];
  return pieces.map((p) => {
    let best = -1;
    let bestGap = Infinity;
    libres.forEach((e, i) => {
      const gap = Math.abs(e.area - p.area) / Math.max(e.area, 1);
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    if (best >= 0 && bestGap < 0.35) {
      const [match] = libres.splice(best, 1);
      return { ...p, include: true, name: match.name, expectedCount: match.expectedCount };
    }
    return { ...p, include: true, name: p.layer && p.layer !== "0" ? p.layer : `Pièce ${p.index + 1}`, expectedCount: 1 };
  });
}

function BibliothequeTab({
  library,
  productModels,
  canModify,
  canDelete,
  onChanged,
}: {
  library: LibraryArticle[];
  productModels: { id: string; name: string }[];
  canModify: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  // Patron (une taille) dont on remplace les pièces par un nouveau DXF.
  const [editing, setEditing] = useState<{ article: LibraryArticle; pattern: LibraryPattern } | null>(null);
  // Suppression en deux temps : « pa:<id> » (taille) ou « ar:<id> » (article entier).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [existingArticleId, setExistingArticleId] = useState("");
  const [productModelId, setProductModelId] = useState("");
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
    setEditing(null);
    setExistingArticleId("");
    setProductModelId("");
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
      editing
        ? prefillFromExisting(result.pieces, editing.pattern.pieces)
        : result.pieces.map((p) => ({
            ...p,
            include: true,
            name: p.layer && p.layer !== "0" ? p.layer : `Pièce ${p.index + 1}`,
            expectedCount: 1,
          }))
    );
  }

  async function handleDelete(kind: "pa" | "ar", id: string) {
    setDeleting(true);
    const result = kind === "pa" ? await deleteReferencePattern(id) : await deleteReferenceArticle(id);
    setDeleting(false);
    setConfirmDelete(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(kind === "pa" ? "Patron supprimé" : "Article supprimé");
    onChanged();
  }

  async function handleSave() {
    if (!file || !draft) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("size", size);
    if (editing) fd.set("pattern_id", editing.pattern.id);
    else if (existingArticleId) fd.set("existing_article_id", existingArticleId);
    else {
      fd.set("article_code", articleCode);
      fd.set("designation", designation);
      fd.set("product_model_id", productModelId);
    }
    fd.set(
      "pieces_meta",
      JSON.stringify(draft.map((d) => ({ index: d.index, include: d.include, name: d.name, expectedCount: d.expectedCount })))
    );
    const result = editing ? await replaceReferencePattern(fd) : await saveReferencePattern(fd);
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
        {canModify && (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDraft(null);
              setError(null);
              setShowAdd((v) => !v);
            }}
            className="shrink-0"
          >
            Ajouter un patron de référence
          </Button>
        )}
      </div>

      {(showAdd || editing) && (
        <Card>
          <CardHeader
            title={editing ? `Mettre à jour le patron ${editing.article.articleCode} — taille ${editing.pattern.size}` : "Fiche de référencement du patron"}
            description={
              editing
                ? editing.pattern.utilise
                  ? "Ce patron a déjà servi à reconnaître des tracés : les verdicts déjà rendus ne sont pas recalculés, seuls les prochains tracés utiliseront la nouvelle version."
                  : "Les pièces actuelles de cette taille seront remplacées par celles du nouveau fichier."
                : undefined
            }
          />
          <CardBody className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
              </div>
            )}

            {!draft && editing && (
              <>
                <Field label="Nouveau fichier DXF du patron">
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

            {!draft && !editing && (
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
                    <Field label="Modèle de produit (obligatoire)">
                      <select
                        value={productModelId}
                        onChange={(e) => setProductModelId(e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      >
                        <option value="">— Choisir le modèle —</option>
                        {productModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div />
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
                    {editing ? "Remplacer le patron" : "Enregistrer le patron"}
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
              action={
                <div className="flex items-center gap-3">
                  <span className="text-xs text-foreground-muted">seuil de reconnaissance : {art.tolerancePct}%</span>
                  {canDelete && (
                    <DeleteControl
                      label="Supprimer l'article"
                      blocked={art.patterns.some((p) => p.utilise)}
                      confirming={confirmDelete === `ar:${art.id}`}
                      busy={deleting}
                      onAsk={() => setConfirmDelete(`ar:${art.id}`)}
                      onCancel={() => setConfirmDelete(null)}
                      onConfirm={() => handleDelete("ar", art.id)}
                    />
                  )}
                </div>
              }
            />
            <div className="divide-y divide-border">
              {art.patterns.map((pat) => (
                <div key={pat.id} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-10 shrink-0 text-xs font-medium text-foreground">{pat.size}</span>
                  <div className="flex flex-1 gap-4 overflow-x-auto">
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
                  <div className="flex shrink-0 items-center gap-2">
                    {canModify && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowAdd(false);
                          setDraft(null);
                          setFile(null);
                          setError(null);
                          setSize(pat.size);
                          setEditing({ article: art, pattern: pat });
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-muted"
                      >
                        <Pencil className="h-3 w-3" /> Modifier
                      </button>
                    )}
                    {canDelete && (
                      <DeleteControl
                        label="Supprimer"
                        blocked={pat.utilise}
                        confirming={confirmDelete === `pa:${pat.id}`}
                        busy={deleting}
                        onAsk={() => setConfirmDelete(`pa:${pat.id}`)}
                        onCancel={() => setConfirmDelete(null)}
                        onConfirm={() => handleDelete("pa", pat.id)}
                      />
                    )}
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


/**
 * Suppression en deux temps. Un patron déjà reconnu dans des tracés ne se
 * supprime pas (le bouton l'explique) ; le serveur refait le même contrôle.
 */
function DeleteControl({
  label,
  blocked,
  confirming,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  label: string;
  blocked: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-danger">Supprimer définitivement ?</span>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Non
        </Button>
        <Button type="button" size="sm" loading={busy} onClick={onConfirm}>
          Oui, supprimer
        </Button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      disabled={blocked}
      title={blocked ? "Utilisé : ce patron a déjà été reconnu dans des tracés" : undefined}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:text-foreground-muted disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <Trash2 className="h-3 w-3" /> {label}
    </button>
  );
}
