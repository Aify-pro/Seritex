import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { SyncButton } from "./sync-button";
import { Lock } from "lucide-react";

export default async function ArticlesSagePage() {
  const { profile } = await requireRole(["administrateur", "commercial", "responsable_production"]);
  const supabase = await createClient();

  const { data: articles } = await supabase
    .from("sage_articles_view")
    .select("*,product_models(name)")
    .order("designation");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Articles (Sage)"
        description="Vue miroir en lecture seule du catalogue articles Sage — le catalogue produit Seritex (modèles, gammes) reste distinct et sert la fabrication."
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
                <th className="px-5 py-3 font-medium">Référence Sage</th>
                <th className="px-5 py-3 font-medium">Désignation</th>
                <th className="px-5 py-3 font-medium">Prix</th>
                <th className="px-5 py-3 font-medium">Rapprochement</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {articles?.map((a) => (
                <tr key={a.sage_reference}>
                  <td className="px-5 py-3 font-mono text-xs text-foreground-muted">{a.sage_reference}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{a.designation}</td>
                  <td className="px-5 py-3 text-foreground-muted">{a.sale_price != null ? `${a.sale_price} €` : "—"}</td>
                  <td className="px-5 py-3">
                    {(a.product_models as unknown as { name: string } | null)?.name ? (
                      <Badge tone="success">{(a.product_models as unknown as { name: string }).name}</Badge>
                    ) : (
                      <Badge tone="warning">Non rapproché</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{formatDateTime(a.last_sync_at)}</td>
                </tr>
              ))}
              {(!articles || articles.length === 0) && (
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
