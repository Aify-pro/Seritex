"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Link2, Unlink } from "lucide-react";
import { linkSageArticleToTextile, unlinkSageArticle } from "./actions";

type Article = { sage_reference: string; designation: string };

/**
 * Articles Sage rattachés à un textile. Les candidats proposés sont les
 * articles de catégorie `tissu` qu'aucun textile ne revendique encore : la
 * synchronisation Sage ne crée rien d'elle-même, elle alimente cette liste.
 */
export function TextileArticles({
  textileId,
  attached,
  candidates,
  colors,
}: {
  textileId: string;
  attached: { sage_reference: string; designation: string; colorName: string | null }[];
  candidates: Article[];
  colors: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState("");
  const [colorId, setColorId] = useState("");

  function link() {
    if (!reference) return;
    startTransition(async () => {
      const res = await linkSageArticleToTextile(textileId, reference, colorId || null);
      if (res.error) toast.error("Rattachement refusé", { description: res.error });
      else {
        toast.success("Article rattaché");
        setReference("");
        setColorId("");
      }
    });
  }

  return (
    <div className="space-y-2">
      {attached.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          Aucun article Sage rattaché — ce textile n&apos;est encore relié à aucun rouleau du stock.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {attached.map((a) => (
            <li key={a.sage_reference} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{a.designation}</p>
                <p className="font-mono text-[11px] text-foreground-muted">
                  {a.sage_reference}
                  {a.colorName ? ` · ${a.colorName}` : " · coloris non précisé"}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await unlinkSageArticle(textileId, a.sage_reference);
                    if (res.error) toast.error(res.error);
                  })
                }
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="h-9 min-w-52 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">Article tissu à rattacher…</option>
            {candidates.map((c) => (
              <option key={c.sage_reference} value={c.sage_reference}>
                {c.designation} ({c.sage_reference})
              </option>
            ))}
          </select>
          <select
            value={colorId}
            onChange={(e) => setColorId(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface px-2 text-xs"
          >
            <option value="">Coloris…</option>
            {colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" disabled={!reference} loading={pending} onClick={link}>
            <Link2 className="h-3.5 w-3.5" /> Rattacher
          </Button>
        </div>
      )}
    </div>
  );
}
