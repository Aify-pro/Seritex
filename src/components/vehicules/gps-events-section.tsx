import Link from "next/link";
import { Satellite } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDateTime } from "@/lib/utils";
import { ALERT_GRAVITE_TONES, vehicleLabel } from "@/lib/vehicules/labels";
import type { FleetVehicle, GpsAlertEvent } from "@/lib/vehicules/data";
import { GpsEventActions, MarkAllSeenButton } from "./gps-panels";

/** Alertes levées par le GPS (VEH-8), à prendre en charge : vue, classée avec la suite donnée. */
export function GpsEventsSection({ events, fleet, canModify, vehicleId }: { events: GpsAlertEvent[]; fleet: FleetVehicle[]; canModify: boolean; vehicleId?: string }) {
  if (events.length === 0) return null;
  const name = (id: string) => {
    const v = fleet.find((x) => x.id === id);
    return v ? vehicleLabel(v) : "—";
  };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Satellite className="h-4 w-4" /> Signalé par le GPS ({events.length})
        </h2>
        {canModify && events.some((e) => e.statut === "nouvelle") && <MarkAllSeenButton vehicleId={vehicleId} />}
      </div>
      <Card>
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5", e.statut === "nouvelle" && "bg-surface-muted/40")}>
              <Badge tone={ALERT_GRAVITE_TONES[e.gravite] ?? "warning"}>{e.regle}</Badge>
              {!vehicleId && (
                <Link href={`/vehicules/${e.vehicle_id}`} className="w-48 shrink-0 text-sm font-medium hover:underline">
                  {name(e.vehicle_id)}
                </Link>
              )}
              <span className="flex-1 text-xs">{e.message}</span>
              {e.latitude !== null && e.longitude !== null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${e.latitude}&mlon=${e.longitude}#map=16/${e.latitude}/${e.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand hover:underline"
                >
                  carte
                </a>
              )}
              <span className="text-[11px] text-foreground-muted">{e.statut === "nouvelle" ? "nouvelle" : `vue ${e.traite_le ? formatDateTime(e.traite_le) : ""}`}</span>
              {canModify && <GpsEventActions id={e.id} statut={e.statut} />}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

