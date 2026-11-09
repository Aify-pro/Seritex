"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { chargerRepartition, repartirLigne, type RepartitionLigne } from "@/app/(app)/atelier/production/actions";

const libelleTaille = (cle: string) => cle.split("/").pop() ?? cle;
const champ = "h-9 w-20 rounded-md border border-border bg-surface px-2 text-right text-base tabular-nums sm:text-sm";

/**
 * Répartition d'une ligne d'ODF entre les nomenclatures de son article (0161) :
 * on saisit par taille ce qui part sur une autre nomenclature, la principale
 * prend le reste. Une même ligne peut ainsi être fabriquée en partie en
 * tubulaire, en partie en ouvert.
 */
export function RepartitionNomenclatures({ lineId, article }: { lineId: string; article: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<RepartitionLigne | null>(null);
  const [saisie, setSaisie] = useState<Record<string, Record<string, string>>>({});

  function ouvrir() {
    startTransition(async () => {
      const res = await chargerRepartition(lineId);
      if (res.error || !res.data) {
        toast.error("Répartition indisponible", { description: res.error });
        return;
      }
      const autres = res.data.nomenclatures.filter((n) => !n.principale);
      setSaisie(
        Object.fromEntries(
          autres.map((n) => [n.id, Object.fromEntries(res.data!.tailles.map((t) => [t.taille, String(res.data!.quantites[n.id]?.[t.taille] ?? 0)]))])
        )
      );
      setData(res.data);
    });
  }

  const autres = data?.nomenclatures.filter((n) => !n.principale) ?? [];
  const principale = data?.nomenclatures.find((n) => n.principale);
  const valeur = (nomId: string, taille: string) => Number(saisie[nomId]?.[taille] ?? 0);
  const reste = (taille: string, demande: number) => demande - autres.reduce((s, n) => s + valeur(n.id, taille), 0);
  const invalide =
    !data ||
    data.tailles.some((t) => reste(t.taille, t.demande) < 0) ||
    autres.some((n) => data.tailles.some((t) => !Number.isInteger(valeur(n.id, t.taille)) || valeur(n.id, t.taille) < 0));

  function enregistrer() {
    if (!data) return;
    startTransition(async () => {
      const voulu = Object.fromEntries(autres.map((n) => [n.id, Object.fromEntries(data.tailles.map((t) => [t.taille, valeur(n.id, t.taille)]))]));
      const res = await repartirLigne(lineId, voulu);
      if (res.error) {
        toast.error("Répartition refusée", { description: res.error });
        return;
      }
      toast.success("Répartition enregistrée");
      setData(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" loading={pending && !data} onClick={ouvrir}>
        <Split className="h-3.5 w-3.5" /> Répartir
      </Button>
      {data && (
        <Dialog
          open
          onOpenChange={(o) => !o && setData(null)}
          title="Répartir entre les nomenclatures"
          description={`${article} — saisissez ce qui part sur chaque autre nomenclature ; ${principale?.nom ?? "la principale"} prend le reste.`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-foreground-muted">
                    <th className="py-1.5 pr-3 font-medium">Taille</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Demandé</th>
                    {autres.map((n) => (
                      <th key={n.id} className="py-1.5 pr-3 text-right font-medium">
                        {n.nom} <span className="font-normal">({n.forme})</span>
                      </th>
                    ))}
                    <th className="py-1.5 text-right font-medium">
                      {principale?.nom} <span className="font-normal">({principale?.forme})</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.tailles.map((t) => {
                    const r = reste(t.taille, t.demande);
                    return (
                      <tr key={t.taille}>
                        <td className="py-1.5 pr-3 font-medium">{libelleTaille(t.taille)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{t.demande}</td>
                        {autres.map((n) => (
                          <td key={n.id} className="py-1.5 pr-3 text-right">
                            <input
                              inputMode="numeric"
                              aria-label={`${n.nom} ${libelleTaille(t.taille)}`}
                              value={saisie[n.id]?.[t.taille] ?? ""}
                              onChange={(e) => setSaisie((s) => ({ ...s, [n.id]: { ...s[n.id], [t.taille]: e.target.value } }))}
                              className={champ}
                            />
                          </td>
                        ))}
                        <td className={`py-1.5 text-right tabular-nums ${r < 0 ? "font-semibold text-danger" : ""}`}>{r}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-foreground-muted">
              Une quantité ne peut pas descendre sous ce qui est déjà coupé ou prévu sur un tracé validé. Un tracé ne porte que les pièces d&apos;une seule nomenclature.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button className="w-full sm:w-auto" loading={pending} disabled={invalide} onClick={enregistrer}>
                Enregistrer
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto" onClick={() => setData(null)}>
                Annuler
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
