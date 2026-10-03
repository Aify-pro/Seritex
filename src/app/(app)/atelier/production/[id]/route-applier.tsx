"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyModelRoute } from "../actions";

/**
 * « Appliquer un parcours type » (ART-H) : remplace les sections de l'article
 * par le parcours choisi du modèle, Finition en dernier ; le parcours reste
 * modifiable ensuite dans la liste des sections.
 */
export function RouteApplier({
  lineId,
  productionOrderId,
  routes,
}: {
  lineId: string;
  productionOrderId: string;
  routes: { id: string; nom: string; parDefaut: boolean }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <select
      value=""
      disabled={pending}
      onChange={(e) => {
        const routeId = e.target.value;
        if (!routeId) return;
        startTransition(async () => {
          const res = await applyModelRoute(lineId, productionOrderId, routeId);
          if (res.error) toast.error("Parcours non appliqué", { description: res.error });
          else {
            toast.success("Parcours type appliqué — modifiable ci-dessous");
            router.refresh();
          }
        });
      }}
      className="w-full rounded-md border border-border bg-surface p-2 text-xs disabled:opacity-60"
    >
      <option value="">Appliquer un parcours type…</option>
      {routes.map((r) => (
        <option key={r.id} value={r.id}>
          {r.nom}
          {r.parDefaut ? " (par défaut)" : ""}
        </option>
      ))}
    </select>
  );
}
