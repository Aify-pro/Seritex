"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Calculator, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { laizesTissu, proposerPlanCoupe } from "@/app/(app)/atelier/patronnage/imbrication-actions";
import type { LaizeStock, ResultatPlan, TissuAPlanifier } from "@/lib/imbrication/plan-coupe";

/**
 * Plan de coupe proposé par Seritex (phase 4) : pour un tissu, les matelas à
 * faire — pièces par couche et plis par couleur — sans surplus. Calcul
 * déterministe ; la longueur est ESTIMÉE (efficience moyenne), la vraie
 * vient du calcul de chaque tracé. Rien n'est créé : c'est une aide pour
 * composer les tracés.
 */

const champ = "h-9 rounded-md border border-border bg-surface px-2 text-base sm:text-sm";
const nf = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });
const taille = (t: string) => t.split("/").pop() ?? t;

export function PlanCoupe({ tissus }: { tissus: TissuAPlanifier[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [textileId, setTextileId] = useState(tissus[0]?.textileId ?? "");
  const [laizes, setLaizes] = useState<LaizeStock[]>([]);
  const [laize, setLaize] = useState("");
  const [lisiere, setLisiere] = useState("0");
  const [table, setTable] = useState("1200");
  const [maxPlis, setMaxPlis] = useState("100");
  const [efficience, setEfficience] = useState("85");
  const [resultats, setResultats] = useState<ResultatPlan[]>([]);
  const [detail, setDetail] = useState<number | null>(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!ouvert || !textileId) return;
    let actif = true;
    laizesTissu(textileId).then((l) => {
      if (!actif) return;
      setLaizes(l);
      if (l[0]) setLaize(String(l[0].laizeCm));
    });
    return () => {
      actif = false;
    };
  }, [ouvert, textileId]);

  const n = (v: string) => Number(v.replace(",", "."));

  function calculer(toutesLesLaizes: boolean) {
    const liste = toutesLesLaizes ? laizes.map((l) => l.laizeCm) : [n(laize)];
    if (liste.length === 0 || liste.some((l) => !(l > 0))) {
      toast.error("Indiquez une laize (cm).");
      return;
    }
    startTransition(async () => {
      const sorties: ResultatPlan[] = [];
      for (const l of liste) {
        const r = await proposerPlanCoupe({
          textileId,
          laizeCm: l,
          lisiereMm: n(lisiere) || 0,
          longueurTableCm: n(table),
          maxPlis: Math.round(n(maxPlis)),
          efficiencePct: n(efficience),
        });
        if ("error" in r) {
          toast.error(`Plan non calculé (laize ${l} cm)`, { description: r.error });
          return;
        }
        sorties.push(r);
      }
      setResultats(sorties);
      setDetail(sorties.length === 1 ? 0 : null);
    });
  }

  if (tissus.length === 0) return null;
  const meilleur = resultats.length > 1 ? resultats.reduce((a, b) => (b.plan.totaux.tissuEstimeM2 < a.plan.totaux.tissuEstimeM2 ? b : a)) : null;

  return (
    <Card>
      <CardHeader
        title="Plan de coupe proposé par Seritex"
        action={
          <Button size="sm" variant={ouvert ? "ghost" : "secondary"} type="button" onClick={() => setOuvert(!ouvert)}>
            <Calculator className="h-3.5 w-3.5" /> {ouvert ? "Fermer" : "Proposer un plan"}
          </Button>
        }
      />
      {ouvert && (
        <CardBody className="space-y-4">
          <p className="text-xs text-foreground-muted">
            Pour un tissu : quelles pièces mettre sur une couche et combien de plis de chaque couleur, sans rien couper en trop. La longueur est estimée ; la
            vraie vient du calcul de chaque tracé. Rien n&apos;est créé : composez ensuite vos tracés.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Tissu</span>
              <select value={textileId} onChange={(e) => setTextileId(e.target.value)} className={champ}>
                {tissus.map((t) => (
                  <option key={t.textileId} value={t.textileId}>
                    {t.libelle} — {t.piecesRestantes} pièces, {t.couleurs.length} couleur(s)
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Laize (cm)</span>
              <input value={laize} onChange={(e) => setLaize(e.target.value)} list="plan-laizes" inputMode="decimal" className={cn(champ, "w-24")} />
              <datalist id="plan-laizes">
                {laizes.map((l) => (
                  <option key={l.laizeCm} value={l.laizeCm}>
                    {l.nbRouleaux} rouleau(x), {nf(l.poidsKg, 0)} kg
                  </option>
                ))}
              </datalist>
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Lisière / bord (mm)</span>
              <input value={lisiere} onChange={(e) => setLisiere(e.target.value)} inputMode="decimal" className={cn(champ, "w-20")} />
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Table (cm)</span>
              <input value={table} onChange={(e) => setTable(e.target.value)} inputMode="decimal" className={cn(champ, "w-24")} />
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Plis max</span>
              <input value={maxPlis} onChange={(e) => setMaxPlis(e.target.value)} inputMode="numeric" className={cn(champ, "w-20")} />
            </label>
            <label className="space-y-1 text-xs text-foreground-muted">
              <span className="block">Efficience estimée (%)</span>
              <input value={efficience} onChange={(e) => setEfficience(e.target.value)} inputMode="decimal" className={cn(champ, "w-20")} />
            </label>
            <Button size="sm" type="button" onClick={() => calculer(false)} loading={pending}>
              Calculer le plan
            </Button>
            {laizes.length > 1 && (
              <Button size="sm" variant="secondary" type="button" onClick={() => calculer(true)} disabled={pending}>
                Comparer les {laizes.length} laizes en stock
              </Button>
            )}
          </div>
          {laizes.length > 0 && (
            <p className="text-xs text-foreground-muted">
              En stock : {laizes.map((l) => `${nf(l.laizeCm)} cm (${l.nbRouleaux} rouleau(x), ${nf(l.poidsKg, 0)} kg)`).join(" · ")}
            </p>
          )}

          {resultats.map((r, i) => {
            const t = r.plan.totaux;
            const deplie = detail === i;
            return (
              <div key={i} className="space-y-2 rounded-md border border-border">
                <button type="button" onClick={() => setDetail(deplie ? null : i)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm">
                  {deplie ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium text-foreground">Laize {nf(r.laizeCm)} cm</span>
                  <span className="text-foreground-muted">
                    {t.matelas} matelas · {t.plis} plis · {t.pieces} pièces · tissu estimé {nf(t.tissuEstimeM2, 1)} m² ({nf(t.longueurEstimeeM, 0)} m)
                  </span>
                  {meilleur === r && <Badge tone="brand">Moins de tissu</Badge>}
                  {r.plan.exclus.length > 0 && <Badge tone="warning">{r.plan.exclus.length} besoin(s) hors plan</Badge>}
                </button>
                {deplie && (
                  <div className="space-y-3 px-3 pb-3">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-foreground-muted">
                          <tr>
                            <th className="py-1 pr-2 font-medium">Matelas</th>
                            <th className="py-1 pr-2 font-medium">Pièces par couche</th>
                            <th className="py-1 pr-2 font-medium">Plis par couleur</th>
                            <th className="py-1 pr-2 text-right font-medium">Longueur estimée</th>
                            <th className="py-1 text-right font-medium">Pièces coupées</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.plan.matelas.map((m) => (
                            <tr key={m.numero} className="border-t border-border align-top">
                              <td className="py-1.5 pr-2 font-medium text-foreground">
                                {m.numero}
                                {m.reliquat && <span className="block font-normal text-foreground-muted">reliquat</span>}
                              </td>
                              <td className="py-1.5 pr-2">
                                <span className="flex flex-wrap gap-1">
                                  {m.composition.map((c) => (
                                    <span key={`${c.semiFiniId}|${c.taille}`} className="rounded bg-surface-muted px-1.5 py-0.5 text-foreground">
                                      {c.semiFiniNom} {taille(c.taille)} ×{c.nombre}
                                    </span>
                                  ))}
                                </span>
                              </td>
                              <td className="py-1.5 pr-2">{m.plis.map((p) => `${p.couleur} ${p.plis}`).join(" · ")}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{nf(m.longueurEstimeeMm / 10)} cm</td>
                              <td className="py-1.5 text-right tabular-nums">{m.piecesCoupees}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {r.plan.exclus.length > 0 && (
                      <div className="rounded-md border border-warning/30 bg-warning-soft p-2 text-xs text-foreground">
                        <p className="font-medium">Hors plan :</p>
                        <ul className="list-inside list-disc">
                          {r.plan.exclus.map((e, j) => (
                            <li key={j}>
                              {e.semiFiniNom} {taille(e.taille)} {e.couleur} ({e.reste}) — {e.raison}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      )}
    </Card>
  );
}
