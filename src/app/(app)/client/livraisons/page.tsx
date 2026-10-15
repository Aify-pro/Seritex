import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Tbody, Tr, Th, Td, EmptyRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { ETAT_LIVRAISON_LABELS, type EtatLivraison } from "@/lib/client-suivi";

/**
 * Portail client — suivi des livraisons (LIV-2) : les expéditions de SON
 * entreprise (vue client_livraisons, sans donnée interne), leur état, et le BL une fois préparé.
 */
export default async function ClientLivraisonsPage() {
  const { profile } = await requireRole(["client"]);
  const supabase = await createClient();
  const { data: shipments } = await supabase
    .from("client_livraisons")
    .select("id,reference,etat,mode,lieu_libelle,date_promise,date_planifiee,livree_at,commande_reference,quantite")
    .eq("company_id", profile.company_id!)
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
                <Td className="text-xs">{s.commande_reference ?? "—"}</Td>
                <Td align="right">{s.quantite}</Td>
                <Td className="text-xs">{s.mode === "retrait" ? "Retrait sur place" : s.lieu_libelle ?? "—"}</Td>
                <Td className="text-xs">{formatDate(s.livree_at ?? s.date_planifiee ?? s.date_promise)}</Td>
                <Td>
                  <Badge tone={["livree", "enlevee", "reception_confirmee"].includes(s.etat) ? "success" : s.etat === "litige" ? "danger" : "brand"}>
                    {ETAT_LIVRAISON_LABELS[s.etat as EtatLivraison]}
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
