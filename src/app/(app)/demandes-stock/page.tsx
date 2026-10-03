import Link from "next/link";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/types/domain";
import { CreateStockOdfButton, StockRequestForm, type ModelOption } from "./stock-request-form";

/**
 * Demandes pour le stock (SF-3) : fabrication sans client (D4) — réassort de
 * t-shirts vierges, anticipation. Créées par les commerciaux, la production
 * ou la Direction (D11) ; l'ODF qui en découle est validé par la Direction,
 * sans attestation comptable.
 */
export default async function StockRequestsPage() {
  const { profile } = await requireRole(["administrateur", "commercial", "responsable_production"]);
  const supabase = await createClient();
  const [{ data: requests }, { data: models }, { data: modelColors }, { data: modelSizes }, { data: sizes }] = await Promise.all([
    supabase
      .from("requests")
      .select("id,reference,status,description,lignes_stock,created_at,production_orders!production_orders_request_id_fkey(id,reference,status)")
      .is("company_id", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("product_models").select("id,name").eq("active", true).order("name"),
    supabase.from("product_model_colors").select("product_model_id,colors(id,name)"),
    supabase.from("product_model_sizes").select("product_model_id,sizes(cle,libelle,groupe,display_order)"),
    supabase.from("sizes").select("cle,libelle,groupe,display_order").eq("active", true).order("groupe").order("display_order"),
  ]);
  const canCreateOdf = profile.role === "administrateur" || profile.role === "responsable_production";

  const options: ModelOption[] = (models ?? []).map((m) => {
    const ownSizes = (modelSizes ?? [])
      .filter((s) => s.product_model_id === m.id)
      .map((s) => s.sizes as unknown as { cle: string; libelle: string; groupe: string; display_order: number })
      .sort((a, b) => a.groupe.localeCompare(b.groupe) || a.display_order - b.display_order);
    return {
      id: m.id,
      name: m.name,
      colors: (modelColors ?? []).filter((c) => c.product_model_id === m.id).map((c) => c.colors as unknown as { id: string; name: string }),
      sizes: (ownSizes.length ? ownSizes : (sizes ?? [])).map((s) => ({ cle: s.cle, libelle: s.libelle })),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demandes pour le stock"
        description="Fabrication sans client : l'ODF qui en découle passe sans attestation comptable, ne crée aucune livraison, et son 1er choix entre en stock de produits finis vierges."
      />
      <Card>
        <CardHeader title="Nouvelle demande pour le stock" />
        <CardBody>
          <StockRequestForm models={options} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Demandes" />
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {(requests ?? []).length === 0 && <li className="px-5 py-4 text-sm text-foreground-muted">Aucune demande pour le stock.</li>}
            {(requests ?? []).map((r) => {
              const odfs = (r.production_orders ?? []) as unknown as { id: string; reference: string; status: string }[];
              const lignes = (r.lignes_stock ?? []) as { description: string; tailles: Record<string, number> }[];
              const odf = odfs.find((o) => o.status !== "annulee");
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {r.reference} <Badge tone="neutral">{REQUEST_STATUS_LABELS[r.status as RequestStatus]}</Badge>
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {formatDate(r.created_at)} · {lignes.map((l) => `${l.description} (${Object.values(l.tailles).reduce((a, b) => a + b, 0)})`).join(", ")}
                    </p>
                    {r.description && <p className="text-xs text-foreground-muted">{r.description}</p>}
                  </div>
                  {odf ? (
                    <Link href={`/atelier/production/${odf.id}`} className="text-xs font-medium text-brand hover:underline">
                      {odf.reference} →
                    </Link>
                  ) : canCreateOdf ? (
                    <CreateStockOdfButton requestId={r.id} />
                  ) : (
                    <span className="text-xs text-foreground-muted">En attente de la production</span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
