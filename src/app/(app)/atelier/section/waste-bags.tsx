"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ChevronRight, ExternalLink, Lock, Plus, Printer, QrCode, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { QrScannerDialog } from "@/components/atelier/qr-scanner-dialog";
import { formatDateTime, cn } from "@/lib/utils";
import {
  closeWasteBag,
  createWasteBag,
  getWasteBagByCode,
  recordBagWeighing,
  type WasteBagDetails,
} from "./actions";
import type { MatelasDechetRow, WasteBagRow } from "./types";

/**
 * Le QR d'un sac encode l'URL de sa fiche (`/dechets/SAC-2026-00042`, voir
 * `dechets/[code]/page.tsx`). On n'en retient que le code, qui suffit à le
 * retrouver — et un QR ne portant que le code brut est accepté aussi.
 * Constante de module : le lecteur relance la caméra si son `pattern` change
 * d'identité.
 */
const BAG_QR_PATTERN = /(SAC-\d{4}-\d+)/i;

export const formatKg = (kg: number) => `${kg.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`;

/* ============================================================
   Fenêtre « Sacs de déchets » (barre d'actions de la file Coupe)
============================================================ */

/**
 * Liste des sacs en cours avec leur poids, création d'un sac, et lecteur QR
 * qui ouvre la traçabilité complète de n'importe quel sac — en cours comme
 * scellé. La pesée, elle, ne se fait plus ici : elle se fait depuis la fiche
 * du matelas dont on vient de vider les chutes, pour que le delta lui soit
 * rattaché (migration 0053).
 *
 * Les sacs ouverts sont détenus par l'écran appelant : la barre d'actions en
 * affiche le nombre, et une pesée faite depuis un matelas doit mettre à jour
 * le poids affiché ici.
 */
