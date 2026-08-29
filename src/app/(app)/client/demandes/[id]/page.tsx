import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, REQUEST_STATUS_LABELS } from "@/lib/types/domain";
import { notFound } from "next/navigation";
import { MessageThread, type Message } from "@/app/(app)/commercial/demandes/[id]/message-thread";
import { postMessage } from "@/lib/actions/requests";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default async function ClientRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { authId, profile } = await requireRole(["client"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select("*")
    .eq("id", id)
    .eq("company_id", profile.company_id!)
    .single();

  if (!request) notFound();

  const [{ data: messages }, { data: quotes }] = await Promise.all([
    supabase
      .from("messages")
      .select("id,body,created_at,sender_id,app_users(full_name)")
      .eq("request_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("quotes").select("id,reference,status,total_amount,created_at").eq("request_id", id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        action={<StatusBadge status={request.status} labels={REQUEST_STATUS_LABELS} kind="request" />}
      />

      <Card>
        <CardHeader title="Votre demande" />
        <CardBody>
          <p className="text-sm text-foreground">{request.description}</p>
        </CardBody>
      </Card>

      {quotes && quotes.length > 0 && (
        <Card>
          <CardHeader title="Devis liés" />
          <CardBody className="space-y-2">
            {quotes.map((q) => (
              <div key={q.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Link href={`/client/devis/${q.id}`} className="text-sm font-medium text-foreground hover:text-brand">
                    {q.reference}
                  </Link>
                  <p className="text-xs text-foreground-muted">{formatDate(q.created_at)}</p>
                </div>
                <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Échanges" />
        <MessageThread
        messages={(messages ?? []) as unknown as Message[]}
        currentUserId={authId}
        action={postMessage.bind(null, request.id)}
      />
      </Card>
    </div>
  );
}
