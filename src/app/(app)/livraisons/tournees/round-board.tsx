"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PlaceMap, type MapPoint } from "@/components/delivery/place-map";
import { addRoundStop, createRound, removeRoundStop, reorderRoundStops } from "../actions";

export interface RoundView {
  id: string;
  livreur: string;
  vehicule: string | null;
  statut: string;
  stops: { id: string; shipmentId: string; reference: string | null; client: string; lieu: string | null; zone: string | null; lat: number | null; lng: number | null; pieces: number }[];
}

export interface Candidate {
  id: string;
  reference: string | null;
  client: string;
  zone: string | null;
  pieces: number;
}

/**
 * Composition des tournées du jour (LIV-2, Q-LIV-6) : une tournée par livreur,
 * arrêts ordonnés, carte des arrêts. Une livraison validée par la
 * comptabilité est ajoutée à une tournée — elle passe alors « planifiée ».
 */
export function RoundBoard({
  date,
  rounds,
  candidates,
  livreurs,
  vehicles,
}: {
  date: string;
  rounds: RoundView[];
  candidates: Candidate[];
  livreurs: { id: string; label: string }[];
  vehicles: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [livreurId, setLivreurId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  function run(action: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        router.refresh();
      }
    });
  }

  const points: MapPoint[] = rounds.flatMap((r) =>
    r.stops.filter((s) => s.lat !== null && s.lng !== null).map((s, i) => ({ id: s.id, lat: s.lat!, lng: s.lng!, label: `${r.livreur} · ${i + 1}. ${s.client}` }))
  );

  return (
    <div className="space-y-4">
      {points.length > 0 && <PlaceMap points={points} height={300} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {rounds.map((r) => (
          <Card key={r.id}>
            <CardHeader title={`${r.livreur}${r.vehicule ? ` · ${r.vehicule}` : ""}`} description={`Tournée ${r.statut === "en_cours" ? "en cours" : r.statut === "terminee" ? "terminée" : "préparée"} — ${r.stops.length} arrêt(s)`} />
            <CardBody className="space-y-2">
              <ol className="space-y-1.5">
                {r.stops.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-soft text-xs font-medium text-brand">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.client}</span>{" "}
                      <span className="text-xs text-foreground-muted">
                        {s.reference ?? ""} · {[s.lieu, s.zone].filter(Boolean).join(" · ")} · {s.pieces} pcs
                      </span>
                    </span>
                    {r.statut !== "terminee" && (
                      <>
                        <button
                          type="button"
                          disabled={pending || i === 0}
                          onClick={() => {
                            const ids = r.stops.map((x) => x.id);
                            [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                            run(() => reorderRoundStops(r.id, ids), "Ordre modifié");
                          }}
                          className="disabled:opacity-30"
                          aria-label="Monter"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={pending || i === r.stops.length - 1}
                          onClick={() => {
                            const ids = r.stops.map((x) => x.id);
                            [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                            run(() => reorderRoundStops(r.id, ids), "Ordre modifié");
                          }}
                          className="disabled:opacity-30"
                          aria-label="Descendre"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                        <button type="button" disabled={pending} onClick={() => run(() => removeRoundStop(s.id), "Arrêt retiré")} className="text-foreground-muted hover:text-danger" aria-label="Retirer">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ol>
              {r.statut !== "terminee" && candidates.length > 0 && (
                <select
                  value=""
                  disabled={pending}
                  onChange={(e) => e.target.value && run(() => addRoundStop(r.id, e.target.value), "Livraison ajoutée à la tournée")}
                  className="w-full rounded-md border border-border bg-surface p-2 text-xs"
                >
                  <option value="">+ Ajouter une livraison à planifier…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.client} · {c.reference ?? ""} · {c.zone ?? "zone ?"} · {c.pieces} pcs
                    </option>
                  ))}
                </select>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Nouvelle tournée" />
        <CardBody className="flex flex-wrap items-end gap-2">
          <select value={livreurId} onChange={(e) => setLivreurId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">Livreur…</option>
            {livreurs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">Véhicule…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!livreurId || pending} onClick={() => run(() => createRound(date, livreurId, vehicleId || null), "Tournée créée")}>
            <Plus className="h-3.5 w-3.5" /> Créer
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
