"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crosshair, MapPin, Pencil, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { PlaceMap, type MapPoint } from "@/components/delivery/place-map";
import { POSITION_SOURCE_LABELS, type DeliveryPlace, type DeliveryZone, type PositionSource } from "@/lib/types/domain";
import {
  saveDeliveryPlace,
  setDefaultDeliveryPlace,
  setDeliveryPlaceActive,
  setDeliveryPlacePosition,
  uploadDeliveryPlacePhoto,
} from "@/lib/actions/delivery-places";

export type PlaceWithPhoto = DeliveryPlace & { photoUrl: string | null };

/**
 * Lieux de livraison d'un client (LIV-0) : plusieurs lieux, un seul par
 * défaut ; repères, contact sur place, horaires, consignes, photo ; position
 * posée sur la carte OpenStreetMap ou prise au GPS. Indépendants de Sage.
 */
export function DeliveryPlaces({
  companyId,
  places,
  zones,
  editable,
}: {
  companyId: string;
  places: PlaceWithPhoto[];
  zones: Pick<DeliveryZone, "id" | "nom">[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<PlaceWithPhoto | "new" | null>(null);
  const actifs = places.filter((p) => p.actif);
  const points: MapPoint[] = actifs
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({ id: p.id, lat: Number(p.latitude), lng: Number(p.longitude), label: p.libelle }));
  const zoneNom = (id: string | null) => zones.find((z) => z.id === id)?.nom ?? null;

  function run(label: string, action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(label);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      {points.length > 0 && <PlaceMap points={points} height={240} />}
      {actifs.length === 0 ? (
        <p className="text-sm text-foreground-muted">Aucun lieu de livraison pour ce client.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {actifs.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-surface-muted text-foreground-muted">
                    <MapPin className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    {p.libelle}
                    {p.par_defaut && (
                      <Badge tone="brand">
                        <Star className="h-3 w-3" /> Par défaut
                      </Badge>
                    )}
                    {p.latitude === null ? (
                      <Badge tone="warning">Sans position</Badge>
                    ) : p.position_confirmee_at ? (
                      <Badge tone="success">Position confirmée</Badge>
                    ) : (
                      <Badge tone="neutral">{POSITION_SOURCE_LABELS[p.position_source as PositionSource]}</Badge>
                    )}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {[zoneNom(p.zone_id), p.quartier].filter(Boolean).join(" · ") || "Zone non renseignée"}
                  </p>
                  {p.repere && <p className="text-xs text-foreground">Repères : {p.repere}</p>}
                  {(p.contact_nom || p.contact_tel) && (
                    <p className="text-xs text-foreground-muted">
                      Sur place : {[p.contact_nom, p.contact_tel].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {p.horaires && <p className="text-xs text-foreground-muted">Horaires : {p.horaires}</p>}
                  {p.consignes && <p className="text-xs text-foreground-muted">Consignes : {p.consignes}</p>}
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  {!p.par_defaut && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("Lieu par défaut modifié", () => setDefaultDeliveryPlace(companyId, p.id))}>
                      <Star className="h-3.5 w-3.5" /> Par défaut
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("Lieu désactivé", () => setDeliveryPlaceActive(companyId, p.id, false))}>
                    Désactiver
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          <Plus className="h-3.5 w-3.5" /> Ajouter un lieu
        </Button>
      )}
      {editing && (
        <PlaceDialog
          key={editing === "new" ? "new" : editing.id}
          companyId={companyId}
          place={editing === "new" ? null : editing}
          zones={zones}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const input = "h-9 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";

function PlaceDialog({
  companyId,
  place,
  zones,
  onClose,
}: {
  companyId: string;
  place: PlaceWithPhoto | null;
  zones: Pick<DeliveryZone, "id" | "nom">[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    libelle: place?.libelle ?? "",
    zone_id: place?.zone_id ?? "",
    quartier: place?.quartier ?? "",
    repere: place?.repere ?? "",
    contact_nom: place?.contact_nom ?? "",
    contact_tel: place?.contact_tel ?? "",
    horaires: place?.horaires ?? "",
    consignes: place?.consignes ?? "",
  });
  const [pin, setPin] = useState<{ lat: number; lng: number; source: PositionSource } | null>(
    place?.latitude != null && place.longitude != null
      ? { lat: Number(place.latitude), lng: Number(place.longitude), source: (place.position_source ?? "carte") as PositionSource }
      : null
  );
  const [pinChanged, setPinChanged] = useState(false);
  const [confirmee, setConfirmee] = useState(!!place?.position_confirmee_at);
  const [photo, setPhoto] = useState<File | null>(null);
  const [locating, setLocating] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function locate() {
    if (!navigator.geolocation) {
      toast.error("Géolocalisation indisponible sur cet appareil");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "gps_terrain" });
        setPinChanged(true);
        setConfirmee(true);
      },
      (err) => {
        setLocating(false);
        toast.error("Position introuvable", { description: err.message });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function save() {
    startTransition(async () => {
      const res = await saveDeliveryPlace(companyId, place?.id ?? null, {
        ...form,
        zone_id: form.zone_id || null,
        quartier: form.quartier || null,
        repere: form.repere || null,
        contact_nom: form.contact_nom || null,
        contact_tel: form.contact_tel || null,
        horaires: form.horaires || null,
        consignes: form.consignes || null,
      });
      if (res.error || !res.id) {
        toast.error("Enregistrement refusé", { description: res.error });
        return;
      }
      const confirmChanged = !!place?.position_confirmee_at !== confirmee;
      if (pin && (pinChanged || confirmChanged)) {
        const pos = await setDeliveryPlacePosition(res.id, pin.lat, pin.lng, pin.source, confirmee);
        if (pos.error) toast.error("Position non enregistrée", { description: pos.error });
      }
      if (photo) {
        const fd = new FormData();
        fd.set("photo", photo);
        const up = await uploadDeliveryPlacePhoto(companyId, res.id, fd);
        if (up.error) toast.error("Photo non enregistrée", { description: up.error });
      }
      toast.success("Lieu de livraison enregistré");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={place ? `Modifier « ${place.libelle} »` : "Nouveau lieu de livraison"} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Libellé</span>
            <input value={form.libelle} onChange={set("libelle")} placeholder="ex. Siège Plateau, Entrepôt Yopougon" className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Zone / commune</span>
            <select value={form.zone_id} onChange={set("zone_id")} className={input}>
              <option value="">—</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nom}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Quartier</span>
            <input value={form.quartier} onChange={set("quartier")} className={input} />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Repères</span>
            <textarea
              value={form.repere}
              onChange={set("repere")}
              rows={2}
              placeholder="ex. Face pharmacie du Rond-point, portail bleu"
              className="w-full rounded-md border border-border bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Contact sur place</span>
            <input value={form.contact_nom} onChange={set("contact_nom")} className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Téléphone sur place</span>
            <input value={form.contact_tel} onChange={set("contact_tel")} inputMode="tel" className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Horaires</span>
            <input value={form.horaires} onChange={set("horaires")} placeholder="ex. lun-ven 8h-17h" className={input} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Photo du lieu</span>
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="block w-full text-xs" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-foreground-muted">Consignes</span>
            <input value={form.consignes} onChange={set("consignes")} className={input} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground-muted">
              Position — cliquez sur la carte pour poser l&apos;épingle
              {pin && ` · ${POSITION_SOURCE_LABELS[pin.source]} (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})`}
            </p>
            <Button size="sm" variant="secondary" onClick={locate} loading={locating}>
              <Crosshair className="h-3.5 w-3.5" /> Ma position GPS
            </Button>
          </div>
          <PlaceMap
            points={pin ? [{ id: "pin", lat: pin.lat, lng: pin.lng, label: form.libelle || "Lieu", highlight: true }] : []}
            onPick={(lat, lng) => {
              setPin({ lat, lng, source: "carte" });
              setPinChanged(true);
            }}
          />
          {pin && (
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={confirmee} onChange={(e) => setConfirmee(e.target.checked)} />
              Position confirmée (vérifiée sur place ou par le client)
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={save} loading={pending} disabled={!form.libelle.trim()}>
            Enregistrer
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
