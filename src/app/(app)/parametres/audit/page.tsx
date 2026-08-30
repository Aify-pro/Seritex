import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default async function AuditLogPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const { data: logs } = await supabase
    .from("audit_log")
    .select("id,action,entity_type,entity_id,metadata,occurred_at,app_users(full_name)")
    .order("occurred_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal d'audit"
        description="Toutes les actions sensibles (transitions d'OT, acceptation de devis, décisions d'échantillon...) sont journalisées côté base de données."
      />
      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Utilisateur</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Entité</th>
                <th className="px-5 py-3 font-medium">Détail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs?.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3 text-xs text-foreground-muted">{formatDateTime(l.occurred_at)}</td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {(l.app_users as unknown as { full_name: string } | null)?.full_name ?? "système"}
                  </td>
                  <td className="px-5 py-3 font-medium text-foreground">{l.action}</td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {l.entity_type} <span className="font-mono text-[11px]">{l.entity_id?.slice(0, 8)}</span>
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-foreground-muted">
                    {JSON.stringify(l.metadata)}
                  </td>
                </tr>
              ))}
              {(!logs || logs.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    Aucun événement journalisé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
