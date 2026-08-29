import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { notFound } from "next/navigation";
import { StatusSelect } from "./status-select";
import { MessageThread, type Message } from "./message-thread";
import { QuoteForm } from "./quote-form";
import { postMessage } from "@/lib/actions/requests";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

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

  const [{ data: messages }, { data: quotes }, { data: products }] = await Promise.all([
    supabase
      .from("messages")
      .select("id,body,created_at,sender_id,app_users(full_name)")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("quotes").select("id,reference,status,total_amount,created_at").eq("request_id", id),
    supabase.from("product_models").select("id,name,base_price").eq("active", true),
  ]);

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
              <QuoteForm requestId={request.id} companyId={company.id} products={products ?? []} />
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
