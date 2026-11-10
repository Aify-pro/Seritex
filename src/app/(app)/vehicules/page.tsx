import Link from "next/link";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { requireAnyModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Th, Td, EmptyRow } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import { VEHICLE_TYPE_LABELS } from "@/lib/types/domain";
import {
  DOCUMENT_STATUT_LABELS,
  DOCUMENT_STATUT_TONES,
  FUEL_VOUCHER_STATUT_LABELS,
  FUEL_VOUCHER_STATUT_TONES,
  FUEL_VOUCHER_TABS,
  VEHICLE_STATUT_LABELS,
  VEHICLE_STATUT_TONES,
  VEHICLE_USAGE_LABELS,
  formatKm,
  vehicleLabel,
  type DocumentStatut,
} from "@/lib/vehicules/labels";
import { loadAlerts, loadAnnuaire, loadCostLines, loadFleet, loadKmSince, loadVouchers, type FleetVehicle } from "@/lib/vehicules/data";
import { NewFuelVoucherButton, NewVehicleButton } from "@/components/vehicules/vehicle-dialogs";

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string) => {
  const v = p[k];
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
};

const TABS = [
  { key: "parc", label: "Parc", module: "vehicules" },
  { key: "alertes", label: "Alertes", module: "vehicules" },
  { key: "bons", label: "Bons de carburant", module: "bons_carburant" },
  { key: "couts", label: "Coûts", module: "vehicules" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Pire état des documents d'un véhicule, pour la colonne « Documents ». */
const ORDER: DocumentStatut[] = ["expire", "urgent", "manquant", "a_renouveler", "valide", "facultatif", "non_concerne"];
function worstDocument(v: FleetVehicle) {
  const sorted = [...v.compliance].sort((a, b) => ORDER.indexOf(a.statut) - ORDER.indexOf(b.statut));
  const worst = sorted[0];
  if (!worst) return null;
  const same = sorted.filter((c) => c.statut === worst.statut);
  return { statut: worst.statut, texte: same.length > 1 ? `${same.length} documents` : worst.libelle };
}

/**
 * Logistique > Véhicules : le parc (fiche par véhicule), les alertes
 * (documents, entretien, pannes, bons à valider), les bons de carburant et les
 * coûts. Le module Livraison garde les expéditions et les tournées.
 */
export default async function VehiculesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAnyModule(["vehicules", "bons_carburant"]);
  const params = await searchParams;
  const [canVehicles, canVouchers, canCreateVehicle, canCreateVoucher] = await Promise.all([
    can("vehicules", "view"),
    can("bons_carburant", "view"),
    can("vehicules", "create"),
    can("bons_carburant", "create"),
  ]);
  const allowed = TABS.filter((t) => (t.module === "vehicules" ? canVehicles : canVouchers));
  const tab = (allowed.find((t) => t.key === one(params, "onglet"))?.key ?? allowed[0].key) as TabKey;

  const supabase = await createClient();
  const [fleet, annuaire, { data: stations }] = await Promise.all([
    loadFleet(),
    canCreateVoucher ? loadAnnuaire() : Promise.resolve(new Map()),
    canCreateVoucher ? supabase.from("fuel_stations").select("id,nom").eq("actif", true).order("nom") : Promise.resolve({ data: [] }),
  ]);
  const alerts = canVehicles ? await loadAlerts(fleet) : [];
  const critiques = alerts.filter((a) => a.gravite === "critique").length;
  const enService = fleet.filter((v) => v.actif && v.statut !== "vendu");

  const voucherButton = canCreateVoucher ? (
    <NewFuelVoucherButton
      vehicles={enService.map((v) => ({ id: v.id, label: vehicleLabel(v), blocage: v.blocage, titulaireId: v.titulaire?.id ?? null, kmActuel: v.kmActuel }))}
      employes={[...annuaire.values()].filter((e) => e.statut === "actif").map((e) => ({ id: e.id, nom: e.nom, matricule: e.matricule }))}
      stations={(stations ?? []) as { id: string; nom: string }[]}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Véhicules"
        description="Le parc, les papiers, les chauffeurs, le carburant, l'entretien et les coûts. Les expéditions et tournées restent dans Livraisons."
        action={
          <div className="flex flex-wrap gap-2">
            {voucherButton}
            {canCreateVehicle && <NewVehicleButton />}
          </div>
        }
      />

      <nav aria-label="Rubriques" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {allowed.map((t) => (
          <Link
            key={t.key}
            href={`/vehicules?onglet=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label}
            {t.key === "parc" && <span className="ml-1 text-xs text-foreground-muted">({enService.length})</span>}
            {t.key === "alertes" && alerts.length > 0 && (
              <span className={cn("ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]", critiques ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                {alerts.length}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "parc" && <ParcTab fleet={fleet} showAll={one(params, "tous") === "1"} />}
      {tab === "alertes" && <AlertesTab alerts={alerts} />}
      {tab === "bons" && <BonsTab sub={one(params, "statut")} fleet={fleet} />}
      {tab === "couts" && <CoutsTab fleet={fleet} periode={one(params, "periode")} />}
    </div>
  );
}

function ParcTab({ fleet, showAll }: { fleet: FleetVehicle[]; showAll: boolean }) {
  const hidden = fleet.filter((v) => !v.actif || v.statut === "vendu").length;
  const visible = showAll ? fleet : fleet.filter((v) => v.actif && v.statut !== "vendu");
  return (
    <div className="space-y-3">
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Véhicule</Th>
              <Th>Usage</Th>
              <Th>Chauffeur</Th>
              <Th align="right">Compteur</Th>
              <Th>Documents</Th>
              <Th>État</Th>
            </tr>
          </Thead>
          <Tbody>
            {visible.length === 0 && <EmptyRow colSpan={6}>Aucun véhicule. Ajoutez le premier avec « Nouveau véhicule ».</EmptyRow>}
            {visible.map((v) => {
              const doc = worstDocument(v);
              return (
                <ClickableTr key={v.id} href={`/vehicules/${v.id}`}>
                  <Td>
                    <div className="font-medium">{v.libelle}</div>
                    <div className="text-xs text-foreground-muted">
                      {[v.immatriculation, VEHICLE_TYPE_LABELS[v.type], [v.marque, v.modele].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}
                    </div>
                  </Td>
                  <Td className="text-xs">{v.usage ? VEHICLE_USAGE_LABELS[v.usage] : "—"}</Td>
                  <Td className="text-xs">
                    {v.remplacant ? (
                      <>
                        {v.remplacant.nom} <span className="text-foreground-muted">(remplace {v.titulaire?.nom ?? "—"})</span>
                      </>
                    ) : (
                      (v.titulaire?.nom ?? <span className="text-foreground-muted">Aucun titulaire</span>)
                    )}
                  </Td>
                  <Td align="right" className="text-xs tabular-nums">
                    {formatKm(v.kmActuel)}
                  </Td>
                  <Td>{doc ? <Badge tone={DOCUMENT_STATUT_TONES[doc.statut]}>{doc.statut === "valide" ? "À jour" : `${doc.texte} : ${DOCUMENT_STATUT_LABELS[doc.statut].toLowerCase()}`}</Badge> : "—"}</Td>
                  <Td>
                    {v.blocage ? (
                      <span title={v.blocage}>
                        <Badge tone="danger">Immobilisé</Badge>
                      </span>
                    ) : (
                      <Badge tone={v.actif ? VEHICLE_STATUT_TONES[v.statut] : "neutral"}>{v.actif ? VEHICLE_STATUT_LABELS[v.statut] : "Inactif"}</Badge>
                    )}
                    {v.pannesOuvertes > 0 && !v.blocage && <span className="ml-1 text-xs text-warning">{v.pannesOuvertes} panne(s)</span>}
                  </Td>
                </ClickableTr>
              );
            })}
          </Tbody>
        </Table>
      </Card>
      {hidden > 0 && (
        <Link href={showAll ? "/vehicules?onglet=parc" : "/vehicules?onglet=parc&tous=1"} className="text-xs text-brand hover:underline">
          {showAll ? "Masquer les véhicules vendus ou inactifs" : `Afficher aussi les ${hidden} véhicule(s) vendu(s) ou inactif(s)`}
        </Link>
      )}
    </div>
  );
}

function AlertesTab({ alerts }: { alerts: Awaited<ReturnType<typeof loadAlerts>> }) {
  if (alerts.length === 0) {
    return (
      <Card className="p-6 text-sm text-foreground-muted">
        Aucune alerte : papiers à jour, entretien à jour, pas de panne ouverte ni de bon en attente.
      </Card>
    );
  }
  const groups = [
    { key: "critique", titre: "À traiter maintenant", Icon: CircleAlert, tone: "text-danger" },
    { key: "attention", titre: "À anticiper", Icon: AlertTriangle, tone: "text-warning" },
  ] as const;
  return (
    <div className="space-y-5">
      <p className="text-xs text-foreground-muted">
        Les documents sont signalés dès 30 jours avant l&apos;échéance et deviennent urgents à 7 jours (réglable par type dans Paramètres &gt; Logistique). Un
        document bloquant expiré immobilise le véhicule : ni tournée, ni bon de carburant.
      </p>
      {groups.map((g) => {
        const list = alerts.filter((a) => a.gravite === g.key);
        if (list.length === 0) return null;
        return (
          <section key={g.key} className="space-y-2">
            <h2 className={cn("flex items-center gap-1.5 text-sm font-semibold", g.tone)}>
              <g.Icon className="h-4 w-4" /> {g.titre} ({list.length})
            </h2>
            <Card>
              <ul className="divide-y divide-border">
                {list.map((a, i) => (
                  <li key={`${a.vehicleId}-${a.nature}-${i}`}>
                    <Link href={a.href} className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-surface-muted sm:flex-row sm:items-center sm:gap-4">
                      <span className="w-56 shrink-0 text-sm font-medium">{a.vehicule}</span>
                      <span className="w-60 shrink-0 text-sm">{a.titre}</span>
                      <span className="text-xs text-foreground-muted">{a.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

async function BonsTab({ sub, fleet }: { sub: string; fleet: FleetVehicle[] }) {
  const vouchers = await loadVouchers();
  const current = FUEL_VOUCHER_TABS.find((t) => t.key === sub) ?? FUEL_VOUCHER_TABS[0];
  const visible = vouchers.filter((v) => current.statuts.includes(v.statut));
  const name = (id: string) => {
    const v = fleet.find((x) => x.id === id);
    return v ? vehicleLabel(v) : "—";
  };
  return (
    <div className="space-y-3">
      <nav aria-label="Étapes" className="flex flex-wrap gap-1">
        {FUEL_VOUCHER_TABS.map((t) => {
          const n = vouchers.filter((v) => t.statuts.includes(v.statut)).length;
          return (
            <Link
              key={t.key}
              href={`/vehicules?onglet=bons&statut=${t.key}`}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                t.key === current.key ? "border-brand bg-brand-soft text-brand" : "border-border text-foreground-muted hover:text-foreground"
              )}
            >
              {t.label} ({n})
            </Link>
          );
        })}
      </nav>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>N°</Th>
              <Th>Demandé le</Th>
              <Th>Véhicule</Th>
              <Th>Bénéficiaire</Th>
              <Th align="right">Montant</Th>
              <Th align="right">Litres</Th>
              <Th align="right">L/100 km</Th>
              <Th>Contrôles</Th>
              <Th>Statut</Th>
            </tr>
          </Thead>
          <Tbody>
            {visible.length === 0 && <EmptyRow colSpan={9}>Aucun bon dans cette étape.</EmptyRow>}
            {visible.map((b) => (
              <ClickableTr key={b.id} href={`/vehicules/bons/${b.id}`}>
                <Td className="font-mono text-xs">{b.numero ?? "—"}</Td>
                <Td className="text-xs">{formatDate(b.demande_le)}</Td>
                <Td className="text-xs font-medium">{name(b.vehicle_id)}</Td>
                <Td className="text-xs">{b.beneficiaire ?? "—"}</Td>
                <Td align="right" className="text-xs tabular-nums">
                  {formatAmount(b.montant_reel ?? b.montant_demande)}
                </Td>
                <Td align="right" className="text-xs tabular-nums">
                  {b.litres ?? "—"}
                </Td>
                <Td align="right" className="text-xs tabular-nums">
                  {b.analysis?.consommation ?? "—"}
                </Td>
                <Td className="text-xs">
                  {b.statut !== "justifie" ? (
                    "—"
                  ) : b.analysis && b.analysis.anomalies.length > 0 ? (
                    <span className="text-warning" title={b.analysis.anomalies.map((a) => a.message).join("\n")}>
                      ⚠ {b.analysis.anomalies.length} écart(s)
                    </span>
                  ) : (
                    <span className="text-success">✓</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={FUEL_VOUCHER_STATUT_TONES[b.statut]}>{FUEL_VOUCHER_STATUT_LABELS[b.statut]}</Badge>
                </Td>
              </ClickableTr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}

const PERIODES = [
  { key: "mois", label: "Ce mois", since: () => new Date().toISOString().slice(0, 8) + "01" },
  {
    key: "trimestre",
    label: "3 derniers mois",
    since: () => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 2, 1);
      return d.toISOString().slice(0, 10);
    },
  },
  {
    key: "annee",
    label: "12 derniers mois",
    since: () => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 11, 1);
      return d.toISOString().slice(0, 10);
    },
  },
] as const;

async function CoutsTab({ fleet, periode }: { fleet: FleetVehicle[]; periode: string }) {
  const p = PERIODES.find((x) => x.key === periode) ?? PERIODES[0];
  const since = p.since();
  const [lines, km] = await Promise.all([loadCostLines(since), loadKmSince(since)]);
  const rows = fleet
    .map((v) => {
      const own = lines.filter((l) => l.vehicleId === v.id);
      const sum = (n: string) => own.filter((l) => l.nature === n).reduce((s, l) => s + l.montant, 0);
      const total = own.reduce((s, l) => s + l.montant, 0);
      const parcourus = km.get(v.id) ?? null;
      return { v, carburant: sum("carburant"), entretien: sum("entretien"), documents: sum("documents"), total, parcourus };
    })
    .filter((r) => r.total > 0 || (r.v.actif && r.v.statut !== "vendu"))
    .sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (s, r) => ({ carburant: s.carburant + r.carburant, entretien: s.entretien + r.entretien, documents: s.documents + r.documents, total: s.total + r.total }),
    { carburant: 0, entretien: 0, documents: 0, total: 0 }
  );
  return (
    <div className="space-y-3">
      <nav aria-label="Période" className="flex flex-wrap gap-1">
        {PERIODES.map((x) => (
          <Link
            key={x.key}
            href={`/vehicules?onglet=couts&periode=${x.key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              x.key === p.key ? "border-brand bg-brand-soft text-brand" : "border-border text-foreground-muted hover:text-foreground"
            )}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Véhicule</Th>
              <Th align="right">Carburant</Th>
              <Th align="right">Entretien</Th>
              <Th align="right">Documents</Th>
              <Th align="right">Total</Th>
              <Th align="right">Km parcourus</Th>
              <Th align="right">Coût au km</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && <EmptyRow colSpan={7}>Aucun coût sur la période.</EmptyRow>}
            {rows.map((r) => (
              <ClickableTr key={r.v.id} href={`/vehicules/${r.v.id}?onglet=couts`}>
                <Td className="text-sm font-medium">{vehicleLabel(r.v)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(r.carburant)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(r.entretien)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(r.documents)}</Td>
                <Td align="right" className="text-sm font-medium tabular-nums">{formatAmount(r.total)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatKm(r.parcourus)}</Td>
                <Td align="right" className="text-xs tabular-nums">
                  {r.parcourus ? `${formatAmount(Math.round(r.total / r.parcourus))}` : "—"}
                </Td>
              </ClickableTr>
            ))}
            {rows.length > 0 && (
              <tr className="border-t-2 border-border font-semibold">
                <Td>Total du parc</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(totals.carburant)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(totals.entretien)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(totals.documents)}</Td>
                <Td align="right" className="text-sm tabular-nums">{formatAmount(totals.total)}</Td>
                <Td />
                <Td />
              </tr>
            )}
          </Tbody>
        </Table>
      </Card>
      <p className="text-xs text-foreground-muted">
        Carburant = tickets justifiés ; entretien = coût des interventions ; documents = montant des assurances, vignettes, visites… à leur date de début. Les km
        parcourus viennent des relevés de compteur (pleins, entretien, saisies) ; FreeTrack les rendra automatiques.
      </p>
    </div>
  );
}
