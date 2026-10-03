"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LotCodeInput } from "@/components/atelier/lot-code-input";
import { mergeArticleLots, splitArticleLot } from "./actions";

/** Découpage et regroupement d'un lot (SF-5) — ateliers et production. */
export function LotTools({ code, composition }: { code: string; composition: Record<string, number> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [split, setSplit] = useState<Record<string, string>>({});
  const [other, setOther] = useState("");
  const tailles = Object.keys(composition);

  const after = (res: { error: string } | { code: string }, verb: string) => {
    if ("error" in res) toast.error(`${verb} refusé`, { description: res.error });
    else {
      toast.success(`${verb} : nouveau lot ${res.code}`);
      router.push(`/lots/${res.code}`);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground-muted">Découper : pièces qui partent dans un sous-lot</p>
        <div className="flex flex-wrap gap-2">
          {tailles.map((t) => (
            <label key={t} className="text-xs">
              <span className="mb-0.5 block text-foreground-muted">
                {t.split("/").pop()} (max {composition[t]})
              </span>
              <input
                type="number"
                min={0}
                max={composition[t]}
                value={split[t] ?? ""}
                onChange={(e) => setSplit({ ...split, [t]: e.target.value })}
                className="h-9 w-20 rounded-md border border-border bg-surface px-2 text-sm"
              />
            </label>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!Object.values(split).some((v) => Number(v) > 0)}
          onClick={() =>
            startTransition(async () => {
              const compo = Object.fromEntries(Object.entries(split).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
              after(await splitArticleLot(code, compo), "Découpage");
            })
          }
        >
          Découper
        </Button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground-muted">Regrouper avec un autre lot du même article</p>
        <LotCodeInput value={other} onChange={setOther} disabled={pending} />
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!other.trim()}
          onClick={() => startTransition(async () => after(await mergeArticleLots([code, other]), "Regroupement"))}
        >
          Regrouper
        </Button>
      </div>
    </div>
  );
}
