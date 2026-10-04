"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Crosshair, MapPin, Navigation, Phone, Printer, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/utils";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/delivery/status";
import { setShipmentStatus, updateRoundProgress, uploadShipmentDocument } from "../livraisons/actions";
import { setDeliveryPlacePosition } from "@/lib/actions/delivery-places";

export interface LivreurStop {
  id: string;
  reference: string | null;
  statut: ShipmentStatus;
  clientNom: string;
  placeId: string | null;
  lieu: { libelle: string | null; zone: string | null; quartier: string | null; repere: string | null; contactNom: string | null; contactTel: string | null; horaires: string | null; consignes: string | null; latitude: number | null; longitude: number | null };
  pieces: number;
  colis: number;
  aEncaisser: number | null;
  hasDecharge: boolean;
}

/** Position GPS de l'appareil (promesse), ou null si refusée / indisponible. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

/**
 * Écran du livreur (L4) : ses livraisons du jour, dans l'ordre de la tournée.
 * Itinéraire, appel du contact, en route, livrée (photo du BL signé
 * obligatoire — la décharge reste manuscrite, L7 : le téléphone ne passe
 * jamais au client), échec avec motif, et enregistrement de la position GPS
 * du lieu.
 */
export function LivreurStops({
  stops,
  round,
}: {
  stops: LivreurStop[];
  round: { id: string; statut: string; kmDepart: number | null } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [km, setKm] = useState("");

  function roundStep(step: "depart" | "retour") {
    if (!round) return;
    startTransition(async () => {
      const res = await updateRoundProgress(round.id, step, km ? Number(km) : null);
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(step === "depart" ? "Bonne route !" : "Tournée terminée");
        setKm("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {round && round.statut !== "terminee" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
          <Truck className="h-4 w-4 text-foreground-muted" />
          <span className="text-sm font-medium">Tournée {round.statut === "en_cours" ? "en cours" : "du jour"}</span>
          <input
            type="number"
            inputMode="numeric"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            placeholder="Compteur km"
            className="h-10 w-32 rounded-md border border-border bg-surface px-2 text-base"
          />
          <Button size="md" variant="secondary" loading={pending} onClick={() => roundStep(round.statut === "en_cours" ? "retour" : "depart")}>
            {round.statut === "en_cours" ? "Retour au dépôt" : "Départ"}
          </Button>
        </div>
      )}
      {stops.length === 0 && <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground-muted">Aucune livraison pour aujourd&apos;hui.</p>}
      {stops.map((s, i) => (
        <StopCard key={s.id} stop={s} rang={i + 1} />
      ))}
    </div>
  );
}

function StopCard({ stop, rang }: { stop: LivreurStop; rang: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [photo, setPhoto] = useState<File | null>(null);
  const [motif, setMotif] = useState("");
  const [receptionnaire, setReceptionnaire] = useState("");
  const [showEchec, setShowEchec] = useState(false);
  const l = stop.lieu;
  const gps = l.latitude != null && l.longitude != null;
  const itineraire = gps
    ? `https://www.google.com/maps/dir/?api=1&destination=${l.latitude},${l.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.libelle, l.quartier, l.zone, "Abidjan"].filter(Boolean).join(" "))}`;

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

  async function livree() {
    if (!photo && !stop.hasDecharge) {
      toast.error("Prenez d'abord la photo du BL signé par le client");
      return;
    }
    const pos = await currentPosition();
    run(async () => {
      if (photo) {
        const fd = new FormData();
        fd.set("photo", photo);
        fd.set("type", "decharge_bl");
        if (pos) {
          fd.set("latitude", String(pos.lat));
          fd.set("longitude", String(pos.lng));
        }
        const up = await uploadShipmentDocument(stop.id, fd);
        if (up.error) return up;
      }
      return setShipmentStatus(stop.id, "livree", { receptionnaire, latitude: pos?.lat, longitude: pos?.lng });
    }, "Livraison enregistrée");
  }

  async function savePosition() {
    if (!stop.placeId) return;
    const pos = await currentPosition();
    if (!pos) {
      toast.error("Position GPS indisponible — activez la localisation");
      return;
    }
    run(() => setDeliveryPlacePosition(stop.placeId!, pos.lat, pos.lng, "gps_terrain", true), "Position du lieu enregistrée");
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-foreground-muted">
            Arrêt {rang} · {stop.reference ?? "—"}
          </p>
          <p className="text-base font-semibold text-foreground">{stop.clientNom}</p>
          <p className="text-sm">{l.libelle}</p>
          <p className="text-xs text-foreground-muted">{[l.zone, l.quartier].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge tone={stop.statut === "echec" ? "danger" : stop.statut === "en_route" ? "warning" : "brand"}>{SHIPMENT_STATUS_LABELS[stop.statut]}</Badge>
      </div>
      {l.repere && <p className="rounded-md bg-surface-muted px-2.5 py-1.5 text-sm">📍 {l.repere}</p>}
      {l.consignes && <p className="text-xs text-foreground-muted">Consignes : {l.consignes}</p>}
      {l.horaires && <p className="text-xs text-foreground-muted">Horaires : {l.horaires}</p>}
      <p className="text-sm">
        {stop.pieces} pièce(s){stop.colis ? ` · ${stop.colis} colis` : ""}
        {stop.aEncaisser ? (
          <span className="ml-2 font-semibold text-danger">À encaisser : {formatAmount(stop.aEncaisser)}</span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <a href={itineraire} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium">
          <Navigation className="h-4 w-4" /> Itinéraire
        </a>
        {l.contactTel ? (
          <a href={`tel:${l.contactTel.replace(/\s/g, "")}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium">
            <Phone className="h-4 w-4" /> {l.contactNom ?? "Appeler"}
          </a>
        ) : (
          <span className="inline-flex h-11 items-center justify-center text-xs text-foreground-muted">Pas de téléphone</span>
        )}
        {stop.reference && (
          <a href={`/api/livraisons/${stop.id}/bl`} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-border text-sm font-medium">
            <Printer className="h-4 w-4" /> BL
          </a>
        )}
        {stop.placeId && (
          <Button size="md" variant="secondary" className="h-11" disabled={pending} onClick={savePosition}>
            <Crosshair className="h-4 w-4" /> {gps ? "Corriger la position" : "Enregistrer la position"}
          </Button>
        )}
      </div>

      {stop.statut === "planifiee" && (
        <Button size="md" className="h-12 w-full" loading={pending} onClick={() => run(() => setShipmentStatus(stop.id, "en_route"), "En route")}>
          <MapPin className="h-4 w-4" /> En route
        </Button>
      )}

      {stop.statut === "en_route" && (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-border text-sm font-medium">
            <Camera className="h-5 w-5" />
            {photo ? `Photo prise : ${photo.name}` : stop.hasDecharge ? "Décharge déjà photographiée — reprendre ?" : "Photo du BL signé (obligatoire)"}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          <input
            value={receptionnaire}
            onChange={(e) => setReceptionnaire(e.target.value)}
            placeholder="Nom de la personne qui réceptionne"
            className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base"
          />
          <Button size="md" variant="success" className="h-12 w-full" loading={pending} disabled={!photo && !stop.hasDecharge} onClick={livree}>
            Livrée
          </Button>
          {!showEchec ? (
            <Button size="md" variant="ghost" className="w-full" onClick={() => setShowEchec(true)}>
              Échec de livraison…
            </Button>
          ) : (
            <div className="space-y-2">
              <textarea
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                rows={2}
                placeholder="Motif : client absent, adresse introuvable, refus…"
                className="w-full rounded-md border border-border bg-surface p-2 text-base"
              />
              <Button
                size="md"
                variant="danger"
                className="w-full"
                loading={pending}
                disabled={!motif.trim()}
                onClick={async () => {
                  const pos = await currentPosition();
                  run(() => setShipmentStatus(stop.id, "echec", { commentaire: motif, latitude: pos?.lat, longitude: pos?.lng }), "Échec enregistré");
                }}
              >
                Enregistrer l&apos;échec
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
