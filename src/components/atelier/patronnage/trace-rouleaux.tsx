"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Cylinder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ajouterRouleauTrace,
  chargerRouleauxTrace,
  definirFormeTrace,
  retirerRouleauTrace,
  type RouleauxTrace,
} from "@/app/(app)/atelier/patronnage/fiches-actions";

const champ = "h-9 rounded-md border border-border bg-surface px-2 text-base sm:text-sm";
const kg = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;

/**
 * Rouleaux d'un tracé (0163) : la PAO fait son tracé selon les rouleaux en
 * stock et choisit ceux qu'il consommera (forme, laize, poids, tissu, couleur).
 * Un tracé validé réserve ses rouleaux au numéro de ses ODF. Le choix reste
 * facultatif.
 */
export function TraceRouleaux({
  traceId,
  ficheId,
  forme,
  nbRouleaux,
  statut,
  canModify,
  onChanged,
}: {
  traceId: string;
  ficheId: string;
  forme: "ouvert" | "tubulaire";
  nbRouleaux: number;
  statut: string;
  canModify: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<RouleauxTrace | null>(null);
  const [tissu, setTissu] = useState("trace");
  const [couleur, setCouleur] = useState("");
  const [laize, setLaize] = useState("");
  const [poidsMin, setPoidsMin] = useState("");

  const modifiable = canModify && statut !== "termine" && statut !== "annule";
  const formeModifiable = canModify && (statut === "en_preparation" || statut === "previsionnel");

  function charger() {
    startTransition(async () => {
      const res = await chargerRouleauxTrace(traceId);
      if ("error" in res) toast.error("Rouleaux indisponibles", { description: res.error });
      else setData(res);
    });
  }

  function agir(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (res.error) {
        toast.error("Action refusée", { description: res.error });
        return;
      }
      const maj = await chargerRouleauxTrace(traceId);
      if (!("error" in maj)) setData(maj);
      onChanged();
    });
  }

  const choisis = data?.rouleaux.filter((r) => r.choisi) ?? [];
  const candidats = useMemo(() => (data?.rouleaux ?? []).filter((r) => !r.choisi && r.forme === forme), [data, forme]);
  const tissus = useMemo(() => [...new Map(candidats.map((r) => [r.textileId, r.tissu])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [candidats]);
  const couleurs = useMemo(() => [...new Set(candidats.map((r) => r.couleur).filter((c): c is string => !!c))].sort(), [candidats]);
  const laizes = useMemo(() => [...new Set(candidats.map((r) => r.laizeCm).filter((l): l is number => l !== null))].sort((a, b) => a - b), [candidats]);
  const aTissuTrace = (data?.textilesTrace.length ?? 0) > 0;
  const visibles = candidats.filter((r) => {
    if (tissu === "trace" && aTissuTrace && !data?.textilesTrace.includes(r.textileId)) return false;
    if (tissu !== "trace" && tissu !== "" && r.textileId !== tissu) return false;
    if (couleur && r.couleur !== couleur) return false;
    if (laize && r.laizeCm !== Number(laize)) return false;
    if (poidsMin && r.poidsKg < Number(poidsMin.replace(",", "."))) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-foreground-muted">Tissu du tracé</p>
        {formeModifiable ? (
          <select value={forme} disabled={pending} onChange={(e) => agir(() => definirFormeTrace(traceId, ficheId, e.target.value as "ouvert" | "tubulaire"))} className={champ} aria-label="Forme du tissu">
            <option value="ouvert">Ouvert</option>
            <option value="tubulaire">Tubulaire</option>
          </select>
        ) : (
          <Badge tone={forme === "tubulaire" ? "info" : "neutral"}>{forme === "tubulaire" ? "Tubulaire" : "Ouvert"}</Badge>
        )}
        <Button size="sm" variant="secondary" loading={pending && !data} onClick={() => (data ? setData(null) : charger())}>
          <Cylinder className="h-3.5 w-3.5" /> Rouleaux ({nbRouleaux})
        </Button>
      </div>

      {data && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-xs text-foreground-muted">
            Facultatif. {statut === "bon_pour_coupe" || statut === "en_coupe" ? "Ces rouleaux sont réservés aux ODF de ce tracé." : "Les rouleaux choisis seront réservés à la validation du tracé."}
          </p>
          {choisis.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {choisis.map((r) => (
                <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-mono text-xs font-medium">{r.code}</span>
                  <span>{r.tissu}{r.couleur ? ` · ${r.couleur}` : ""}</span>
                  <span className="tabular-nums">{r.laizeCm ? `${r.laizeCm} cm` : "laize —"}</span>
                  <span className="tabular-nums">{kg(r.poidsKg)}</span>
                  <span className="text-xs text-foreground-muted">Bain {r.bain ?? "—"}</span>
                  {modifiable && (
                    <Button className="ml-auto" size="sm" variant="ghost" disabled={pending} onClick={() => agir(() => retirerRouleauTrace(traceId, ficheId, r.code))}>
                      Retirer
                    </Button>
                  )}
                </li>
              ))}
              <li className="px-3 py-2 text-xs font-medium">
                Total : {choisis.length} rouleau{choisis.length > 1 ? "x" : ""}, {kg(choisis.reduce((s, r) => s + r.poidsKg, 0))}
              </li>
            </ul>
          )}

          {modifiable && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select value={tissu} onChange={(e) => setTissu(e.target.value)} className={champ} aria-label="Tissu">
                  {aTissuTrace && <option value="trace">Tissus de ce tracé</option>}
                  <option value="">Tous les tissus</option>
                  {tissus.map(([id, nom]) => (
                    <option key={id} value={id}>
                      {nom}
                    </option>
                  ))}
                </select>
                <select value={couleur} onChange={(e) => setCouleur(e.target.value)} className={champ} aria-label="Couleur">
                  <option value="">Toutes les couleurs</option>
                  {couleurs.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select value={laize} onChange={(e) => setLaize(e.target.value)} className={champ} aria-label="Laize">
                  <option value="">Toutes les laizes</option>
                  {laizes.map((l) => (
                    <option key={l} value={l}>
                      {l} cm
                    </option>
                  ))}
                </select>
                <input value={poidsMin} inputMode="decimal" onChange={(e) => setPoidsMin(e.target.value)} placeholder="Poids min. (kg)" className={`${champ} w-32`} aria-label="Poids minimum" />
              </div>
              {visibles.length === 0 ? (
                <p className="text-sm text-foreground-muted">Aucun rouleau {forme} en stock pour ces critères.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {visibles.map((r) => (
                    <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-mono text-xs font-medium">{r.code}</span>
                      <span>{r.tissu}{r.couleur ? ` · ${r.couleur}` : ""}</span>
                      <span className="tabular-nums">{r.laizeCm ? `${r.laizeCm} cm` : "laize —"}</span>
                      <span className="tabular-nums">{kg(r.poidsKg)}</span>
                      <span className="text-xs text-foreground-muted">Bain {r.bain ?? "—"}</span>
                      {r.reservation && <Badge tone="warning">Réservé {r.reservation}</Badge>}
                      <Button className="ml-auto" size="sm" variant="secondary" disabled={pending} onClick={() => agir(() => ajouterRouleauTrace(traceId, ficheId, r.code))}>
                        Choisir
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
