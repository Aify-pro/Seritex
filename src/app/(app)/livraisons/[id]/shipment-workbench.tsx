"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { formatAmount } from "@/lib/utils";
import { REGLEMENT_LABELS, type ReglementMention, type ShipmentStatus } from "@/lib/delivery/status";
import type { ShipmentDetail } from "@/lib/delivery/shipment-data";
import {
  addRemainingToShipment,
  markReadyForPickup,
  mergeShipments,
  planShipment,
  prepareShipment,
  saveShipmentPackages,
  setShipmentLineQuantity,
  setShipmentStatus,
  splitShipment,
  uploadShipmentDocument,
  validateShipmentAccounting,
} from "../actions";

type Option = { id: string; label: string };

const input = "h-9 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<{ error?: string }>, ok: string, after?: () => void) =>
    startTransition(async () => {
      const res = await action();
      if (res.error) toast.error("Action refusée", { description: res.error });
      else {
        toast.success(ok);
        after?.();
        router.refresh();
      }
    });
  return { pending, run };
}

/** Lignes de l'expédition : quantités (modifiables avant validation), reste à livrer, scission, regroupement. */
export function ShipmentLines({
  shipment,
  editable,
  remaining,
  mergeCandidates,
}: {
  shipment: ShipmentDetail;
  editable: boolean;
  remaining: number;
  mergeCandidates: Option[];
}) {
  const { pending, run } = useRun();
  const router = useRouter();
  const [splitMode, setSplitMode] = useState(false);
  const [toMove, setToMove] = useState<Record<string, number>>({});
  const total = shipment.lines.reduce((s, l) => s + l.quantite, 0);
  const k = (l: { lineId: string; taille: string }) => `${l.lineId}|${l.taille}`;

  return (
    <Card>
      <CardHeader
        title={`Articles (${total} pièce${total > 1 ? "s" : ""})`}
        description={editable ? "Ajustables jusqu'à la validation comptable — jamais au-delà du 1er choix déclaré en finition." : undefined}
      />
      <CardBody className="space-y-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
              <th className="py-1.5">Article</th>
              <th className="py-1.5">Taille</th>
              <th className="py-1.5 text-right">Quantité</th>
              {shipment.lines.some((l) => l.quantiteLivree !== null) && <th className="py-1.5 text-right">Livrée</th>}
              {splitMode && <th className="py-1.5 text-right">À déplacer</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shipment.lines.map((l) => (
              <tr key={k(l)}>
                <td className="py-1.5">
                  {l.designation} <span className="text-xs text-foreground-muted">{l.odfReference}</span>
                </td>
                <td className="py-1.5">{l.tailleLibelle}</td>
                <td className="py-1.5 text-right">
                  {editable && !splitMode ? (
                    <input
                      key={l.quantite}
                      type="number"
                      min={0}
                      defaultValue={l.quantite}
                      disabled={pending}
                      onBlur={(e) => {
                        const q = Math.floor(Number(e.target.value));
                        if (q !== l.quantite) run(() => setShipmentLineQuantity(shipment.id, l.lineId, l.taille, q), "Quantité enregistrée");
                      }}
                      className={`${input} w-20 text-right`}
                    />
                  ) : (
                    <span className="tabular-nums">{l.quantite}</span>
                  )}
                </td>
                {shipment.lines.some((x) => x.quantiteLivree !== null) && <td className="py-1.5 text-right tabular-nums">{l.quantiteLivree ?? "—"}</td>}
                {splitMode && (
                  <td className="py-1.5 text-right">
                    <input
                      type="number"
                      min={0}
                      max={l.quantite}
                      value={toMove[k(l)] || ""}
                      onChange={(e) => setToMove((m) => ({ ...m, [k(l)]: Math.floor(Number(e.target.value)) }))}
                      className={`${input} w-20 text-right`}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            {remaining > 0 && (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => addRemainingToShipment(shipment.id), "Reste à livrer ajouté")}>
                <Plus className="h-3.5 w-3.5" /> Ajouter le reste à livrer ({remaining})
              </Button>
            )}
            {!splitMode ? (
              <Button size="sm" variant="ghost" onClick={() => setSplitMode(true)}>
                <Scissors className="h-3.5 w-3.5" /> Scinder
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const lignes = shipment.lines
                      .map((l) => ({ line_id: l.lineId, taille: l.taille, quantite: toMove[k(l)] ?? 0 }))
                      .filter((l) => l.quantite > 0);
                    startSplit(lignes);
                  }}
                >
                  Créer l&apos;expédition scindée
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSplitMode(false)}>
                  Annuler
                </Button>
              </>
            )}
            {mergeCandidates.length > 0 && !splitMode && (
              <select
                value=""
                disabled={pending}
                onChange={(e) => {
                  if (e.target.value) run(() => mergeShipments(shipment.id, e.target.value), "Expéditions regroupées");
                }}
                className={`${input} text-xs`}
              >
                <option value="">Regrouper avec une autre expédition du client…</option>
                {mergeCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );

  function startSplit(lignes: { line_id: string; taille: string; quantite: number }[]) {
    if (lignes.length === 0) {
      toast.error("Indiquez les quantités à déplacer");
      return;
    }
    void splitShipment(shipment.id, lignes).then((res) => {
      if (res.error) toast.error("Scission refusée", { description: res.error });
      else {
        toast.success("Expédition scindée");
        setSplitMode(false);
        setToMove({});
        if (res.newId) router.push(`/livraisons/${res.newId}`);
        else router.refresh();
      }
    });
  }
}

/** Préparation : mode, lieu (copié sur le BL), date promise, colis. Attribue le numéro de BL. */
export function PreparationForm({
  shipment,
  places,
}: {
  shipment: ShipmentDetail;
  places: (Option & { parDefaut: boolean })[];
}) {
  const { pending, run } = useRun();
  const [mode, setMode] = useState<"livraison" | "retrait">(shipment.mode);
  const [placeId, setPlaceId] = useState(shipment.deliveryPlaceId ?? places.find((p) => p.parDefaut)?.id ?? "");
  const [date, setDate] = useState(shipment.datePromise ?? "");
  const [colis, setColis] = useState(
    shipment.packages.length
      ? shipment.packages.map((p) => ({ poidsKg: p.poidsKg, dimensions: p.dimensions, contenu: p.contenu }))
      : [{ poidsKg: null as number | null, dimensions: null as string | null, contenu: null as string | null }]
  );

  return (
    <Card>
      <CardHeader
        title={shipment.reference ? `Préparation — ${shipment.reference}` : "Préparation"}
        description="Le lieu est copié sur le BL au moment de la préparation : il ne bougera plus si la fiche du lieu change."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-foreground-muted">Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "livraison" | "retrait")} className={input}>
              <option value="livraison">Livraison</option>
              <option value="retrait">Retrait sur place (enlèvement par le client)</option>
            </select>
          </label>
          {mode === "livraison" && (
            <label className="block">
              <span className="mb-1 block text-xs text-foreground-muted">Lieu de livraison</span>
              <select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className={`${input} w-64`}>
                <option value="">— Choisir —</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.parDefaut ? " (par défaut)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-foreground-muted">Date promise</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </label>
        </div>
        {mode === "livraison" && places.length === 0 && (
          <p className="text-xs text-warning">Ce client n&apos;a aucun lieu de livraison : créez-en un sur sa fiche client.</p>
        )}

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-foreground-muted">Colis</p>
          {colis.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-xs text-foreground-muted">n°{i + 1}</span>
              <input
                type="number"
                step="0.1"
                min={0}
                placeholder="kg"
                value={c.poidsKg ?? ""}
                onChange={(e) => setColis((all) => all.map((x, j) => (j === i ? { ...x, poidsKg: e.target.value ? Number(e.target.value) : null } : x)))}
                className={`${input} w-20`}
              />
              <input
                placeholder="Dimensions"
                value={c.dimensions ?? ""}
                onChange={(e) => setColis((all) => all.map((x, j) => (j === i ? { ...x, dimensions: e.target.value } : x)))}
                className={`${input} w-32`}
              />
              <input
                placeholder="Contenu (ex. M 50 + L 20)"
                value={c.contenu ?? ""}
                onChange={(e) => setColis((all) => all.map((x, j) => (j === i ? { ...x, contenu: e.target.value } : x)))}
                className={`${input} w-56`}
              />
              <button type="button" onClick={() => setColis((all) => all.filter((_, j) => j !== i))} className="text-foreground-muted hover:text-danger" aria-label="Retirer">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setColis((all) => [...all, { poidsKg: null, dimensions: null, contenu: null }])}>
            <Plus className="h-3.5 w-3.5" /> Colis
          </Button>
        </div>

        <Button
          loading={pending}
          disabled={mode === "livraison" && !placeId}
          onClick={() =>
            run(async () => {
              const saved = await saveShipmentPackages(shipment.id, colis);
              if (saved.error) return saved;
              return prepareShipment(shipment.id, mode === "livraison" ? placeId : null, mode, date || null);
            }, shipment.reference ? "Préparation mise à jour" : "Expédition préparée — BL numéroté")
          }
        >
          {shipment.reference ? "Mettre à jour la préparation" : "Préparer et numéroter le BL"}
        </Button>
      </CardBody>
    </Card>
  );
}

/** Validation comptable (L3) : mention de règlement obligatoire, montant si à encaisser. */
export function AccountingForm({
  shipmentId,
  hint,
}: {
  shipmentId: string;
  hint: { devisReference: string; devisTotal: number; devise: string; conditions: string | null; mode: string | null } | null;
}) {
  const { pending, run } = useRun();
  const [mention, setMention] = useState<ReglementMention | "">("");
  const [montant, setMontant] = useState("");
  const [texte, setTexte] = useState("");
  return (
    <Card className="border-warning/30">
      <CardHeader title="Validation comptable" description="Obligatoire avant tout départ ou enlèvement. La mention et le montant à encaisser sont imprimés sur le BL." />
      <CardBody className="space-y-3">
        {hint && (
          <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
            Devis {hint.devisReference} : {formatAmount(hint.devisTotal, hint.devise)}
            {hint.conditions ? ` · ${hint.conditions}` : ""}
            {hint.mode ? ` · ${hint.mode}` : ""}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-foreground-muted">Mention de règlement</span>
            <select value={mention} onChange={(e) => setMention(e.target.value as ReglementMention)} className={input}>
              <option value="">— Choisir —</option>
              {(Object.keys(REGLEMENT_LABELS) as ReglementMention[]).map((m) => (
                <option key={m} value={m}>
                  {REGLEMENT_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          {mention === "a_encaisser" && (
            <label className="block">
              <span className="mb-1 block text-xs text-foreground-muted">Montant à encaisser (F CFA)</span>
              <input type="number" min={0} value={montant} onChange={(e) => setMontant(e.target.value)} className={`${input} w-40`} />
            </label>
          )}
          {mention === "autre" && (
            <label className="block">
              <span className="mb-1 block text-xs text-foreground-muted">Précision</span>
              <input value={texte} onChange={(e) => setTexte(e.target.value)} className={`${input} w-64`} />
            </label>
          )}
          <Button
            loading={pending}
            disabled={!mention}
            onClick={() =>
              run(() => validateShipmentAccounting(shipmentId, mention, montant ? Number(montant) : null, texte || null), "Livraison validée par la comptabilité")
            }
          >
            Valider
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Planification (livraison) : transporteur, véhicule, livreur, date. */
export function PlanningForm({
  shipment,
  carriers,
  vehicles,
  livreurs,
}: {
  shipment: ShipmentDetail;
  carriers: Option[];
  vehicles: Option[];
  livreurs: Option[];
}) {
  const { pending, run } = useRun();
  const [carrierId, setCarrierId] = useState(shipment.carrierId ?? carriers[0]?.id ?? "");
  const [vehicleId, setVehicleId] = useState(shipment.vehicleId ?? "");
  const [livreurId, setLivreurId] = useState(shipment.livreurId ?? "");
  const [date, setDate] = useState(shipment.datePlanifiee ?? shipment.datePromise ?? "");
  return (
    <Card>
      <CardHeader title="Planification" />
      <CardBody className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Transporteur</span>
          <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)} className={input}>
            <option value="">—</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Véhicule</span>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={input}>
            <option value="">—</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Livreur</span>
          <select value={livreurId} onChange={(e) => setLivreurId(e.target.value)} className={input}>
            <option value="">—</option>
            {livreurs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-foreground-muted">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <Button
          loading={pending}
          disabled={!date}
          onClick={() => run(() => planShipment(shipment.id, carrierId || null, vehicleId || null, livreurId || null, date), "Livraison planifiée")}
        >
          Planifier
        </Button>
      </CardBody>
    </Card>
  );
}

/** Gestes de statut proposés au service livraison selon l'état de l'expédition. */
export function StatusActions({ shipment, hasDecharge }: { shipment: ShipmentDetail; hasDecharge: boolean }) {
  const { pending, run } = useRun();
  const [photo, setPhoto] = useState<File | null>(null);
  const [motif, setMotif] = useState("");
  const [receptionnaire, setReceptionnaire] = useState("");
  const s: ShipmentStatus = shipment.statut;
  const canCancel = ["a_preparer", "preparee", "validee_compta", "planifiee", "prete_a_enlever", "echec"].includes(s);

  return (
    <Card>
      <CardHeader title="Suivi" />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {s === "validee_compta" && shipment.mode === "retrait" && (
            <Button loading={pending} onClick={() => run(() => markReadyForPickup(shipment.id), "Prête à enlever")}>
              Marquer prête à enlever
            </Button>
          )}
          {s === "planifiee" && (
            <Button loading={pending} onClick={() => run(() => setShipmentStatus(shipment.id, "en_route"), "En route")}>
              En route
            </Button>
          )}
          {s === "en_route" && (
            <>
              <Button
                loading={pending}
                disabled={!photo && !hasDecharge}
                title="La photo du BL signé est obligatoire"
                onClick={() =>
                  run(async () => {
                    if (photo) {
                      const fd = new FormData();
                      fd.set("photo", photo);
                      fd.set("type", "decharge_bl");
                      const up = await uploadShipmentDocument(shipment.id, fd);
                      if (up.error) return up;
                    }
                    return setShipmentStatus(shipment.id, "livree", { receptionnaire });
                  }, "Livrée")
                }
              >
                Livrée
              </Button>
              <Button variant="danger" disabled={!motif.trim() || pending} onClick={() => run(() => setShipmentStatus(shipment.id, "echec", { commentaire: motif }), "Échec enregistré")}>
                Échec
              </Button>
            </>
          )}
          {s === "prete_a_enlever" && (
            <Button
              loading={pending}
              disabled={!receptionnaire.trim()}
              onClick={() => run(() => setShipmentStatus(shipment.id, "enlevee", { receptionnaire }), "Enlèvement enregistré")}
            >
              Enlevée par le client
            </Button>
          )}
          {["livree", "enlevee", "reception_confirmee"].includes(s) && (
            <Button variant="danger" disabled={!motif.trim() || pending} onClick={() => run(() => setShipmentStatus(shipment.id, "litige", { commentaire: motif }), "Litige ouvert")}>
              Ouvrir un litige
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" disabled={!motif.trim() || pending} onClick={() => run(() => setShipmentStatus(shipment.id, "annulee", { commentaire: motif }), "Expédition annulée")}>
              Annuler l&apos;expédition
            </Button>
          )}
        </div>
        {s === "en_route" && (
          <label className="block text-xs text-foreground-muted">
            Photo du BL signé {hasDecharge ? "(déjà déposée)" : "(obligatoire pour « Livrée »)"}
            <input type="file" accept="image/*" className="mt-1 block text-xs" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {(s === "prete_a_enlever" || s === "en_route") && (
          <input value={receptionnaire} onChange={(e) => setReceptionnaire(e.target.value)} placeholder="Nom de la personne qui réceptionne / enlève" className={`${input} w-80`} />
        )}
        <textarea
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          rows={2}
          placeholder="Motif (échec, litige, annulation)"
          className="w-full rounded-md border border-border bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
        />
      </CardBody>
    </Card>
  );
}
