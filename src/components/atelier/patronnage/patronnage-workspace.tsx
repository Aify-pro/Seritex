"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PieceOverlay } from "@/components/atelier/patronnage/piece-overlay";
import { TaillesChips } from "@/components/atelier/patronnage/tailles-chips";
import type { LibraryArticle, LibraryPattern } from "@/lib/patronnage/types";
import type { TailleSemiFini } from "@/lib/patronnage/tailles-semi-finis";
import type { Size } from "@/lib/sizes";
import {
  deleteReferenceArticle,
  deleteReferencePattern,
  previewDxfPieces,
  renameReferenceArticle,
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
export interface SemiFiniTailles {
  id: string;
  code: string | null;
  nom: string;
  /** Fiche patron du semi-fini, s'il en a une. */
  articleId: string | null;
  tailles: TailleSemiFini[];
}

export function PatronBibliothequeManager({
  initialLibrary,
  productModels,
  semiFinis,
  sizes,
  depotInitial,
  canModify,
  canDelete,
}: {
  initialLibrary: LibraryArticle[];
  /** Semi-finis actifs sans patron : un nouvel article de patronnage est forcément rattaché à l'un d'eux (A5, 0143). */
  productModels: { id: string; name: string }[];
  semiFinis: SemiFiniTailles[];
  sizes: Size[];
  /** Dépôt demandé depuis la fiche d'un semi-fini. */
  depotInitial: { semiFiniId: string; taille: string } | null;
  canModify: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  return (
    <BibliothequeTab
      library={initialLibrary}
      productModels={productModels}
      semiFinis={semiFinis}
      sizes={sizes}
      depotInitial={depotInitial}
      canModify={canModify}
      canDelete={canDelete}
      onChanged={() => router.refresh()}
    />
  );
}

/** Renommer un patron : code et désignation ; tailles et pièces inchangées. */
function RenameArticleDialog({ article, onClose, onDone }: { article: LibraryArticle; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(article.articleCode);
  const [designation, setDesignation] = useState(article.designation);
  const [busy, setBusy] = useState(false);
  const champ = "w-full rounded-md border border-border bg-surface px-2.5 py-2 text-base text-foreground sm:text-sm";

  async function enregistrer() {
    setBusy(true);
    const res = await renameReferenceArticle(article.id, code, designation);
    setBusy(false);
    if (res.error) {
      toast.error("Modification refusée", { description: res.error });
      return;
    }
    toast.success("Patron renommé");
    onDone();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Renommer le patron" description="Les tailles et les pièces de ce patron ne changent pas." size="sm">
      <div className="space-y-3">
        <Field label="Code article">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. TSM01-MANCHE" className={champ} />
        </Field>
        <Field label="Désignation">
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={champ} />
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button className="w-full sm:w-auto" loading={busy} disabled={!code.trim()} onClick={enregistrer}>
            Enregistrer
          </Button>
          <Button variant="ghost" className="w-full sm:w-auto" onClick={onClose}>
            Annuler
          </Button>
        </div>
      </div>
    </Dialog>
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
  semiFinis,
  sizes,
  depotInitial,
  canModify,
  canDelete,
  onChanged,
}: {
  library: LibraryArticle[];
  productModels: { id: string; name: string }[];
  semiFinis: SemiFiniTailles[];
  sizes: Size[];
  depotInitial: { semiFiniId: string; taille: string } | null;
  canModify: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const sfInitial = depotInitial ? semiFinis.find((s) => s.id === depotInitial.semiFiniId) : undefined;
  const [showAdd, setShowAdd] = useState(!!sfInitial);
  // Patron (une taille) dont on remplace les pièces par un nouveau DXF.
  const [editing, setEditing] = useState<{ article: LibraryArticle; pattern: LibraryPattern } | null>(null);
  // Suppression en deux temps : « pa:<id> » (taille) ou « ar:<id> » (article entier).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<LibraryArticle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [existingArticleId, setExistingArticleId] = useState(sfInitial?.articleId ?? "");
  const [productModelId, setProductModelId] = useState(sfInitial && !sfInitial.articleId ? sfInitial.id : "");
  const [articleCode, setArticleCode] = useState(sfInitial && !sfInitial.articleId ? (sfInitial.code ?? "") : "");
  const [designation, setDesignation] = useState(sfInitial && !sfInitial.articleId ? sfInitial.nom : "");
  const [size, setSize] = useState(depotInitial?.taille ?? "");
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
    setSize("");
    setFile(null);
    setDraft(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAnalyze() {
    if (!editing && !size) {
      setError("Choisissez la taille de ce patron");
      return;
    }
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

  /** Ouvre le formulaire pour une taille d'un semi-fini (vide = à choisir). */
  function deposer(sf: SemiFiniTailles, taille: string) {
    setEditing(null);
    setDraft(null);
    setFile(null);
    setError(null);
    setExistingArticleId(sf.articleId ?? "");
    setProductModelId(sf.articleId ? "" : sf.id);
    setArticleCode(sf.articleId ? "" : (sf.code ?? ""));
    setDesignation(sf.articleId ? "" : sf.nom);
    setSize(taille);
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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
                    <select
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                    >
                      <option value="">— Choisir la taille —</option>
                      {[...new Set(sizes.map((t) => t.groupe))].map((g) => (
                        <optgroup key={g} label={g}>
                          {sizes
                            .filter((t) => t.groupe === g)
                            .map((t) => (
                              <option key={t.cle} value={t.cle}>
                                {g} {t.libelle}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                </div>

                {!existingArticleId && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Semi-fini (obligatoire)">
                      <select
                        value={productModelId}
                        onChange={(e) => setProductModelId(e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      >
                        <option value="">— Choisir le semi-fini —</option>
                        {productModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <p className="self-end text-[11px] text-foreground-muted">
                      {productModels.length === 0
                        ? "Aucun semi-fini sans patron : créez-le dans Articles (nature « Semi-fini »)."
                        : "Un patron par semi-fini (manche, col, corps…), partagé par tous les produits finis qui l'emploient."}
                    </p>
                    <Field label="Code article">
                      <input
                        value={articleCode}
                        onChange={(e) => setArticleCode(e.target.value)}
                        placeholder="ex. MANCHE-COURTE"
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm text-foreground"
                      />
                    </Field>
                    <Field label="Désignation">
                      <input
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        placeholder="ex. Manche courte, t-shirts adulte"
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

      {semiFinis.length > 0 && (
        <Card>
          <CardHeader title="Patrons par semi-fini" description="Un patron par taille, Homme et Femme séparés. Les tailles viennent des produits finis qui emploient chaque semi-fini." />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {semiFinis.map((sf) => (
                <li key={sf.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {sf.code && <span className="mr-1.5 font-mono text-xs text-foreground-muted">{sf.code}</span>}
                      {sf.nom}
                    </p>
                    {canModify && (
                      <Button size="sm" variant="ghost" onClick={() => deposer(sf, "")}>
                        Autre taille
                      </Button>
                    )}
                  </div>
                  {sf.tailles.length === 0 ? (
                    <p className="text-xs text-foreground-muted">Aucune taille : ajoutez ce semi-fini à la nomenclature d&apos;un produit fini, ou déposez une autre taille.</p>
                  ) : (
                    <TaillesChips
                      tailles={sf.tailles}
                      manquante={(t) =>
                        canModify ? (
                          <button type="button" onClick={() => deposer(sf, t.cle)} className="min-h-7 rounded-md border border-dashed border-warning px-2 text-xs font-medium text-warning hover:bg-warning-soft">
                            {t.libelle} · déposer
                          </button>
                        ) : (
                          <span className="inline-flex min-h-7 items-center rounded-md border border-dashed border-border px-2 text-xs text-foreground-muted">{t.libelle} · manquant</span>
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
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
        {renaming && (
          <RenameArticleDialog
            article={renaming}
            onClose={() => setRenaming(null)}
            onDone={() => {
              setRenaming(null);
              onChanged();
            }}
          />
        )}
        {library.map((art) => (
          <Card key={art.id}>
            <CardHeader
              title={art.articleCode}
              description={art.designation}
              action={
                <div className="flex items-center gap-3">
                  <span className="text-xs text-foreground-muted">seuil de reconnaissance : {art.tolerancePct}%</span>
                  {canModify && (
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(art)}>
                      <Pencil className="h-3.5 w-3.5" /> Renommer
                    </Button>
                  )}
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
                  <span className="w-20 shrink-0 text-xs font-medium text-foreground">{pat.size}</span>
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
