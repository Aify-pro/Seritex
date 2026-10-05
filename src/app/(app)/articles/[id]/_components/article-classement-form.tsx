"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NATURE_LABELS, TYPE_APPRO_HINTS, TYPE_APPRO_LABELS, UNITE_LABELS, type ArticleNature, type TypeAppro, type Unite } from "@/lib/articles/natures";
import { setArticleClassement } from "../../fiche-actions";

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-70";

/** Classement d'un article : nature (fixée à la création), type, famille, sous-famille, unité. */
export function ArticleClassementForm({
  productModelId,
  nature,
  initial,
  familles,
  editable,
}: {
  productModelId: string;
  nature: ArticleNature;
  initial: { type_appro: TypeAppro; famille_id: string | null; sous_famille_id: string | null; unite: Unite };
  familles: { id: string; nom: string; parentId: string | null }[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ ...initial, famille_id: initial.famille_id ?? "", sous_famille_id: initial.sous_famille_id ?? "" });
  const racines = familles.filter((f) => !f.parentId);
  const sous = familles.filter((f) => f.parentId && f.parentId === v.famille_id);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Nature</span>
          <p className="flex h-9 items-center text-sm font-medium">{NATURE_LABELS[nature]}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Type</span>
          <select value={v.type_appro} disabled={!editable} onChange={(e) => setV({ ...v, type_appro: e.target.value as TypeAppro })} className={input} title={TYPE_APPRO_HINTS[v.type_appro]}>
            {(Object.keys(TYPE_APPRO_LABELS) as TypeAppro[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_APPRO_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Famille</span>
          <select value={v.famille_id} disabled={!editable} onChange={(e) => setV({ ...v, famille_id: e.target.value, sous_famille_id: "" })} className={input}>
            <option value="">—</option>
            {racines.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Sous-famille</span>
          <select value={v.sous_famille_id} disabled={!editable || sous.length === 0} onChange={(e) => setV({ ...v, sous_famille_id: e.target.value })} className={input}>
            <option value="">—</option>
            {sous.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-foreground-muted">Unité</span>
          <select value={v.unite} disabled={!editable} onChange={(e) => setV({ ...v, unite: e.target.value as Unite })} className={input}>
            {(Object.keys(UNITE_LABELS) as Unite[]).map((u) => (
              <option key={u} value={u}>
                {UNITE_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-foreground-muted">{TYPE_APPRO_HINTS[v.type_appro]}</p>
      {editable && (
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await setArticleClassement(productModelId, v);
              if (res.error) toast.error("Classement non enregistré", { description: res.error });
              else {
                toast.success("Classement enregistré");
                router.refresh();
              }
            })
          }
        >
          Enregistrer le classement
        </Button>
      )}
    </div>
  );
}
