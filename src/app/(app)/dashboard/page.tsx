import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { StatCard, Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import {
  REQUEST_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from "@/lib/types/domain";
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
    const [{ data: requests }, { data: quotesEnvoyes }, { data: samples }, { data: blocked }] =
      await Promise.all([
        supabase.from("requests").select("id,status,reference,created_at,companies(id,name)").order(
          "created_at",
          { ascending: false }
        ).limit(6),
        supabase.from("quotes").select("id,status").eq("status", "envoye"),
        supabase.from("sample_requests").select("id,status").not("status", "in", "(valide,refuse,sans_suite)"),
        supabase.from("work_orders").select("id,status").eq("status", "bloque"),
      ]);

    const nouvelles = requests?.filter((r) => r.status === "nouvelle").length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader
          title="Tableau de bord commercial"
          description="Pipeline des demandes, devis et échantillons en cours."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label="Nouvelles demandes" value={nouvelles} tone="info" />
          <StatCard label="Devis en attente client" value={quotesEnvoyes?.length ?? 0} tone="brand" />
          <StatCard label="Échantillons actifs" value={samples?.length ?? 0} tone="accent" />
          <StatCard
            label="OT bloqués (atelier)"
            value={blocked?.length ?? 0}
            tone={blocked && blocked.length > 0 ? "danger" : "neutral"}
          />
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
    const [{ data: orders }, { data: blocked }, { data: sections }] = await Promise.all([
      supabase.from("production_orders").select("id,status"),
      supabase.from("work_orders").select("id,reference,status,section_id,sections(name)").eq("status", "bloque"),
      supabase.from("sections").select("id,name").order("display_order"),
    ]);

    const enCours = orders?.filter((o) => o.status === "en_cours").length ?? 0;
    const aLancer = orders?.filter((o) => o.status === "a_lancer").length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader title="Pilotage atelier" description="Vue d'ensemble des ordres de fabrication." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label="Ordres en cours" value={enCours} tone="brand" />
          <StatCard label="À lancer" value={aLancer} tone="info" />
          <StatCard label="Sections actives" value={sections?.length ?? 0} tone="neutral" />
          <StatCard
            label="OT bloqués"
            value={blocked?.length ?? 0}
            tone={blocked && blocked.length > 0 ? "danger" : "neutral"}
          />
        </div>

        {blocked && blocked.length > 0 && (
          <Card>
            <CardHeader title="Ordres de travail bloqués — action requise" />
            <CardBody className="p-0">
              <ul className="divide-y divide-border">
                {blocked.map((b) => (
                  <li key={b.id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm font-medium text-foreground">{b.reference}</span>
                    <span className="text-xs text-foreground-muted">
                      {(b.sections as unknown as { name: string } | null)?.name}
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
      .select("id,status")
      .eq("section_id", profile.section_id!);

    const parStatut = (s: string) => workOrders?.filter((w) => w.status === s).length ?? 0;

    return (
      <div className="space-y-6">
        <PageHeader title="File de ma section" description="Ordres de travail assignés à votre section." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <StatCard label={WORK_ORDER_STATUS_LABELS.planifie} value={parStatut("planifie")} tone="info" />
          <StatCard label={WORK_ORDER_STATUS_LABELS.en_cours} value={parStatut("en_cours")} tone="brand" />
          <StatCard label={WORK_ORDER_STATUS_LABELS.bloque} value={parStatut("bloque")} tone="danger" />
          <StatCard label={WORK_ORDER_STATUS_LABELS.termine} value={parStatut("termine")} tone="neutral" />
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
