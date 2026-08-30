import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { SyncButton } from "./sync-button";
import { Lock } from "lucide-react";

export default async function ClientsSagePage() {
  const { profile } = await requireRole(["administrateur", "commercial", "responsable_production"]);
  const supabase = await createClient();

  const { data: customers } = await supabase.from("sage_customers_view").select("*,companies(name)").order("name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients (Sage)"
        description="Vue miroir en lecture seule — Sage reste l'unique source de vérité pour la fiche client comptable ; la fiche client CRM Seritex (Clients) reste distincte et sert la relation commerciale."
        action={profile.role === "administrateur" ? <SyncButton /> : undefined}
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Aucune écriture n&apos;est possible depuis Seritex sur cette vue.
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Code Sage</th>
                <th className="px-5 py-3 font-medium">Raison sociale</th>
                <th className="px-5 py-3 font-medium">Téléphone</th>
                <th className="px-5 py-3 font-medium">Rapprochement</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers?.map((c) => (
                <tr key={c.sage_code}>
                  <td className="px-5 py-3 font-mono text-xs text-foreground-muted">{c.sage_code}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-5 py-3 text-foreground-muted">{c.phone ?? "—"}</td>
                  <td className="px-5 py-3">
                    {(c.companies as unknown as { name: string } | null)?.name ? (
                      <Badge tone="success">{(c.companies as unknown as { name: string }).name}</Badge>
                    ) : (
                      <Badge tone="warning">Non rapproché</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{formatDateTime(c.last_sync_at)}</td>
                </tr>
              ))}
              {(!customers || customers.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    Aucune donnée — lancez une synchronisation.
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
