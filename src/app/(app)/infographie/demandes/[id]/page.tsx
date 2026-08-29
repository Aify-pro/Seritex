import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { notFound } from "next/navigation";
import { MessageThread, type Message } from "@/app/(app)/commercial/demandes/[id]/message-thread";
import { postMessage } from "@/lib/actions/requests";

export default async function InfographieRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { authId } = await requireRole(["infographiste", "administrateur"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select("*,companies(name)")
    .eq("id", id)
    .eq("needs_graphics", true)
    .single();

  if (!request) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id,body,created_at,sender_id,app_users(full_name)")
    .eq("request_id", id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <PageHeader title={request.reference} description={(request.companies as unknown as { name: string })?.name} />
      <Card>
        <CardHeader title="Besoin exprimé" />
        <CardBody>
          <p className="text-sm text-foreground">{request.description}</p>
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
  );
}
