import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/delivery/status";

/**
 * Portail client — suivi des livraisons (LIV-2) : les expéditions de SON
 * entreprise (RLS is_client_of), leur statut, et le BL une fois préparé.
 */
export default async function ClientLivraisonsPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();
  const { data: shipments } = await supabase
    .from("shipments")
    .select("id,reference,statut,mode,lieu_libelle,date_promise,date_planifiee,livree_at,production_orders(reference),shipment_lines(quantite)")
    .eq("company_id", profile.company_id!)
    .neq("statut", "annulee")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader title="Mes livraisons" description="Suivi de vos livraisons et bons de livraison." />
      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Bon de livraison</Th>
              <Th>Commande</Th>
              <Th align="right">Pièces</Th>
              <Th>Lieu</Th>
              <Th>Date</Th>
              <Th>Statut</Th>
            </tr>
          </Thead>
          <Tbody>
            {(shipments ?? []).length === 0 && <EmptyRow colSpan={6}>Aucune livraison pour le moment.</EmptyRow>}
            {(shipments ?? []).map((s) => (
              <Tr key={s.id}>
                <Td>
                  {s.reference ? (
                    <a href={`/api/livraisons/${s.id}/bl`} target="_blank" rel="noreferrer" className="font-mono text-xs font-medium text-brand hover:underline">
                      {s.reference}
                    </a>
                  ) : (
                    <span className="text-xs text-foreground-muted">En préparation</span>
                  )}
                </Td>
                <Td className="text-xs">{(s.production_orders as unknown as { reference: string } | null)?.reference ?? "—"}</Td>
                <Td align="right">{((s.shipment_lines ?? []) as { quantite: number }[]).reduce((t, l) => t + l.quantite, 0)}</Td>
                <Td className="text-xs">{s.mode === "retrait" ? "Retrait sur place" : s.lieu_libelle ?? "—"}</Td>
                <Td className="text-xs">{formatDate(s.livree_at ?? s.date_planifiee ?? s.date_promise)}</Td>
                <Td>
                  <Badge tone={["livree", "enlevee", "reception_confirmee"].includes(s.statut) ? "success" : s.statut === "litige" ? "danger" : "brand"}>
                    {SHIPMENT_STATUS_LABELS[s.statut as ShipmentStatus]}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
}
