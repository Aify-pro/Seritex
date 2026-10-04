import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { formatMovementUnit } from "@/lib/stock/movements";

const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  entree_semi_fini: "Entrée semi-fini",
  sortie_semi_fini: "Sortie semi-fini",
  entree_fini: "Entrée fini",
  retour_mp: "Retour MP",
};

/**
 * Comparaison de stock des ODF en attente de clôture. À n'afficher qu'à la
 * direction : le contrôle d'accès est fait par la page appelante.
 */
export async function StockClosureComparison() {
  const supabase = await createClient();

  // Lot 11 : comparaison de stock (section 20 du document de logique) —
  // réservée à la direction, dans le cadre du contrôle de clôture (section
  // 4). V1 acceptée par le cahier des charges : affichage côte à côte,
  // vérification manuelle, pas de calcul d'écart automatique — Sage reste
  // la seule source de vérité, et une fiche générée par Seritex n'a aucune
  // garantie d'avoir déjà été importée côté Sage (import manuel, section
  // 19) : un "écart" calculé serait donc trompeur plutôt qu'utile.
  //
  // Portée volontairement limitée aux ODF en attente de clôture
  // (`demande_cloture`) : c'est précisément l'usage que décrit la section
  // 20, pas un historique général de tous les ODF déjà clôturés.

  type PendingMovement = {
    id: string;
    type: string;
    article_ref: string | null;
    quantite_ou_poids: number;
    unite: string;
    exported_in_fiche_id: string | null;
    created_at: string;
  };
  type PendingOrder = {
    id: string;
    reference: string;
    cloture_demandee_at: string | null;
    companies: { name: string } | null;
    movements: PendingMovement[];
  };

  let pendingClosureOrders: PendingOrder[] = [];
  const sageByReference = new Map<string, { designation: string; quantity_available: number; unit: string; last_sync_at: string }>();

  {
    const { data: orders } = await supabase
      .from("production_orders")
      .select("id,reference,cloture_demandee_at,companies(name)")
      .eq("status", "demande_cloture")
      .order("cloture_demandee_at", { ascending: true });

    const orderIds = (orders ?? []).map((o) => o.id);

    const { data: movements } =
      orderIds.length > 0
        ? await supabase
            .from("stock_movements")
            .select("id,production_order_id,type,article_ref,quantite_ou_poids,unite,exported_in_fiche_id,created_at")
            .in("production_order_id", orderIds)
            .order("created_at", { ascending: true })
        : { data: [] as (PendingMovement & { production_order_id: string })[] };

    const articleRefs = Array.from(new Set((movements ?? []).map((m) => m.article_ref).filter((r): r is string => !!r)));

    const { data: sageItems } =
      articleRefs.length > 0
        ? await supabase
            .from("stock_item_view")
            .select("sage_reference,designation,quantity_available,unit,last_sync_at")
            .in("sage_reference", articleRefs)
        : { data: [] };

    // Depuis la migration 0058, un article a une ligne par dépôt : on agrège
    // (somme des quantités, date la plus récente) pour obtenir le total
    // comparable à la quantité mouvementée par Seritex, tous dépôts confondus.
    for (const i of sageItems ?? []) {
      const existing = sageByReference.get(i.sage_reference);
      if (existing) {
        existing.quantity_available += i.quantity_available;
        if (i.last_sync_at > existing.last_sync_at) existing.last_sync_at = i.last_sync_at;
      } else {
        sageByReference.set(i.sage_reference, { ...i });
      }
    }

    pendingClosureOrders = (orders ?? []).map((o) => ({
      id: o.id,
      reference: o.reference,
      cloture_demandee_at: o.cloture_demandee_at,
      companies: o.companies as unknown as { name: string } | null,
      movements: (movements ?? []).filter((m) => m.production_order_id === o.id),
    }));
  }

  return (
      <Card>
        <CardHeader
          title="Comparaison de stock — ODF en attente de clôture"
          description="Contrôle de clôture (section 4/20) : les mouvements demandés par Seritex, à comparer vous-même au stock Sage ci-dessus avant de valider. Aucun écart n'est calculé automatiquement — une fiche générée n'a pas la garantie d'avoir déjà été importée côté Sage."
        />
        <CardBody className={pendingClosureOrders.length === 0 ? undefined : "p-0"}>
          {pendingClosureOrders.length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun ODF en attente de clôture pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pendingClosureOrders.map((order) => (
                <li key={order.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link href={`/atelier/production/${order.id}`} className="text-sm font-medium text-brand hover:underline">
                        {order.reference}
                      </Link>
                      <span className="ml-1 text-sm text-foreground-muted">{order.companies?.name ?? ""}</span>
                    </div>
                    {order.cloture_demandee_at && (
                      <span className="text-xs text-foreground-muted">
                        Clôture demandée le {formatDate(order.cloture_demandee_at)}
                      </span>
                    )}
                  </div>

                  {order.movements.length === 0 ? (
                    <p className="text-xs text-foreground-muted">Aucun mouvement de stock pour cet ODF.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-surface-muted text-left uppercase tracking-wide text-foreground-muted">
                            <th className="px-3 py-2 font-medium">Mouvement Seritex</th>
                            <th className="px-3 py-2 font-medium">Référence</th>
                            <th className="px-3 py-2 font-medium">Quantité</th>
                            <th className="px-3 py-2 font-medium">Statut</th>
                            <th className="px-3 py-2 font-medium">Stock Sage (actuel)</th>
                            <th className="px-3 py-2 font-medium">Dernière synchro Sage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {order.movements.map((m) => {
                            const sageItem = m.article_ref ? sageByReference.get(m.article_ref) : undefined;
                            return (
                              <tr key={m.id}>
                                <td className="px-3 py-2 text-foreground">{STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</td>
                                <td className="px-3 py-2 font-mono text-foreground-muted">
                                  {m.article_ref ?? "— non renseignée"}
                                </td>
                                <td className="px-3 py-2 text-foreground-muted">
                                  {m.quantite_ou_poids} {formatMovementUnit(m.unite)}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge tone={m.exported_in_fiche_id ? "neutral" : "warning"}>
                                    {m.exported_in_fiche_id ? "Exporté" : "Non exporté"}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 text-foreground-muted">
                                  {sageItem ? `${sageItem.quantity_available} ${sageItem.unit}` : "—"}
                                </td>
                                <td className="px-3 py-2 text-foreground-muted">
                                  {sageItem ? formatDateTime(sageItem.last_sync_at) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
  );
}
