import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, REQUEST_STATUS_LABELS, SAMPLE_STATUS_LABELS } from "@/lib/types/domain";
import { notFound } from "next/navigation";
import { StatusSelect } from "./status-select";
import { MessageThread, type Message } from "./message-thread";
import { QuoteForm } from "./quote-form";
import { postMessage } from "@/lib/actions/requests";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { CreateSampleDialog } from "@/components/samples/create-sample-dialog";
import { getSampleQuoteLineOptions } from "@/lib/samples";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { authId } = await requireRole(["commercial", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select("*,companies(id,name,email,phone),contacts(first_name,last_name,email)")
    .eq("id", id)
    .single();

  if (!request) notFound();

  const [{ data: messages }, { data: quotes }, { data: products }, { data: zoneTemplates }, { data: colors }, { data: samples }, quoteLines] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id,body,created_at,sender_id,app_users(full_name)")
        .eq("request_id", id)
        .order("created_at", { ascending: true }),
      supabase.from("quotes").select("id,reference,status,total_amount,created_at").eq("request_id", id),
      supabase.from("product_models").select("id,name,base_price").eq("active", true),
      // Gabarits de zones de tous les modèles — nécessaire au sélecteur de
      // couleur du devis (chantier config-produit-devis) dès qu'une ligne
      // choisit un modèle, sans aller-retour supplémentaire par ligne.
      supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label,display_order"),
      supabase.from("colors").select("id,name,code").eq("active", true).order("name"),
      // Fiches échantillon rattachées à cette demande (migration 0051).
      supabase
        .from("sample_requests")
        .select("id,sample_number,need_description,status,quote_line_id")
        .eq("request_id", id)
        .order("created_at", { ascending: false }),
      getSampleQuoteLineOptions([id]),
    ]);

  const zoneTemplatesByModel = (zoneTemplates ?? []).reduce<Record<string, { zone_key: string; zone_label: string; display_order: number }[]>>(
    (acc, z) => {
      (acc[z.product_model_id] ??= []).push({ zone_key: z.zone_key, zone_label: z.zone_label, display_order: z.display_order });
      return acc;
    },
    {}
  );

  const company = request.companies as unknown as { id: string; name: string; email: string; phone: string };
  const contact = request.contacts as unknown as { first_name: string; last_name: string; email: string } | null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        description={company?.name}
        action={<StatusSelect requestId={request.id} current={request.status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Description du besoin" />
            <CardBody>
              <p className="text-sm text-foreground">{request.description}</p>
              {request.needs_graphics && (
                <p className="mt-3 text-xs text-accent">🎨 Nécessite une intervention graphique</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Devis" description="Historique et création de devis pour cette demande" />
            <CardBody className="space-y-3">
              {quotes && quotes.length > 0 && (
                <ul className="space-y-2">
                  {quotes.map((q) => (
                    <li key={q.id} className="flex items-center justify-between rounded-md border border-border p-3">
                      <div>
                        <Link href={`/commercial/devis/${q.id}`} className="text-sm font-medium text-foreground hover:text-brand">
                          {q.reference}
                        </Link>
                        <p className="text-xs text-foreground-muted">{formatDate(q.created_at)}</p>
                      </div>
                      <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
                    </li>
                  ))}
                </ul>
              )}
              <QuoteForm
                requestId={request.id}
                companyId={company.id}
                products={products ?? []}
                zoneTemplatesByModel={zoneTemplatesByModel}
                colors={colors ?? []}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Échantillons"
              description="Un modèle par fiche, fabriqué en un exemplaire — lien facultatif à une ligne de devis"
              action={
                <CreateSampleDialog
                  fixedRequest={{ id: request.id, reference: request.reference, companyName: company?.name ?? "" }}
                  quoteLines={quoteLines}
                />
              }
            />
            <CardBody>
              {samples && samples.length > 0 ? (
                <ul className="space-y-2">
                  {samples.map((sr) => {
                    const line = quoteLines.find((l) => l.id === sr.quote_line_id);
                    return (
                      <li key={sr.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                        <div className="min-w-0">
                          <Link href={`/echantillons/${sr.sample_number}`} className="font-mono text-sm font-medium text-foreground hover:text-brand">
                            {sr.sample_number}
                          </Link>
                          <p className="truncate text-xs text-foreground-muted" title={sr.need_description}>
                            {sr.need_description}
                          </p>
                          {line && (
                            <p className="text-xs text-foreground-muted">
                              Ligne {line.quoteReference} — {line.description}
                              {line.orderLine ? ` · ${line.orderLine.orderReference}` : ""}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={sr.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-foreground-muted">Aucun échantillon rattaché à cette demande.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Échanges" />
            <MessageThread
              messages={(messages ?? []) as unknown as Message[]}
              currentUserId={authId}
              action={postMessage.bind(null, request.id)}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Client" />
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium text-foreground">{company?.name}</p>
              {contact && (
                <p className="text-foreground-muted">
                  {contact.first_name} {contact.last_name}
                </p>
              )}
              <p className="text-foreground-muted">{company?.email}</p>
              <p className="text-foreground-muted">{company?.phone}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Statut" />
            <CardBody>
              <StatusBadge status={request.status} labels={REQUEST_STATUS_LABELS} kind="request" />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
