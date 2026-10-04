import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Printer, MapPin } from "lucide-react";
import { requireRole } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { DELIVERY_MANAGER_ROLES, DELIVERY_ROLES } from "@/lib/delivery/access";
import { loadShipment } from "@/lib/delivery/shipment-data";
import { REGLEMENT_LABELS, SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/delivery/status";
import { AccountingForm, PlanningForm, PreparationForm, ShipmentLines, StatusActions } from "./shipment-workbench";
import { ShipmentSageExport } from "./sage-export";
import { LotTraceView, type LotTrace } from "@/components/atelier/lot-trace";

/** Fiche d'une expédition (LIV-1) : préparation, BL, validation comptable, planification, suivi, journal. */
export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireRole([...DELIVERY_ROLES]);
  if (!(await can("livraisons", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const { id } = await params;
  const shipment = await loadShipment(id);
  if (!shipment) notFound();
  const supabase = await createClient();

  const isManager = (DELIVERY_MANAGER_ROLES as readonly string[]).includes(profile.role);
  const canValidate = await can("livraisons", "validate");
  const s = shipment.statut;
  const editableLines = isManager && (s === "a_preparer" || s === "preparee");

  const [{ data: places }, { data: carriers }, { data: vehicles }, { data: livreurs }, remainingRes, mergeRes, hintRes] = await Promise.all([
    supabase.from("delivery_places").select("id,libelle,par_defaut,quartier").eq("company_id", shipment.companyId).eq("actif", true).order("libelle"),
    supabase.from("carriers").select("id,nom").eq("actif", true).order("nom"),
    supabase.from("vehicles").select("id,libelle,immatriculation").eq("actif", true).order("libelle"),
    supabase.from("app_users").select("id,full_name").eq("role", "livreur").eq("active", true).order("full_name"),
    shipment.productionOrderId && editableLines
      ? supabase.rpc("odf_remaining_to_ship", { p_production_order_id: shipment.productionOrderId })
      : Promise.resolve({ data: [] }),
    editableLines
      ? supabase
          .from("shipments")
          .select("id,reference,created_at,production_orders(reference)")
          .eq("company_id", shipment.companyId)
          .in("statut", ["a_preparer", "preparee"])
          .neq("id", id)
      : Promise.resolve({ data: [] }),
    canValidate && s === "preparee" ? supabase.rpc("shipment_amount_hint", { p_shipment_id: id }).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  // Preuves de livraison (LIV-2) : lisibles sous la RLS, servies par URL signée.
  const { data: documents } = await supabase.from("shipment_documents").select("id,type,path,created_at").eq("shipment_id", id).order("created_at");
  const signedDocs =
    (documents ?? []).length > 0
      ? ((await createAdminClient().storage.from("livraisons").createSignedUrls((documents ?? []).map((d) => d.path), 3600)).data ?? [])
      : [];
  const hasDecharge = (documents ?? []).some((d) => d.type === "decharge_bl");

  // Traçabilité des lots mis en colis (SF-5) : BL → lot → coupe → matelas → sections.
  const { data: lotTraces } = shipment.packages.some((p) => p.lotCode)
    ? await supabase.rpc("shipment_lot_trace", { p_shipment_id: id })
    : { data: [] };

  // Sortie PF au BL (LIV-3) : visible de la Direction et de la production, qui génèrent la fiche Sage.
  const canExportStock = profile.role === "administrateur" || profile.role === "responsable_production";
  const [{ data: blMovements }, { data: blFiches }] = canExportStock
    ? await Promise.all([
        supabase.from("stock_movements").select("id,article_ref,taille,quantite_ou_poids,depot,exported_in_fiche_id").eq("shipment_id", id).order("created_at"),
        supabase.from("stock_export_fiches").select("numero,generated_at").eq("shipment_id", id).order("generated_at"),
      ])
    : [{ data: [] }, { data: [] }];

  const remaining = ((remainingRes.data ?? []) as { a_livrer: number }[]).reduce((t, r) => t + Math.max(0, r.a_livrer), 0);
  const hint = hintRes.data as { devis_reference: string; devis_total: number; devise: string; conditions_paiement: string | null; mode_reglement: string | null } | null;

  return (
    <div className="space-y-6">
      <Link href="/livraisons" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Livraisons
      </Link>
      <PageHeader
        title={shipment.reference ?? "Expédition à préparer"}
        description={`${shipment.clientNom}${shipment.mode === "retrait" ? " · enlèvement par le client" : ""}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={["echec", "litige"].includes(s) ? "danger" : ["livree", "enlevee", "reception_confirmee"].includes(s) ? "success" : "brand"}>
              {SHIPMENT_STATUS_LABELS[s as ShipmentStatus]}
            </Badge>
            {shipment.reference && (
              <a
                href={`/api/livraisons/${id}/bl`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-muted"
              >
                <Printer className="h-3.5 w-3.5" /> BL (2 exemplaires)
              </a>
            )}
            {shipment.reference && shipment.packages.length > 0 && (
              <a
                href={`/api/livraisons/${id}/etiquettes`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium hover:bg-surface-muted"
              >
                <Printer className="h-3.5 w-3.5" /> Étiquettes colis
              </a>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardBody className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Lieu</p>
            {shipment.mode === "retrait" ? (
              <p>Enlèvement par le client</p>
            ) : shipment.lieu.libelle ? (
              <>
                <p className="font-medium">{shipment.lieu.libelle}</p>
                <p className="text-xs text-foreground-muted">{[shipment.lieu.zone, shipment.lieu.quartier].filter(Boolean).join(" · ")}</p>
                {shipment.lieu.repere && <p className="text-xs">Repères : {shipment.lieu.repere}</p>}
                {(shipment.lieu.contactNom || shipment.lieu.contactTel) && (
                  <p className="text-xs">Sur place : {[shipment.lieu.contactNom, shipment.lieu.contactTel].filter(Boolean).join(" · ")}</p>
                )}
                {shipment.lieu.latitude != null && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${shipment.lieu.latitude},${shipment.lieu.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    <MapPin className="h-3 w-3" /> Itinéraire
                  </a>
                )}
              </>
            ) : (
              <p className="text-foreground-muted">À choisir à la préparation</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Dates</p>
            <p>Promise : {formatDate(shipment.datePromise)}</p>
            <p>Planifiée : {formatDate(shipment.datePlanifiee)}</p>
            {shipment.livreurNom && <p>Livreur : {shipment.livreurNom}</p>}
            {shipment.livreeAt && <p>Livrée le {formatDateTime(shipment.livreeAt)}{shipment.receptionnaireNom ? ` · ${shipment.receptionnaireNom}` : ""}</p>}
            {shipment.motifEchec && <p className="text-xs text-danger">Échec : {shipment.motifEchec}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-1 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Règlement</p>
            {shipment.reglement.mention ? (
              <>
                <p className="font-medium">
                  {REGLEMENT_LABELS[shipment.reglement.mention]}
                  {shipment.reglement.montant ? ` : ${formatAmount(shipment.reglement.montant)}` : ""}
                </p>
                {shipment.reglement.texte && <p className="text-xs">{shipment.reglement.texte}</p>}
                <p className="text-xs text-foreground-muted">
                  Validé par {shipment.reglement.validePar ?? "—"} le {formatDateTime(shipment.reglement.valideLe)}
                </p>
              </>
            ) : (
              <p className="text-foreground-muted">En attente de la validation comptable</p>
            )}
          </CardBody>
        </Card>
      </div>

      <ShipmentLines
        shipment={shipment}
        editable={editableLines}
        remaining={remaining}
        mergeCandidates={((mergeRes.data ?? []) as unknown as { id: string; reference: string | null; created_at: string; production_orders: { reference: string } | null }[]).map((m) => ({
          id: m.id,
          label: `${m.reference ?? "À préparer"} · ${m.production_orders?.reference ?? ""} · ${formatDate(m.created_at)}`,
        }))}
      />

      {editableLines && (
        <PreparationForm
          shipment={shipment}
          places={(places ?? []).map((p) => ({ id: p.id, label: [p.libelle, p.quartier].filter(Boolean).join(" · "), parDefaut: p.par_defaut }))}
        />
      )}

      {canValidate && s === "preparee" && (
        <AccountingForm
          shipmentId={id}
          hint={
            hint
              ? {
                  devisReference: hint.devis_reference,
                  devisTotal: Number(hint.devis_total),
                  devise: hint.devise,
                  conditions: hint.conditions_paiement,
                  mode: hint.mode_reglement,
                }
              : null
          }
        />
      )}

      {isManager && shipment.mode === "livraison" && ["validee_compta", "planifiee", "echec"].includes(s) && (
        <PlanningForm
          shipment={shipment}
          carriers={(carriers ?? []).map((c) => ({ id: c.id, label: c.nom }))}
          vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: [v.libelle, v.immatriculation].filter(Boolean).join(" · ") }))}
          livreurs={(livreurs ?? []).map((l) => ({ id: l.id, label: l.full_name }))}
        />
      )}

      {isManager && <StatusActions shipment={shipment} hasDecharge={hasDecharge} />}

      {((lotTraces ?? []) as { colis: number; trace: LotTrace }[]).length > 0 && (
        <Card>
          <CardHeader title="Traçabilité des colis" description="Pour chaque colis : son lot, le lot de coupe et le matelas d'origine, les sections traversées." />
          <CardBody className="space-y-5">
            {((lotTraces ?? []) as { colis: number; trace: LotTrace }[]).map((t) => (
              <div key={t.colis}>
                <p className="mb-1 text-xs font-medium text-foreground">Colis n°{t.colis}</p>
                <LotTraceView trace={t.trace} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {canExportStock && (
        <ShipmentSageExport
          shipmentId={id}
          movements={(blMovements ?? []).map((m) => ({
            id: m.id as string,
            article: (m.article_ref as string | null) ?? null,
            taille: (m.taille as string | null) ?? null,
            quantite: Number(m.quantite_ou_poids),
            depot: (m.depot as string | null) ?? null,
            exported: !!m.exported_in_fiche_id,
          }))}
          fiches={(blFiches ?? []).map((f) => ({ numero: f.numero as string, generatedAt: f.generated_at as string }))}
        />
      )}

      {(documents ?? []).length > 0 && (
        <Card>
          <CardHeader title="Preuves de livraison" description="Photo du BL signé (décharge manuscrite du client) et photos déposées." />
          <CardBody className="flex flex-wrap gap-3">
            {(documents ?? []).map((d) => {
              const url = signedDocs.find((x) => x.path === d.path)?.signedUrl;
              return url ? (
                <a key={d.id} href={url} target="_blank" rel="noreferrer" className="block w-32 space-y-1 text-xs">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="h-32 w-32 rounded-md border border-border object-cover" />
                  <span className="text-foreground-muted">{d.type === "decharge_bl" ? "BL signé" : "Photo"} · {formatDateTime(d.created_at)}</span>
                </a>
              ) : null;
            })}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Journal" />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {shipment.events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                <div>
                  <p>
                    {SHIPMENT_STATUS_LABELS[e.statut as ShipmentStatus] ?? e.statut}
                    {e.source !== "app" && <span className="ml-1.5 text-xs text-foreground-muted">({e.source})</span>}
                  </p>
                  {e.commentaire && <p className="text-xs text-foreground-muted">{e.commentaire}</p>}
                </div>
                <p className="shrink-0 text-[11px] text-foreground-muted">
                  {e.auteur ?? "—"} · {formatDateTime(e.occurredAt)}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
