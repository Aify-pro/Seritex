import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { SyncButton } from "./sync-button";
import { Lock } from "lucide-react";

export default async function StockPage() {
  const { profile } = await requireRole(["administrateur", "responsable_production", "chef_section"]);
  const supabase = await createClient();

  const { data: items } = await supabase.from("stock_item_view").select("*").order("designation");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock matières (Sage)"
        description="Vue miroir en lecture seule — Sage reste l'unique source de vérité des stocks."
        action={profile.role === "administrateur" ? <SyncButton /> : undefined}
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Aucune écriture n&apos;est possible depuis Seritex sur cette vue : elle est alimentée par une
        synchronisation périodique utilisant un compte technique Sage à droits strictement limités à la lecture.
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence Sage</th>
                <th className="px-5 py-3 font-medium">Désignation</th>
                <th className="px-5 py-3 font-medium">Catégorie</th>
                <th className="px-5 py-3 font-medium">Disponible</th>
                <th className="px-5 py-3 font-medium">Entrepôt</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items?.map((i) => (
                <tr key={i.sage_reference}>
                  <td className="px-5 py-3 font-mono text-xs text-foreground-muted">{i.sage_reference}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{i.designation}</td>
                  <td className="px-5 py-3 capitalize text-foreground-muted">{i.category}</td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {i.quantity_available} {i.unit}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{i.warehouse}</td>
                  <td className="px-5 py-3 text-foreground-muted">{formatDateTime(i.last_sync_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
