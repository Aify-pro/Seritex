import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Scissors } from "lucide-react";
import { getSizes, orderedRepartition, type Size } from "@/lib/sizes";
import type { RepartitionTailles } from "@/lib/patronnage/types";
import type { WorkOrderFlowRow } from "@/lib/types/domain";
import { DECLARATION_TYPE_LABELS, allowedDeclarationTypes, type DeclarationType } from "@/lib/production/flow";
import { DeclarationHistory, type DeclarationRow } from "./declaration-history";

const EVENT_TYPE_LABELS: Record<string, string> = {
  demarre: "Démarré",
  pause: "Mis en pause",
  reprise: "Repris",
  termine: "Terminé",
  bloque: "Bloqué",
  debloque: "Débloqué",
  quantite_ajoutee: "Quantité ajoutée",
  matelas_cloture: "Matelas clôturé",
};

/** Répartition lisible, dans l'ordre du référentiel — jamais l'ordre d'insertion du JSON. */
function formatRepartition(rep: RepartitionTailles, sizes: Size[]) {
  return orderedRepartition(rep, sizes)
    .map((t) => `${t.libelle} : ${t.quantite}`)
    .join(" · ");
}

/**
 * Détail d'un sous-ODF, ouvert depuis sa ligne sur la fiche ODF (jusqu'ici
 * un simple libellé sans possibilité de consultation). Pour la section
 * Coupe, reprend la logique matelas par matelas de la section 13 du
 * document de logique (déjà en place côté terminal `/atelier/section`) :
 * liste des tracés en attente vs déjà clôturés, avec le détail de chaque
 * clôture (quantités, poids déchet, résultat). La clôture elle-même reste
 * une action du terminal Coupe — cette page est une vue de consultation.
 */
