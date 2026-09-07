import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { StatCard, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REQUEST_STATUS_LABELS, PRODUCTION_ORDER_STATUS_LABELS } from "@/lib/types/domain";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/shell/page-header";

export default async function DashboardPage() {
  const { profile } = await requireUser();
  const supabase = await createClient();

  if (profile.role === "client") {
    const [{ data: requests }, { data: quotes }, { data: samples }, { data: production }] =
      await Promise.all([
        supabase.from("requests").select("id,status").eq("company_id", profile.company_id!),
        supabase
          .from("quotes")
          .select("id,status")
          .eq("company_id", profile.company_id!)
          .in("status", ["envoye"]),
        supabase
          .from("sample_requests")
          .select("id,status")
          .eq("company_id", profile.company_id!)
          .not("status", "in", "(valide,refuse,sans_suite)"),
        supabase
          .from("client_production_status")
          .select("*")
          .eq("company_id", profile.company_id!)
          .order("planned_start_date", { ascending: false })
          .limit(5),
      ]);

    return (
      <div className="space-y-6">
        <PageHeader
          title={`Bonjour ${profile.full_name.split(" ")[0]}`}
          description="Voici l'état de vos demandes, devis et commandes en cours."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Demandes en cours" value={requests?.length ?? 0} tone="brand" />
          <StatCard label="Devis à valider" value={quotes?.length ?? 0} tone="accent" />
          <StatCard label="Échantillons en cours" value={samples?.length ?? 0} tone="warning" />
        </div>

        <Card>
          <CardHeader
            title="Commandes en production"
            description="Suivi en lecture seule de l'avancement dans l'atelier"
            action={
              <Link href="/client/production" className="text-xs font-medium text-brand hover:underline">
                Voir tout
              </Link>
            }
          />
          <CardBody className="p-0">
            {!production || production.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground-muted">
                Aucune commande en production pour le moment.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {production.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.reference}</p>
                      <p className="text-xs text-foreground-muted">
                        {p.total_quantity} pièces
                        {p.section_en_cours ? ` · actuellement en ${p.section_en_cours}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={p.status} labels={PRODUCTION_ORDER_STATUS_LABELS} kind="production" />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  if (profile.role === "commercial" || profile.role === "administrateur") {
    const [{ data: requests }, { data: quotesEnvoyes }, { data: samples }] = await Promise.all([
      supabase.from("requests").select("id,status,reference,created_at,companies(id,name)").order(
        "created_at",
        { ascending: false }
      ).limit(6),
      supabase.from("quotes").select("id,status").eq("status", "envoye"),
      supabase.from("sample_requests").select("id,status").not("status", "in", "(valide,refuse,sans_suite)"),
    ]);

    const nouvelles = requests?.filter((r) => r.status === "nouvelle").length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader
          title="Tableau de bord commercial"
          description="Pipeline des demandes, devis et échantillons en cours."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Nouvelles demandes" value={nouvelles} tone="info" />
          <StatCard label="Devis en attente client" value={quotesEnvoyes?.length ?? 0} tone="brand" />
          <StatCard label="Échantillons actifs" value={samples?.length ?? 0} tone="accent" />
        </div>

        <Card>
          <CardHeader
            title="Dernières demandes"
            action={
              <Link href="/commercial/demandes" className="text-xs font-medium text-brand hover:underline">
                Voir tout
              </Link>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {requests?.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <Link href={`/commercial/demandes/${r.id}`} className="text-sm font-medium text-foreground hover:text-brand">
                      {r.reference}
                    </Link>
                    <p className="text-xs text-foreground-muted">
                      {(r.companies as unknown as { name: string } | null)?.name} · {formatDate(r.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (profile.role === "responsable_production") {
    const [{ data: orders }, { data: enAttente }, { data: cloturesDemandees }] = await Promise.all([
      supabase.from("production_orders").select("id,status"),
      supabase.from("production_orders").select("id,status").eq("status", "en_attente_validation"),
      supabase
        .from("production_orders")
        .select("id,reference,cloture_demandee_at,companies(name)")
        .eq("status", "demande_cloture")
        .order("cloture_demandee_at", { ascending: true }),
    ]);

    const enProduction = orders?.filter((o) => o.status === "en_production").length ?? 0;
    const brouillons = orders?.filter((o) => o.status === "brouillon").length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader title="Pilotage atelier" description="Vue d'ensemble des ordres de fabrication." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label="En production" value={enProduction} tone="brand" />
          <StatCard label="Brouillons" value={brouillons} tone="neutral" />
          <StatCard label="En attente de validation" value={enAttente?.length ?? 0} tone="info" />
          <StatCard
            label="Demandes de clôture"
            value={cloturesDemandees?.length ?? 0}
            tone={cloturesDemandees && cloturesDemandees.length > 0 ? "warning" : "neutral"}
          />
        </div>

        {cloturesDemandees && cloturesDemandees.length > 0 && (
          <Card>
            <CardHeader title="Demandes de clôture — action requise" />
            <CardBody className="p-0">
              <ul className="divide-y divide-border">
                {cloturesDemandees.map((o) => (
                  <li key={o.id} className="flex items-center justify-between px-5 py-3">
                    <Link
                      href={`/atelier/production/${o.id}`}
                      className="text-sm font-medium text-foreground hover:text-brand"
                    >
                      {o.reference}
                    </Link>
                    <span className="text-xs text-foreground-muted">
                      {(o.companies as unknown as { name: string } | null)?.name}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <div className="flex gap-3">
          <Link href="/atelier/production" className="text-sm font-medium text-brand hover:underline">
            Voir les ordres de fabrication →
          </Link>
          <Link href="/atelier/transverse" className="text-sm font-medium text-brand hover:underline">
            Vue transverse par section →
          </Link>
        </div>
      </div>
    );
  }

  if (profile.role === "chef_section") {
    const { data: workOrders } = await supabase
      .from("work_orders")
      .select("id,quantity_planned,quantity_done")
      .eq("section_id", profile.section_id!);

    const enCours = workOrders?.filter((w) => w.quantity_done < w.quantity_planned).length ?? 0;
    const atteints = workOrders?.filter((w) => w.quantity_done >= w.quantity_planned).length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader title="File de ma section" description="Ordres de travail assignés à votre section." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Ordres assignés" value={workOrders?.length ?? 0} tone="neutral" />
          <StatCard label="En cours" value={enCours} tone="brand" />
          <StatCard label="Quantité atteinte" value={atteints} tone="info" />
        </div>
        <Link href="/atelier/section" className="text-sm font-medium text-brand hover:underline">
          Ouvrir la file de travail →
        </Link>
      </div>
    );
  }

  if (profile.role === "infographiste") {
    const { data: requests } = await supabase
      .from("requests")
      .select("id,reference,status,created_at,companies(name)")
      .eq("needs_graphics", true)
      .order("created_at", { ascending: false });

    return (
      <div className="space-y-6">
        <PageHeader title="Demandes graphiques" description="Demandes nécessitant une intervention visuelle." />
        <Card>
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {requests?.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.reference}</p>
                    <p className="text-xs text-foreground-muted">
                      {(r.companies as unknown as { name: string } | null)?.name}
                    </p>
                  </div>
                  <StatusBadge status={r.status} labels={REQUEST_STATUS_LABELS} kind="request" />
                </li>
              ))}
              {(!requests || requests.length === 0) && (
                <li className="px-5 py-6 text-sm text-foreground-muted">Aucune demande en attente.</li>
              )}
            </ul>
          </CardBody>
        </Card>
      </div>
    );
  }

  return null;
}