export function WasteBagsDialog({
  open,
  onOpenChange,
  bags,
  setBags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bags: WasteBagRow[];
  setBags: React.Dispatch<React.SetStateAction<WasteBagRow[]>>;
}) {
  const [creating, startCreating] = useTransition();
  const [loading, startLoading] = useTransition();
  const [scanOpen, setScanOpen] = useState(false);
  const [details, setDetails] = useState<WasteBagDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    startCreating(async () => {
      const res = await createWasteBag();
      if ("error" in res) {
        toast.error("Action refusée", { description: res.error });
        return;
      }
      setBags((prev) => [{ id: res.id, code: res.code, currentWeightKg: 0, createdAt: new Date().toISOString() }, ...prev]);
      toast.success(`Sac ${res.code} créé`);
    });
  }

  function showBag(code: string) {
    setError(null);
    startLoading(async () => {
      const res = await getWasteBagByCode(code);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDetails(res.bag);
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          onOpenChange(value);
          if (!value) {
            setDetails(null);
            setError(null);
          }
        }}
        title={details ? `Sac ${details.code}` : "Sacs de déchets"}
        description={details ? "Traçabilité complète du sac." : "Un sac peut mélanger plusieurs ordres de fabrication."}
        size="lg"
      >
        {details ? (
          <WasteBagDetailsView
            bag={details}
            onBack={() => setDetails(null)}
            onSealed={(sealed) => {
              setDetails(sealed);
              setBags((prev) => prev.filter((b) => b.id !== sealed.id));
            }}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button size="md" className="w-full" onClick={handleCreate} loading={creating}>
                <Plus className="h-4 w-4" /> Nouveau sac
              </Button>
              <Button size="md" variant="secondary" className="w-full" onClick={() => setScanOpen(true)}>
                <ScanLine className="h-4 w-4" /> Scanner un sac
              </Button>
            </div>

            {bags.length > 0 ? (
              <a
                href="/api/dechets/etiquettes"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-surface-muted"
              >
                <Printer className="h-4 w-4" /> Générer les QR codes ({bags.length} sac{bags.length > 1 ? "s" : ""} en
                cours, planche A4)
              </a>
            ) : (
              <p
                aria-disabled
                className="flex min-h-9 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground-muted opacity-50"
              >
                <Printer className="h-4 w-4" /> Générer les QR codes (aucun sac en cours)
              </p>
            )}

            {error && <ErrorBox message={error} />}
            {loading && <p className="text-xs text-foreground-muted">Chargement du sac…</p>}

            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                Sacs en cours ({bags.length})
              </h3>
              {bags.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-foreground-muted">
                  Aucun sac en cours — créez-en un pour y verser les déchets des matelas.
                </p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                  {bags.map((bag) => (
                    <li key={bag.id}>
                      <button
                        type="button"
                        onClick={() => showBag(bag.code)}
                        className="flex min-h-12 w-full items-center gap-3 bg-surface px-3 py-2.5 text-left hover:bg-surface-muted"
                      >
                        <Trash2 className="h-4 w-4 shrink-0 text-foreground-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm text-foreground">{bag.code}</span>
                          <span className="block text-xs text-foreground-muted">Créé le {formatDateTime(bag.createdAt)}</span>
                        </span>
                        <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                          {formatKg(bag.currentWeightKg)}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-foreground-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scanner un sac de déchets"
        description="Sac en cours ou scellé — visez l'étiquette QR du sac."
        pattern={BAG_QR_PATTERN}
        invalidMessage="Ce QR n'est pas celui d'un sac de déchets Seritex."
        onMatch={(code) => {
          setScanOpen(false);
          showBag(code);
        }}
      />
    </>
  );
}

function WasteBagDetailsView({
  bag,
  onBack,
  onSealed,
}: {
  bag: WasteBagDetails;
  onBack: () => void;
  onSealed: (bag: WasteBagDetails) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sealing, startSealing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scelle = bag.statut === "charge";

  function seal() {
    setError(null);
    startSealing(async () => {
      const res = await closeWasteBag(bag.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      const refreshed = await getWasteBagByCode(bag.code);
      if ("bag" in refreshed) onSealed(refreshed.bag);
      toast.success(`Sac ${bag.code} scellé`);
      setConfirming(false);
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à la liste
      </button>

      <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface p-3 text-sm">
        <Fact label="Statut">
          <Badge tone={scelle ? "success" : "brand"}>{scelle ? "Scellé" : "En cours"}</Badge>
        </Fact>
        <Fact label={scelle ? "Poids final" : "Poids actuel"}>
          <span className="font-semibold tabular-nums">{formatKg(bag.poidsKg)}</span>
        </Fact>
        <Fact label="Créé le">
          {formatDateTime(bag.createdAt)}
          {bag.createdByName && <span className="block text-xs text-foreground-muted">par {bag.createdByName}</span>}
        </Fact>
        <Fact label="Scellé le">
          {bag.closedAt ? formatDateTime(bag.closedAt) : "—"}
          {bag.closedByName && <span className="block text-xs text-foreground-muted">par {bag.closedByName}</span>}
        </Fact>
        <Fact label="Ajouts">{bag.weighings.length}</Fact>
        <Fact label="Étiquette">
          <a
            href={`/dechets/${bag.code}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            <QrCode className="h-3.5 w-3.5" /> QR à imprimer <ExternalLink className="h-3 w-3" />
          </a>
        </Fact>
      </div>

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Historique des ajouts
        </h3>
        {bag.weighings.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-foreground-muted">
            Aucun ajout enregistré dans ce sac.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-surface">
            {bag.weighings.map((w) => (
              <li key={w.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {[w.odfReference, w.traceReference].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <span className="block truncate text-xs text-foreground-muted">
                    {[w.clientName, w.authorName].filter(Boolean).join(" · ")}
                  </span>
                  <span className="block text-xs text-foreground-muted">{formatDateTime(w.occurredAt)}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium tabular-nums text-foreground">+{formatKg(w.deltaKg)}</span>
                  <span className="block text-xs tabular-nums text-foreground-muted">total {formatKg(w.poidsReleveKg)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <ErrorBox message={error} />}

      {!scelle &&
        (confirming ? (
          <div className="space-y-2 rounded-md border border-warning/40 bg-warning-soft/40 p-3">
            <p className="text-sm text-foreground">
              Sceller <strong>{bag.code}</strong> à {formatKg(bag.poidsKg)} ? C&apos;est définitif : plus aucun ajout ne
              sera possible dans ce sac.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <Button size="md" variant="danger" className="w-full sm:w-auto" onClick={seal} loading={sealing}>
                <Lock className="h-4 w-4" /> Confirmer le scellage
              </Button>
              <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => setConfirming(false)}>
                Annuler
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="md"
            variant="secondary"
            className="w-full"
            onClick={() => setConfirming(true)}
            disabled={bag.weighings.length === 0}
          >
            <Lock className="h-4 w-4" /> Sceller le sac
          </Button>
        ))}
    </div>
  );
}

/* ============================================================
   Pesée des déchets d'un matelas — scan du sac, nouveau poids
============================================================ */

/**
 * Le chef de section vide les chutes du matelas dans un sac en cours, scanne
 * le sac, et saisit le nouveau poids total affiché par la balance. C'est la
 * base qui fait la différence avec le relevé précédent (`record_bag_weighing`)
 * et rattache ce delta au matelas : aucun calcul de tête, et aucun champ
 * « poids des déchets » à remplir.
 *
 * Plusieurs pesées sont possibles pour un même matelas (sac plein en cours de
 * route) : `close_matelas` en fait la somme.
 */
export function MatelasWastePesee({
  productionOrderId,
  traceId,
  dechets,
  onWeighed,
}: {
  productionOrderId: string | null;
  traceId: string;
  dechets: MatelasDechetRow[];
  onWeighed: (row: MatelasDechetRow, bag: { id: string; poidsReleveKg: number }) => void;
}) {
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [bag, setBag] = useState<WasteBagDetails | null>(null);
  const [poids, setPoids] = useState("");
  const [error, setError] = useState<string | null>(null);
  const total = dechets.reduce((sum, d) => sum + d.deltaKg, 0);

  function loadBag(code: string) {
    setError(null);
    startLoading(async () => {
      const res = await getWasteBagByCode(code);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if (res.bag.statut === "charge") {
        setError(`Le sac ${res.bag.code} est scellé — scannez un sac en cours ou créez-en un nouveau.`);
        return;
      }
      setBag(res.bag);
      setPoids("");
    });
  }

  const nouveauPoids = Number(poids.replace(",", "."));
  const poidsValide = poids.trim() !== "" && Number.isFinite(nouveauPoids) && bag !== null && nouveauPoids > bag.poidsKg;

  function submit() {
    if (!bag || !productionOrderId || !poidsValide) return;
    setError(null);
    startSaving(async () => {
      const res = await recordBagWeighing(bag.id, nouveauPoids, productionOrderId, traceId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onWeighed(
        { id: res.id, bagCode: bag.code, deltaKg: res.deltaKg, occurredAt: new Date().toISOString() },
        { id: bag.id, poidsReleveKg: nouveauPoids }
      );
      toast.success(`+${formatKg(res.deltaKg)} de déchets pour ce matelas (sac ${bag.code})`);
      setBag(null);
      setPoids("");
    });
  }

  return (
    <div className="space-y-2">
      {dechets.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border bg-surface">
          {dechets.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <Trash2 className="h-4 w-4 shrink-0 text-foreground-muted" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground-muted">
                {d.bagCode} · {formatDateTime(d.occurredAt)}
              </span>
              <span className="shrink-0 font-medium tabular-nums">+{formatKg(d.deltaKg)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
            <span>Déchets du matelas</span>
            <span className="tabular-nums">{formatKg(total)}</span>
          </li>
        </ul>
      )}

      {error && <ErrorBox message={error} />}

      {bag ? (
        <div className="space-y-2 rounded-md border border-brand/30 bg-brand-soft/30 p-3">
          <p className="text-sm text-foreground">
            Sac <span className="font-mono font-medium">{bag.code}</span> — dernier poids{" "}
            <strong className="tabular-nums">{formatKg(bag.poidsKg)}</strong>
          </p>
          <label htmlFor={`poids-sac-${traceId}`} className="block text-xs text-foreground-muted">
            Nouveau poids total du sac (kg), une fois les déchets de ce matelas ajoutés
          </label>
          <input
            id={`poids-sac-${traceId}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            autoFocus
            value={poids}
            onChange={(e) => setPoids(e.target.value)}
            className="h-11 w-full rounded-md border border-border bg-surface px-2 text-base outline-none focus:ring-2 focus:ring-brand/30"
          />
          {poids.trim() !== "" && bag && Number.isFinite(nouveauPoids) && (
            <p className={cn("text-xs", nouveauPoids > bag.poidsKg ? "text-foreground-muted" : "text-danger")}>
              {nouveauPoids > bag.poidsKg
                ? `Déchets de ce matelas : ${formatKg(nouveauPoids - bag.poidsKg)}`
                : "Le nouveau poids doit être supérieur au dernier poids du sac."}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button size="md" className="w-full sm:w-auto" onClick={submit} loading={saving} disabled={!poidsValide}>
              Valider la pesée
            </Button>
            <Button size="md" variant="ghost" className="w-full sm:w-auto" onClick={() => setBag(null)}>
              Annuler
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="md"
          variant="secondary"
          className="w-full"
          onClick={() => setScanOpen(true)}
          loading={loading}
          disabled={!productionOrderId}
        >
          <ScanLine className="h-4 w-4" />
          {dechets.length > 0 ? "Ajouter une pesée (scanner un sac)" : "Peser les déchets — scanner le sac"}
        </Button>
      )}

      <QrScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        title="Scanner le sac de déchets"
        description="Le sac en cours dans lequel vous versez les chutes de ce matelas."
        pattern={BAG_QR_PATTERN}
        invalidMessage="Ce QR n'est pas celui d'un sac de déchets Seritex."
        onMatch={(code) => {
          setScanOpen(false);
          loadBag(code);
        }}
      />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-foreground-muted">{label}</p>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-sm text-danger">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
    </div>
  );
}