export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string; workOrderId: string }>;
}) {
  const { profile } = await requireRole(["responsable_production", "administrateur"]);
  const { id, workOrderId } = await params;
  const supabase = await createClient();
  const sizes = await getSizes();

  const { data: wo } = await supabase
    .from("work_orders")
    .select(
      "*,sections(name,atelier_categories(cle)),production_orders(id,reference,company_id,companies(name))"
    )
    .eq("id", workOrderId)
    .eq("production_order_id", id)
    .maybeSingle();

  if (!wo) notFound();

  const { data: events } = await supabase
    .from("work_order_events")
    .select("*,traces_placement(reference,ordre)")
    .eq("work_order_id", workOrderId)
    .order("occurred_at", { ascending: false });

  const userIds = [...new Set((events ?? []).map((e) => e.user_id).filter((v): v is string => !!v))];
  const { data: users } =
    userIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (userId: string | null) => (userId ? (users?.find((u) => u.id === userId)?.full_name ?? "—") : "—");

  const section = wo.sections as unknown as { name: string; atelier_categories: { cle: string } | null } | null;
  const productionOrder = wo.production_orders as unknown as {
    id: string;
    reference: string;
    companies: { name: string } | null;
  } | null;
  // Migration 0036 : catégorie d'atelier (cle='coupe'), plus seulement le nom "Coupe".
  const isCoupe = section?.atelier_categories?.cle === "coupe";

  const closureEvents = (events ?? []).filter((e) => e.event_type === "matelas_cloture");
  const closedTraceIds = new Set(closureEvents.map((e) => e.trace_id as string));
  const otherEvents = (events ?? []).filter((e) => e.event_type !== "matelas_cloture");

  // Même requête que le terminal Coupe (`section-board.tsx`) : les matelas
  // en attente sont les tracés d'une fiche "Bon pour coupe" liée à L'ARTICLE
  // de cet OT (migration 0037, plus à l'ODF entier), pas encore clôturés
  // (correctifs non approuvés exclus).
  let pendingMatelas: {
    id: string;
    reference: string;
    repartitionParCouche: RepartitionTailles;
    estCorrectif: boolean;
  }[] = [];
  if (isCoupe && productionOrder) {
    const { data: fiches } = await supabase
      .from("fiches_placement")
      .select("id,traces_placement(id,ordre,reference,repartition_par_couche,est_correctif,approuve_par)")
      .eq("production_order_line_id", wo.production_order_line_id)
      .eq("statut", "bon_pour_coupe");

    const traces = (fiches ?? []).flatMap(
      (f) =>
        (f.traces_placement ?? []) as unknown as {
          id: string;
          ordre: number;
          reference: string;
          repartition_par_couche: RepartitionTailles;
          est_correctif: boolean;
          approuve_par: string | null;
        }[]
    );
    pendingMatelas = traces
      .filter((t) => (!t.est_correctif || t.approuve_par) && !closedTraceIds.has(t.id))
      .sort((a, b) => a.ordre - b.ordre)
      .map((t) => ({
        id: t.id,
        reference: t.reference,
        repartitionParCouche: t.repartition_par_couche ?? {},
        estCorrectif: t.est_correctif,
      }));
  }

  // SF-1 : reçu / déclaré / reste par taille, et journal des déclarations.
  const categorieCle = section?.atelier_categories?.cle ?? null;
  const [{ data: flowData }, { data: declarationData }] = await Promise.all([
    supabase.rpc("work_order_flow", { p_work_order_id: workOrderId }),
    supabase
      .from("production_declarations")
      .select("id,taille,type,quantite,corrige_declaration_id,motif,created_by,created_at")
      .eq("work_order_id", workOrderId)
      .order("created_at", { ascending: false }),
  ]);
  const flow = (flowData ?? []) as WorkOrderFlowRow[];
  const declarations = declarationData ?? [];
  const declarantIds = [...new Set(declarations.map((d) => d.created_by).filter((v): v is string => !!v))];
  const { data: declarants } =
    declarantIds.length > 0 ? await supabase.from("app_users").select("id,full_name").in("id", declarantIds) : { data: [] };
  const libelleTaille = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle.split("/").pop() ?? cle;
  const declarationRows: DeclarationRow[] = declarations.map((d) => {
    const corrections = declarations.filter((c) => c.corrige_declaration_id === d.id);
    return {
      id: d.id as string,
      taille: d.taille as string,
      tailleLibelle: libelleTaille(d.taille as string),
      type: d.type as DeclarationType,
      quantite: d.quantite as number,
      annulable: (d.quantite as number) + corrections.reduce((s, c) => s + (c.quantite as number), 0),
      corrige: !!d.corrige_declaration_id,
      motif: (d.motif as string | null) ?? null,
      auteur: declarants?.find((u) => u.id === d.created_by)?.full_name ?? "—",
      createdAt: d.created_at as string,
    };
  });
  const declTypes = allowedDeclarationTypes(categorieCle);

  const atteinte = wo.quantity_done >= wo.quantity_planned;

  return (
    <div className="space-y-6">
      <Link
        href={`/atelier/production/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Retour à l&apos;ODF {productionOrder?.reference}
      </Link>

      <PageHeader
        title={wo.reference}
        description={`${section?.name ?? ""} · ${productionOrder?.reference ?? ""}${
          productionOrder?.companies?.name ? ` · ${productionOrder.companies.name}` : ""
        }`}
        action={
          isCoupe ? (
            <Link
              href={`/atelier/section?section=${wo.section_id}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
            >
              <Scissors className="h-3.5 w-3.5" /> Ouvrir le terminal Coupe
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <span>
              {wo.quantity_done}/{wo.quantity_planned} pièces
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className={`h-full rounded-full transition-all ${atteinte ? "bg-success" : "bg-brand"}`}
              style={{ width: `${Math.min(100, (wo.quantity_done / wo.quantity_planned) * 100)}%` }}
            />
          </div>
          {wo.blocking_reason && (
            <p className="rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">⚠ {wo.blocking_reason}</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-xs text-foreground-muted sm:grid-cols-4">
            <p>Début planifié : {wo.planned_start ? formatDateTime(wo.planned_start) : "—"}</p>
            <p>Fin planifiée : {wo.planned_end ? formatDateTime(wo.planned_end) : "—"}</p>
            <p>Démarré le : {wo.actual_start ? formatDateTime(wo.actual_start) : "—"}</p>
            <p>Quantité atteinte le : {wo.actual_end ? formatDateTime(wo.actual_end) : "—"}</p>
          </div>
        </CardBody>
      </Card>

      {flow.length > 0 && (
        <Card>
          <CardHeader
            title="Par taille"
            description="Ce que la section a reçu, ce qu'elle a déclaré et ce qu'il lui reste — la saisie se fait depuis le terminal de section."
          />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-foreground-muted">
                  <th className="px-5 py-2">Taille</th>
                  <th className="px-3 py-2 text-right">Reçu</th>
                  {isCoupe && <th className="px-3 py-2 text-right">Coupées</th>}
                  {declTypes.map((t) => (
                    <th key={t} className="px-3 py-2 text-right">
                      {DECLARATION_TYPE_LABELS[t]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Reste</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {flow.map((r) => {
                  const valeur: Record<DeclarationType, number> = {
                    bonne: r.bonnes,
                    dechet: r.dechets,
                    premier_choix: r.premier_choix,
                    deuxieme_choix: r.deuxieme_choix,
                    surplus: 0,
                    preleve: r.preleve,
                  };
                  return (
                    <tr key={r.taille}>
                      <td className="px-5 py-2 font-medium">{libelleTaille(r.taille)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.recu}</td>
                      {isCoupe && <td className="px-3 py-2 text-right tabular-nums">{r.coupe_produit}</td>}
                      {declTypes.map((t) => (
                        <td key={t} className="px-3 py-2 text-right tabular-nums">
                          {valeur[t]}
                        </td>
                      ))}
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${r.reste > 0 ? "text-brand" : "text-foreground-muted"}`}>
                        {r.reste}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {(declarationRows.length > 0 || flow.length > 0) && (
        <Card>
          <CardHeader title={`Déclarations (${declarationRows.length})`} description="Journal en ajout seul : une erreur se corrige par une contre-déclaration motivée." />
          <CardBody className="p-0">
            <DeclarationHistory
              rows={declarationRows}
              canCorrect={profile.role === "administrateur" || profile.role === "responsable_production"}
            />
          </CardBody>
        </Card>
      )}

      {isCoupe && (
        <Card>
          <CardHeader
            title={`Matelas à clôturer (${pendingMatelas.length})`}
            description="Repris de la fiche Patronnage « Bon pour coupe » liée à cet ODF — clôture depuis le terminal Coupe."
          />
          <CardBody className="p-0">
            {pendingMatelas.length === 0 ? (
              <p className="px-5 py-4 text-sm text-foreground-muted">Aucun matelas en attente.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pendingMatelas.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <Circle className="h-3.5 w-3.5 text-foreground-muted" /> {m.reference}
                      {m.estCorrectif && <span className="text-xs text-warning">(rattrapage)</span>}
                    </span>
                    <span className="text-xs text-foreground-muted">{formatRepartition(m.repartitionParCouche, sizes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {isCoupe && (
        <Card>
          <CardHeader title={`Matelas clôturés (${closureEvents.length})`} />
          <CardBody className="p-0">
            {closureEvents.length === 0 ? (
              <p className="px-5 py-4 text-sm text-foreground-muted">Aucun matelas clôturé pour le moment.</p>
            ) : (
              <ul className="divide-y divide-border">
                {closureEvents.map((e) => {
                  const trace = e.traces_placement as unknown as { reference: string } | null;
                  const quantites = (e.quantites_obtenues ?? {}) as RepartitionTailles;
                  return (
                    <li key={e.id} className="space-y-1.5 px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {trace?.reference ?? "—"}
                        </span>
                        <Badge tone={e.resultat === "probleme" ? "warning" : "success"}>
                          {e.resultat === "probleme" ? "Écart justifié" : "OK"}
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground-muted">
                        {formatRepartition(quantites, sizes)} · déchets {e.poids_dechet_kg ?? 0} kg
                      </p>
                      {e.comment && <p className="text-xs text-warning">Justification : {e.comment}</p>}
                      <p className="text-[11px] text-foreground-muted">
                        {nameOf(e.user_id)} · {formatDateTime(e.occurred_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Historique" />
        <CardBody className="p-0">
          {otherEvents.length === 0 ? (
            <p className="px-5 py-4 text-sm text-foreground-muted">Aucun événement pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {otherEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="text-foreground">
                      {EVENT_TYPE_LABELS[e.event_type] ?? e.event_type}
                      {e.quantity ? ` · +${e.quantity} pièce(s)` : ""}
                    </p>
                    {e.comment && <p className="text-xs text-foreground-muted">{e.comment}</p>}
                  </div>
                  <p className="text-[11px] shrink-0 text-foreground-muted">
                    {nameOf(e.user_id)} · {formatDateTime(e.occurred_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
