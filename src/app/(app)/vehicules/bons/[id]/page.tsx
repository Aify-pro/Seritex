import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { requireModule, can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { FUEL_VOUCHER_STATUT_LABELS, FUEL_VOUCHER_STATUT_TONES, formatKm, vehicleLabel } from "@/lib/vehicules/labels";
import { loadFleet, loadVouchers, signedUrls } from "@/lib/vehicules/data";
import { VoucherActions } from "@/components/vehicules/voucher-actions";

/**
 * Un bon de carburant : demande → validation par la logistique (numéro) →
 * impression → justification du plein (ticket, litres, kilométrage) et
 * contrôles automatiques.
 */
export default async function FuelVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("bons_carburant");
  const { id } = await params;
  const [b] = await loadVouchers({ id });
  if (!b) notFound();
  const [[vehicle], canValidate, canModify, canSeeVehicle] = await Promise.all([
    loadFleet({ vehicleId: b.vehicle_id }),
    can("bons_carburant", "validate"),
    can("bons_carburant", "modify"),
    can("vehicules", "view"),
  ]);
  const ticket = (await signedUrls([b.ticket_path])).get(b.ticket_path ?? "");
  const plein = b.date_plein ? new Date(b.date_plein) : new Date();

  const rows: [string, React.ReactNode][] = [
    [
      "Véhicule",
      vehicle ? (
        canSeeVehicle ? (
          <Link href={`/vehicules/${vehicle.id}?onglet=carburant`} className="text-brand hover:underline">
            {vehicleLabel(vehicle)}
          </Link>
        ) : (
          vehicleLabel(vehicle)
        )
      ) : (
        "—"
      ),
    ],
    ["Bénéficiaire", b.beneficiaire ?? "—"],
    ["Motif", b.motif ?? "—"],
    ["Station", b.station ?? "Toute station"],
    ["Montant du bon", formatAmount(b.montant_demande)],
    ["Compteur au départ", formatKm(b.km_demande)],
    ["Demandé", `le ${formatDateTime(b.demande_le)}${b.demandeur ? ` par ${b.demandeur}` : ""}`],
  ];
  if (b.valide_le) rows.push([b.statut === "refuse" ? "Refusé" : "Validé", `le ${formatDateTime(b.valide_le)}${b.validateur ? ` par ${b.validateur}` : ""}`]);
  if (b.refus_motif) rows.push(["Motif du refus", b.refus_motif]);
  if (b.annule_motif) rows.push(["Motif de l'annulation", b.annule_motif]);

  return (
    <div className="space-y-6">
      <Link href="/vehicules?onglet=bons" className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Bons de carburant
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {b.numero ? `Bon ${b.numero}` : "Demande de bon de carburant"}
            <Badge tone={FUEL_VOUCHER_STATUT_TONES[b.statut]}>{FUEL_VOUCHER_STATUT_LABELS[b.statut]}</Badge>
          </span>
        }
        description={vehicle ? vehicleLabel(vehicle) : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {b.numero && (
              <a
                href={`/api/vehicules/bons/${b.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-muted"
              >
                <Printer className="h-3.5 w-3.5" /> Imprimer le bon
              </a>
            )}
            <VoucherActions
              id={b.id}
              statut={b.statut}
              canValidate={canValidate}
              canModify={canModify}
              justification={{
                date: plein.toISOString().slice(0, 10),
                heure: plein.toISOString().slice(11, 16),
                montant: b.montant_reel,
                litres: b.litres,
                km: b.km_plein,
                montantDemande: b.montant_demande,
                kmDemande: b.km_demande,
              }}
            />
          </div>
        }
      />

      {b.statut === "demande" && vehicle?.blocage && (
        <p className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Véhicule immobilisé ({vehicle.blocage}) : ce bon ne pourra pas être validé tant que la fiche n&apos;est pas à jour.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Le bon" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-40 shrink-0 text-xs text-foreground-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Le plein"
            description={b.statut === "valide" ? "À saisir au retour, d'après le ticket de la station." : undefined}
          />
          <CardBody>
            {b.statut !== "justifie" ? (
              <p className="text-sm text-foreground-muted">{b.statut === "valide" ? "Pas encore justifié." : "—"}</p>
            ) : (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  {(
                    [
                      ["Date", formatDate(b.date_plein)],
                      ["Montant", formatAmount(b.montant_reel)],
                      ["Litres", `${b.litres} L`],
                      ["Prix au litre", b.analysis ? formatAmount(b.analysis.prixLitre) : "—"],
                      ["Compteur", formatKm(b.km_plein)],
                      ["Depuis le plein précédent", b.analysis?.kmParcourus !== null && b.analysis?.kmParcourus !== undefined ? formatKm(b.analysis.kmParcourus) : "1er plein"],
                      ["Consommation", b.analysis?.consommation ? `${b.analysis.consommation} L/100 km` : "—"],
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs text-foreground-muted">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="mb-1 text-xs font-medium text-foreground-muted">Contrôles automatiques</p>
                  {b.analysis && b.analysis.anomalies.length > 0 ? (
                    <ul className="space-y-1">
                      {b.analysis.anomalies.map((a) => (
                        <li key={a.code} className="text-warning">
                          ⚠ {a.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-success">✓ Compteur, réservoir, prix au litre et consommation cohérents.</p>
                  )}
                  <p className="mt-2 text-[11px] text-foreground-muted">Le rapprochement avec les trajets GPS (FreeTrack) arrivera avec le lot suivant.</p>
                </div>
                {ticket && (
                  <a href={ticket} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">
                    Voir le ticket de la station
                  </a>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
