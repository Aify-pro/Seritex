import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, FileText } from "lucide-react";
import { requireModule, can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Th, Td, EmptyRow, Tr } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { cn, formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { VEHICLE_TYPE_LABELS } from "@/lib/types/domain";
import {
  DOCUMENT_STATUT_LABELS,
  DOCUMENT_STATUT_TONES,
  FUEL_VOUCHER_STATUT_LABELS,
  FUEL_VOUCHER_STATUT_TONES,
  VEHICLE_ENERGIE_LABELS,
  VEHICLE_STATUT_LABELS,
  VEHICLE_STATUT_TONES,
  VEHICLE_USAGE_LABELS,
  formatJours,
  formatKm,
  vehicleLabel,
} from "@/lib/vehicules/labels";
import { averageConsumption, formatMois, monthlyCosts } from "@/lib/vehicules/calculs";
import { loadAnnuaire, loadCostLines, loadFleet, loadMaintenanceDue, loadServiceTypes, loadVouchers, signedUrls } from "@/lib/vehicules/data";
import { EditVehicleButton, NewFuelVoucherButton } from "@/components/vehicules/vehicle-dialogs";
import {
  DeleteDocumentButton,
  DocumentDialog,
  EndRemplacementButton,
  ExemptionButton,
  IssueForm,
  OdometerForm,
  PhotoUpload,
  RemplacementForm,
  ResolveIssueButton,
  ServiceForm,
  StatusControls,
  TitulaireForm,
} from "@/components/vehicules/fiche-panels";

type Params = Record<string, string | string[] | undefined>;

const TABS = [
  { key: "general", label: "Général" },
  { key: "documents", label: "Documents" },
  { key: "carburant", label: "Carburant" },
  { key: "entretien", label: "Entretien et pannes" },
  { key: "chauffeur", label: "Chauffeur" },
  { key: "couts", label: "Coûts" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const SOURCE_LABELS: Record<string, string> = {
  saisie: "Saisie",
  carburant: "Plein",
  entretien: "Entretien",
  tournee: "Tournée",
  freetrack: "FreeTrack",
  sinistre: "Sinistre",
};

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  await requireModule("vehicules");
  const { id } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.onglet) ? sp.onglet[0] : sp.onglet;
  const tab = (TABS.find((t) => t.key === raw)?.key ?? "general") as TabKey;

  const [v] = await loadFleet({ vehicleId: id });
  if (!v) notFound();
  const [canModify, canDelete, canCreateVoucher, canViewVouchers] = await Promise.all([
    can("vehicules", "modify"),
    can("vehicules", "delete"),
    can("bons_carburant", "create"),
    can("bons_carburant", "view"),
  ]);
  const supabase = await createClient();
  const annuaire = await loadAnnuaire();
  const employes = [...annuaire.values()].filter((e) => e.statut === "actif").map((e) => ({ id: e.id, nom: e.nom, matricule: e.matricule }));
  const photo = (await signedUrls([v.photo_path])).get(v.photo_path ?? "");

  return (
    <div className="space-y-6">
      <Link href="/vehicules" className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Tous les véhicules
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {v.libelle}
            {v.immatriculation && <span className="font-mono text-base text-foreground-muted">{v.immatriculation}</span>}
            {v.blocage ? (
              <Badge tone="danger">Immobilisé</Badge>
            ) : (
              <Badge tone={v.actif ? VEHICLE_STATUT_TONES[v.statut] : "neutral"}>{v.actif ? VEHICLE_STATUT_LABELS[v.statut] : "Inactif"}</Badge>
            )}
          </span>
        }
        description={[VEHICLE_TYPE_LABELS[v.type], [v.marque, v.modele, v.annee].filter(Boolean).join(" "), v.usage ? `Usage : ${VEHICLE_USAGE_LABELS[v.usage].toLowerCase()}` : null]
          .filter(Boolean)
          .join(" · ")}
        action={
          canModify ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusControls id={v.id} statut={v.statut} actif={v.actif} />
              <EditVehicleButton id={v.id} defaults={v} />
            </div>
          ) : undefined
        }
      />

      {v.blocage && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Véhicule immobilisé : ni tournée, ni bon de carburant.</p>
            <p className="text-xs">
              {v.blocage.charAt(0).toUpperCase() + v.blocage.slice(1)}. Mettez le document à jour ou levez l&apos;immobilisation pour le remettre en circulation.
            </p>
          </div>
        </div>
      )}

      <nav aria-label="Rubriques du véhicule" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {TABS.filter((t) => t.key !== "carburant" || canViewVouchers).map((t) => (
          <Link
            key={t.key}
            href={`/vehicules/${v.id}?onglet=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label}
            {t.key === "documents" && v.compliance.some((c) => ["expire", "urgent"].includes(c.statut)) && <span className="ml-1 text-danger">●</span>}
            {t.key === "entretien" && v.pannesOuvertes > 0 && <span className="ml-1 text-warning">●</span>}
          </Link>
        ))}
      </nav>

      {tab === "general" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Identité" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                {(
                  [
                    ["Type", VEHICLE_TYPE_LABELS[v.type]],
                    ["Marque et modèle", [v.marque, v.modele].filter(Boolean).join(" ") || "—"],
                    ["Année", v.annee ?? "—"],
                    ["Couleur", v.couleur ?? "—"],
                    ["Carburant", v.energie ? VEHICLE_ENERGIE_LABELS[v.energie] : "—"],
                    ["Réservoir", v.reservoir_litres ? `${v.reservoir_litres} L` : "—"],
                    ["Carte grise", v.carte_grise_numero ?? "—"],
                    ["1re mise en circulation", formatDate(v.date_mise_circulation)],
                    ["N° de châssis", v.numero_chassis ?? "—"],
                    ["Capacité", v.capacite_note ?? "—"],
                    ["Traceur FreeTrack", v.freetrack_device_id ? `n° ${v.freetrack_device_id}` : "Non relié (lot suivant)"],
                    ["Chauffeur", v.remplacant ? `${v.remplacant.nom} (remplaçant)` : (v.titulaire?.nom ?? "—")],
                  ] as [string, React.ReactNode][]
                ).map(([k, val]) => (
                  <div key={k}>
                    <dt className="text-xs text-foreground-muted">{k}</dt>
                    <dd className="font-medium">{val}</dd>
                  </div>
                ))}
              </dl>
              {v.notes && <p className="mt-4 whitespace-pre-line text-sm text-foreground-muted">{v.notes}</p>}
            </CardBody>
          </Card>
          <div className="space-y-6">
            <Card>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={v.libelle} className="h-48 w-full rounded-t-lg object-cover" />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-t-lg bg-surface-muted text-xs text-foreground-muted">Pas de photo</div>
              )}
              {canModify && (
                <div className="px-3 py-2">
                  <PhotoUpload id={v.id} hasPhoto={!!photo} />
                </div>
              )}
            </Card>
            <GeneralCompteur id={v.id} kmActuel={v.kmActuel} canModify={canModify} />
          </div>
        </div>
      )}

      {tab === "documents" && <DocumentsTab vehicleId={v.id} compliance={v.compliance} canModify={canModify} canDelete={canDelete} />}

      {tab === "carburant" && (
        <CarburantTab
          vehicle={v}
          voucherButton={
            canCreateVoucher ? (
              <NewFuelVoucherButton
                vehicles={[{ id: v.id, label: vehicleLabel(v), blocage: v.blocage, titulaireId: v.titulaire?.id ?? null, kmActuel: v.kmActuel }]}
                employes={employes}
                stations={((await supabase.from("fuel_stations").select("id,nom").eq("actif", true).order("nom")).data ?? []) as { id: string; nom: string }[]}
                defaultVehicleId={v.id}
              />
            ) : null
          }
        />
      )}

      {tab === "entretien" && <EntretienTab vehicle={v} employes={employes} canModify={canModify} />}

      {tab === "chauffeur" && <ChauffeurTab vehicleId={v.id} titulaireId={v.titulaire?.id ?? null} employes={employes} canModify={canModify} />}

      {tab === "couts" && <CoutsTab vehicleId={v.id} />}
    </div>
  );
}

async function GeneralCompteur({ id, kmActuel, canModify }: { id: string; kmActuel: number | null; canModify: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle_odometer_readings")
    .select("id,km,releve_le,source")
    .eq("vehicle_id", id)
    .order("releve_le", { ascending: false })
    .limit(6);
  return (
    <Card>
      <CardHeader title="Compteur" description={kmActuel !== null ? `Dernier relevé : ${formatKm(kmActuel)}` : "Aucun relevé."} action={canModify ? <OdometerForm id={id} /> : undefined} />
      <ul className="divide-y divide-border text-xs">
        {((data ?? []) as { id: string; km: number; releve_le: string; source: string }[]).map((r) => (
          <li key={r.id} className="flex justify-between px-5 py-2">
            <span>{formatDate(r.releve_le)}</span>
            <span className="text-foreground-muted">{SOURCE_LABELS[r.source] ?? r.source}</span>
            <span className="tabular-nums">{formatKm(r.km)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function DocumentsTab({
  vehicleId,
  compliance,
  canModify,
  canDelete,
}: {
  vehicleId: string;
  compliance: Awaited<ReturnType<typeof loadFleet>>[number]["compliance"];
  canModify: boolean;
  canDelete: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicle_documents")
    .select("id,type_id,numero,organisme,date_debut,date_fin,montant,fichier_path,notes,created_at")
    .eq("vehicle_id", vehicleId)
    .order("date_fin", { ascending: false });
  const docs = (data ?? []) as {
    id: string;
    type_id: string;
    numero: string | null;
    organisme: string | null;
    date_debut: string | null;
    date_fin: string;
    montant: number | null;
    fichier_path: string | null;
    notes: string | null;
  }[];
  const urls = await signedUrls(docs.map((d) => d.fichier_path));
  const types = compliance.map((c) => ({ id: c.type_id, libelle: c.libelle }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-foreground-muted">
          Signalement dès le préavis (orange), urgent à l&apos;approche (rouge). Un document <strong>bloquant</strong> expiré immobilise le véhicule.
          Réglages par type dans Paramètres &gt; Logistique.
        </p>
        {canModify && <DocumentDialog vehicleId={vehicleId} types={types} label="Ajouter un document" variant="primary" />}
      </div>
      <Card>
        <ul className="divide-y divide-border">
          {compliance.map((c) => {
            const history = docs.filter((d) => d.type_id === c.type_id);
            const current = history.find((d) => d.id === c.document_id);
            return (
              <li key={c.type_id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-48 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {c.libelle}
                      {c.bloquant ? (
                        <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">Bloquant</span>
                      ) : (
                        <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-foreground-muted">Non bloquant</span>
                      )}
                    </p>
                    {current && (
                      <p className="text-xs text-foreground-muted">
                        {[current.numero && `N° ${current.numero}`, current.organisme, current.date_debut && `du ${formatDate(current.date_debut)}`, `au ${formatDate(current.date_fin)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <Badge tone={DOCUMENT_STATUT_TONES[c.statut]}>
                    {DOCUMENT_STATUT_LABELS[c.statut]}
                    {c.jours_restants !== null && c.statut !== "valide" ? ` ${formatJours(c.jours_restants)}` : ""}
                  </Badge>
                  {current?.fichier_path && urls.get(current.fichier_path) && (
                    <a href={urls.get(current.fichier_path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                      <FileText className="h-3.5 w-3.5" /> Voir le document
                    </a>
                  )}
                  {canModify && (
                    <span className="flex flex-wrap gap-1">
                      {c.statut !== "non_concerne" && (
                        <DocumentDialog vehicleId={vehicleId} types={types} typeId={c.type_id} label={current ? "Renouveler" : "Saisir"} variant="secondary" />
                      )}
                      {(!current || c.statut === "non_concerne") && <ExemptionButton vehicleId={vehicleId} typeId={c.type_id} exempt={c.statut === "non_concerne"} />}
                    </span>
                  )}
                </div>
                {history.length > 1 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-foreground-muted hover:text-foreground">Historique ({history.length - 1})</summary>
                    <ul className="mt-1 space-y-1 pl-3 text-xs text-foreground-muted">
                      {history
                        .filter((d) => d.id !== current?.id)
                        .map((d) => (
                          <li key={d.id} className="flex flex-wrap items-center gap-2">
                            <span>
                              {[d.numero && `N° ${d.numero}`, d.organisme, `expiré le ${formatDate(d.date_fin)}`, d.montant ? formatAmount(Number(d.montant)) : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {d.fichier_path && urls.get(d.fichier_path) && (
                              <a href={urls.get(d.fichier_path)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                                document
                              </a>
                            )}
                            {canDelete && <DeleteDocumentButton vehicleId={vehicleId} documentId={d.id} />}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                {current && canDelete && history.length === 1 && (
                  <div className="mt-1">
                    <DeleteDocumentButton vehicleId={vehicleId} documentId={current.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

async function CarburantTab({ vehicle, voucherButton }: { vehicle: Awaited<ReturnType<typeof loadFleet>>[number]; voucherButton: React.ReactNode }) {
  const vouchers = await loadVouchers({ vehicleId: vehicle.id });
  const justified = vouchers.filter((b) => b.statut === "justifie");
  const fills = justified.map((b) => ({ id: b.id, datePlein: b.date_plein!, litres: b.litres!, montant: b.montant_reel!, km: b.km_plein! }));
  const moyenne = averageConsumption(
    justified.map((b) => b.analysis).filter((a): a is NonNullable<typeof a> => !!a),
    fills
  );
  const anomalies = justified.reduce((s, b) => s + (b.analysis?.anomalies.length ?? 0), 0);
  const last = justified.sort((a, b) => (b.date_plein ?? "").localeCompare(a.date_plein ?? ""))[0];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Consommation moyenne" value={moyenne !== null ? `${moyenne} L/100 km` : "—"} hint="Plein à plein, sur les bons justifiés" />
        <StatCard label="Dernier plein" value={last ? formatDate(last.date_plein) : "—"} hint={last ? `${last.litres} L · ${formatKm(last.km_plein)}` : undefined} />
        <StatCard label="Écarts relevés" value={anomalies} tone={anomalies ? "warning" : "neutral"} hint="Compteur, réservoir, prix au litre, consommation" />
      </div>
      <div className="flex justify-end">{voucherButton}</div>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>N°</Th>
              <Th>Plein</Th>
              <Th align="right">Montant</Th>
              <Th align="right">Litres</Th>
              <Th align="right">Compteur</Th>
              <Th align="right">Km parcourus</Th>
              <Th align="right">L/100 km</Th>
              <Th>Contrôles</Th>
              <Th>Statut</Th>
            </tr>
          </Thead>
          <Tbody>
            {vouchers.length === 0 && <EmptyRow colSpan={9}>Aucun bon de carburant pour ce véhicule.</EmptyRow>}
            {vouchers.map((b) => (
              <ClickableTr key={b.id} href={`/vehicules/bons/${b.id}`}>
                <Td className="font-mono text-xs">{b.numero ?? "—"}</Td>
                <Td className="text-xs">{b.date_plein ? formatDateTime(b.date_plein) : `demandé le ${formatDate(b.demande_le)}`}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(b.montant_reel ?? b.montant_demande)}</Td>
                <Td align="right" className="text-xs tabular-nums">{b.litres ?? "—"}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatKm(b.km_plein)}</Td>
                <Td align="right" className="text-xs tabular-nums">{b.analysis?.kmParcourus ?? "—"}</Td>
                <Td align="right" className="text-xs tabular-nums">{b.analysis?.consommation ?? "—"}</Td>
                <Td className="max-w-64 text-xs">
                  {b.statut !== "justifie"
                    ? "—"
                    : b.analysis && b.analysis.anomalies.length > 0
                      ? b.analysis.anomalies.map((a) => (
                          <p key={a.code} className="text-warning">
                            ⚠ {a.message}
                          </p>
                        ))
                      : <span className="text-success">✓ Conforme</span>}
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

async function EntretienTab({
  vehicle,
  employes,
  canModify,
}: {
  vehicle: Awaited<ReturnType<typeof loadFleet>>[number];
  employes: { id: string; nom: string; matricule: string }[];
  canModify: boolean;
}) {
  const supabase = await createClient();
  const [due, types, { data: issues }, { data: services }] = await Promise.all([
    loadMaintenanceDue([vehicle]),
    loadServiceTypes(),
    supabase.from("vehicle_issues").select("id,description,gravite,statut,signale_le,resolue_le,resolution,photo_path,conducteur_id").eq("vehicle_id", vehicle.id).order("signale_le", { ascending: false }),
    supabase.from("vehicle_services").select("id,type_id,date_intervention,km,garage,cout,description,facture_path").eq("vehicle_id", vehicle.id).order("date_intervention", { ascending: false }),
  ]);
  const issueRows = (issues ?? []) as { id: string; description: string; gravite: string; statut: string; signale_le: string; resolue_le: string | null; resolution: string | null; photo_path: string | null }[];
  const serviceRows = (services ?? []) as { id: string; type_id: string; date_intervention: string; km: number | null; garage: string | null; cout: number | null; description: string | null; facture_path: string | null }[];
  const urls = await signedUrls([...issueRows.map((i) => i.photo_path), ...serviceRows.map((s) => s.facture_path)]);
  const open = issueRows.filter((i) => i.statut === "ouverte");
  const activeTypes = types.filter((t) => t.actif).map((t) => ({ id: t.id, libelle: t.libelle }));
  const dueList = due.get(vehicle.id) ?? [];
  const typeName = (id: string) => types.find((t) => t.id === id)?.libelle ?? "—";

  return (
    <div className="space-y-6">
      {canModify && (
        <div className="flex flex-wrap justify-end gap-2">
          <IssueForm vehicleId={vehicle.id} employes={employes} defaultConducteur={vehicle.remplacant?.id ?? vehicle.titulaire?.id} />
          <ServiceForm vehicleId={vehicle.id} types={activeTypes} openIssues={open} />
        </div>
      )}

      {open.length > 0 && (
        <Card>
          <CardHeader title={`Pannes ouvertes (${open.length})`} />
          <ul className="divide-y divide-border">
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={i.gravite === "immobilisante" ? "danger" : "warning"}>{i.gravite === "immobilisante" ? "Immobilisante" : "Mineure"}</Badge>
                <span className="flex-1">{i.description}</span>
                <span className="text-xs text-foreground-muted">signalée le {formatDate(i.signale_le)}</span>
                {i.photo_path && urls.get(i.photo_path) && (
                  <a href={urls.get(i.photo_path)} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                    photo
                  </a>
                )}
                {canModify && (
                  <span className="flex gap-1">
                    <ServiceForm vehicleId={vehicle.id} types={activeTypes} openIssues={open} issueId={i.id} label="Réparer" />
                    <ResolveIssueButton vehicleId={vehicle.id} issueId={i.id} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Prochains entretiens"
          description="Dus au premier atteint : la date ou le kilométrage. Un entretien jamais enregistré n'a pas encore de point de départ."
        />
        <Table>
          <Thead>
            <tr>
              <Th>Entretien</Th>
              <Th>Dernier</Th>
              <Th>Prochain</Th>
              <Th>État</Th>
            </tr>
          </Thead>
          <Tbody>
            {dueList.length === 0 && <EmptyRow colSpan={4}>Aucun entretien périodique enregistré pour l&apos;instant.</EmptyRow>}
            {dueList.map((m) => (
              <Tr key={m.typeId}>
                <Td className="text-sm font-medium">{m.libelle}</Td>
                <Td className="text-xs">
                  {formatDate(m.derniereDate)}
                  {m.dernierKm !== null ? ` · ${formatKm(m.dernierKm)}` : ""}
                </Td>
                <Td className="text-xs">
                  {[m.echeanceDate ? formatDate(m.echeanceDate) : null, m.echeanceKm !== null ? formatKm(m.echeanceKm) : null].filter(Boolean).join(" ou ")}
                  {m.kmRestants !== null && m.kmRestants > 0 ? <span className="text-foreground-muted"> (encore {formatKm(m.kmRestants)})</span> : null}
                </Td>
                <Td>
                  <Badge tone={m.statut === "en_retard" ? "danger" : m.statut === "bientot" ? "warning" : "success"}>
                    {m.statut === "en_retard" ? "En retard" : m.statut === "bientot" ? "À prévoir" : "À jour"}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Historique des interventions" />
        <Table>
          <Thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Travaux</Th>
              <Th>Garage</Th>
              <Th align="right">Compteur</Th>
              <Th align="right">Coût</Th>
              <Th>Facture</Th>
            </tr>
          </Thead>
          <Tbody>
            {serviceRows.length === 0 && <EmptyRow colSpan={7}>Aucune intervention enregistrée.</EmptyRow>}
            {serviceRows.map((s) => (
              <Tr key={s.id}>
                <Td className="text-xs">{formatDate(s.date_intervention)}</Td>
                <Td className="text-sm">{typeName(s.type_id)}</Td>
                <Td className="max-w-72 text-xs">{s.description ?? "—"}</Td>
                <Td className="text-xs">{s.garage ?? "—"}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatKm(s.km)}</Td>
                <Td align="right" className="text-xs tabular-nums">{s.cout !== null ? formatAmount(Number(s.cout)) : "—"}</Td>
                <Td className="text-xs">
                  {s.facture_path && urls.get(s.facture_path) ? (
                    <a href={urls.get(s.facture_path)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      voir
                    </a>
                  ) : (
                    "—"
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      {issueRows.some((i) => i.statut === "resolue") && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-foreground-muted hover:text-foreground">Pannes closes ({issueRows.filter((i) => i.statut === "resolue").length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-foreground-muted">
            {issueRows
              .filter((i) => i.statut === "resolue")
              .map((i) => (
                <li key={i.id}>
                  {formatDate(i.signale_le)} : {i.description} → {i.resolution ?? "réglée"} ({formatDate(i.resolue_le)})
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

async function ChauffeurTab({
  vehicleId,
  titulaireId,
  employes,
  canModify,
}: {
  vehicleId: string;
  titulaireId: string | null;
  employes: { id: string; nom: string; matricule: string }[];
  canModify: boolean;
}) {
  const supabase = await createClient();
  const [{ data }, annuaire] = await Promise.all([
    supabase.from("vehicle_assignments").select("id,employe_id,type,debut,fin,motif").eq("vehicle_id", vehicleId).order("debut", { ascending: false }),
    loadAnnuaire(),
  ]);
  const rows = (data ?? []) as { id: string; employe_id: string; type: string; debut: string; fin: string | null; motif: string | null }[];
  const today = new Date().toISOString().slice(0, 10);
  const titulaire = titulaireId ? annuaire.get(titulaireId) : null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Chauffeur titulaire"
          description="Chaque véhicule a son chauffeur. Pour une absence ou une panne, enregistrez un remplacement daté : l'historique dira qui conduisait à une date donnée."
          action={
            canModify ? (
              <div className="flex gap-2">
                <RemplacementForm vehicleId={vehicleId} employes={employes} />
                <TitulaireForm vehicleId={vehicleId} employes={employes} currentId={titulaireId} />
              </div>
            ) : undefined
          }
        />
        <CardBody>
          {titulaire ? (
            <p className="text-sm">
              <span className="font-medium">{titulaire.nom}</span>{" "}
              <span className="text-foreground-muted">
                · {titulaire.matricule}
                {titulaire.fonction ? ` · ${titulaire.fonction}` : ""}
              </span>
            </p>
          ) : (
            <p className="text-sm text-foreground-muted">Aucun titulaire désigné.</p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Historique" />
        <Table>
          <Thead>
            <tr>
              <Th>Chauffeur</Th>
              <Th>Rôle</Th>
              <Th>Période</Th>
              <Th>Motif</Th>
              <Th> </Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && <EmptyRow colSpan={5}>Aucune affectation.</EmptyRow>}
            {rows.map((r) => {
              const enCours = r.debut <= today && (!r.fin || r.fin >= today);
              return (
                <Tr key={r.id}>
                  <Td className="text-sm font-medium">{annuaire.get(r.employe_id)?.nom ?? "—"}</Td>
                  <Td>
                    <Badge tone={r.type === "titulaire" ? "brand" : "accent"}>{r.type === "titulaire" ? "Titulaire" : "Remplaçant"}</Badge>
                    {enCours && <span className="ml-1 text-xs text-success">en cours</span>}
                  </Td>
                  <Td className="text-xs">
                    du {formatDate(r.debut)} {r.fin ? `au ${formatDate(r.fin)}` : "à aujourd'hui"}
                  </Td>
                  <Td className="text-xs">{r.motif ?? "—"}</Td>
                  <Td>{canModify && r.type === "remplacement" && (!r.fin || r.fin > today) && <EndRemplacementButton vehicleId={vehicleId} assignmentId={r.id} />}</Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}

async function CoutsTab({ vehicleId }: { vehicleId: string }) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 11, 1);
  const since = d.toISOString().slice(0, 10);
  const months = monthlyCosts(await loadCostLines(since, vehicleId));
  const total = months.reduce((s, m) => s + m.total, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Coût sur 12 mois" value={formatAmount(total)} />
        <StatCard label="Moyenne mensuelle" value={formatAmount(Math.round(total / 12))} />
        <StatCard label="Mois le plus cher" value={months.length ? formatAmount(Math.max(...months.map((m) => m.total))) : "—"} />
      </div>
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Mois</Th>
              <Th align="right">Carburant</Th>
              <Th align="right">Entretien</Th>
              <Th align="right">Documents</Th>
              <Th align="right">Total</Th>
            </tr>
          </Thead>
          <Tbody>
            {months.length === 0 && <EmptyRow colSpan={5}>Aucun coût sur les 12 derniers mois.</EmptyRow>}
            {months.map((m) => (
              <Tr key={m.mois}>
                <Td className="text-sm capitalize">{formatMois(m.mois)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(m.carburant)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(m.entretien)}</Td>
                <Td align="right" className="text-xs tabular-nums">{formatAmount(m.documents)}</Td>
                <Td align="right" className="text-sm font-medium tabular-nums">{formatAmount(m.total)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}
