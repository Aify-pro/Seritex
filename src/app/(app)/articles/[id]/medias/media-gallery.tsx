"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteMedia, reorderMedia, saveEshop, setMediaPrincipale, uploadModelMedia } from "./actions";

export interface MediaItem {
  id: string;
  url: string | null;
  fileName: string;
  colorId: string | null;
  principale: boolean;
}

type Run = (fn: () => Promise<{ error?: string }>, ok: string) => void;

function useRun(): [boolean, Run] {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run: Run = (fn, ok) =>
    startTransition(async () => {
      const res = await fn();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });
  return [pending, run];
}

/** Galerie du modèle (ART-F) : dépôt par couleur, image principale, ordre, retrait. */
export function MediaGallery({
  modelId,
  items,
  colors,
  canModify,
}: {
  modelId: string;
  items: MediaItem[];
  colors: { id: string; name: string }[];
  canModify: boolean;
}) {
  const [pending, run] = useRun();
  const formRef = useRef<HTMLFormElement>(null);
  const colorName = (id: string | null) => (id ? colors.find((c) => c.id === id)?.name ?? "Couleur" : "Toutes couleurs");
  const move = (i: number, d: -1 | 1) => {
    const ids = items.map((m) => m.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    run(() => reorderMedia(modelId, ids), "Ordre enregistré");
  };

  return (
    <div className="space-y-4">
      {canModify && (
        <form
          ref={formRef}
          action={(fd) =>
            run(async () => {
              const res = await uploadModelMedia(modelId, fd);
              if (!res.error) formRef.current?.reset();
              return res;
            }, "Image ajoutée")
          }
          className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
        >
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Image</span>
            <input name="image" type="file" accept="image/*" required className="text-sm" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block font-medium text-foreground">Couleur</span>
            <select name="color_id" className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">Toutes couleurs</option>
              {colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" loading={pending}>
            Ajouter
          </Button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucune image pour ce modèle.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m, i) => (
            <li key={m.id} className="space-y-1.5 rounded-md border border-border p-2">
              {m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.fileName} className="aspect-square w-full rounded object-cover" />
              ) : (
                <div className="aspect-square w-full rounded bg-surface-muted" />
              )}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-foreground-muted">{colorName(m.colorId)}</span>
                {m.principale && <Badge tone="brand">Principale</Badge>}
              </div>
              {canModify && (
                <div className="flex items-center gap-1">
                  <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label="Avant" className="rounded p-1 hover:bg-surface-muted disabled:opacity-30">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" disabled={pending || i === items.length - 1} onClick={() => move(i, 1)} aria-label="Après" className="rounded p-1 hover:bg-surface-muted disabled:opacity-30">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  {!m.principale && (
                    <button type="button" disabled={pending} onClick={() => run(() => setMediaPrincipale(modelId, m.id), "Image principale changée")} aria-label="Image principale" className="rounded p-1 hover:bg-surface-muted">
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" disabled={pending} onClick={() => run(() => deleteMedia(modelId, m.id), "Image retirée")} aria-label="Retirer" className="ml-auto rounded p-1 text-foreground-muted hover:bg-danger-soft hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Texte commercial et publication e-shop (ART-F). */
export function EshopForm({ modelId, texte, publiable, canModify }: { modelId: string; texte: string | null; publiable: boolean; canModify: boolean }) {
  const [pending, run] = useRun();
  const [v, setV] = useState({ texte: texte ?? "", publiable });
  return (
    <div className="space-y-3">
      <textarea
        value={v.texte}
        onChange={(e) => setV({ ...v, texte: e.target.value })}
        disabled={!canModify || pending}
        rows={5}
        placeholder="Présentation du modèle pour le catalogue et l'e-shop"
        className="w-full rounded-md border border-border bg-surface p-2 text-sm"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.publiable} disabled={!canModify || pending} onChange={(e) => setV({ ...v, publiable: e.target.checked })} />
        Publiable sur l&apos;e-shop
      </label>
      {canModify && (
        <Button size="sm" loading={pending} onClick={() => run(() => saveEshop(modelId, { texte_commercial: v.texte, publiable_eshop: v.publiable }), "Fiche e-shop enregistrée")}>
          Enregistrer
        </Button>
      )}
    </div>
  );
}
