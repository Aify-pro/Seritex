"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { groupTextiles } from "./actions";

export interface ProposalTextile {
  textileId: string;
  nom: string;
  grammage: number | null;
  articleId: string;
  article: string;
  rouleaux: number;
  declinaisons: number;
}

/**
 * Un groupe proposé : les grammages cochés rejoignent un seul article tissu,
 * sous le nom choisi. L'article gardé conserve sa fiche (famille, médias…) ;
 * les autres sont désactivés et renvoient vers lui.
 */
export function GroupingForm({ nomPropose, textiles }: { nomPropose: string; textiles: ProposalTextile[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nom, setNom] = useState(nomPropose);
  const [ids, setIds] = useState<string[]>(textiles.map((t) => t.textileId));
  // Par défaut on garde l'article le plus « rempli » (déclinaisons, rouleaux).
  const parDefaut = [...textiles].sort((a, b) => b.declinaisons + b.rouleaux - (a.declinaisons + a.rouleaux))[0];
  const [garder, setGarder] = useState<string>(parDefaut?.articleId ?? "");
  const choisis = textiles.filter((t) => ids.includes(t.textileId));
  const doublon = new Set(choisis.map((t) => t.grammage)).size !== choisis.length;

  return (
    <div className="space-y-3">
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-foreground">Nom de l&apos;article regroupé</span>
        <input value={nom} onChange={(e) => setNom(e.target.value)} className="h-9 w-72 rounded-md border border-border bg-surface px-2 text-sm" />
      </label>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-foreground-muted">
            <th className="py-1 pr-3">Regrouper</th>
            <th className="py-1 pr-3">Tissu actuel</th>
            <th className="py-1 pr-3">Grammage</th>
            <th className="py-1 pr-3">Déclinaisons</th>
            <th className="py-1 pr-3">Rouleaux</th>
            <th className="py-1">Fiche à garder</th>
          </tr>
        </thead>
        <tbody>
          {textiles.map((t) => (
            <tr key={t.textileId} className="border-t border-border">
              <td className="py-1.5 pr-3">
                <input
                  type="checkbox"
                  checked={ids.includes(t.textileId)}
                  onChange={(e) => setIds(e.target.checked ? [...ids, t.textileId] : ids.filter((x) => x !== t.textileId))}
                  aria-label={`Regrouper ${t.nom}`}
                />
              </td>
              <td className="py-1.5 pr-3">{t.article}</td>
              <td className="py-1.5 pr-3 tabular-nums">{t.grammage ?? "—"} g/m²</td>
              <td className="py-1.5 pr-3 tabular-nums">{t.declinaisons}</td>
              <td className="py-1.5 pr-3 tabular-nums">{t.rouleaux}</td>
              <td className="py-1.5">
                <input type="radio" name={`garder-${nomPropose}`} checked={garder === t.articleId} disabled={!ids.includes(t.textileId)} onChange={() => setGarder(t.articleId)} aria-label={`Garder la fiche ${t.article}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {doublon && <p className="text-xs text-danger">Deux tissus cochés ont le même grammage : un article ne porte qu&apos;une fois chaque grammage.</p>}
      <Button
        size="sm"
        loading={pending}
        disabled={ids.length < 2 || doublon || !nom.trim()}
        onClick={() =>
          startTransition(async () => {
            const res = await groupTextiles(nom, ids, ids.some((i) => textiles.find((t) => t.textileId === i)?.articleId === garder) ? garder : null);
            if (res.error) toast.error("Regroupement refusé", { description: res.error });
            else {
              toast.success(`« ${nom} » regroupe ${ids.length} grammages`);
              router.push(`/articles/${res.id}/declinaisons`);
            }
          })
        }
      >
        Regrouper {ids.length} grammages sous « {nom || "…"} »
      </Button>
    </div>
  );
}
