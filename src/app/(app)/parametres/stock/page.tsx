import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { Lock } from "lucide-react";
import { MIRROR_PAGE_SIZE, orIlike, pageRange, parseMirrorParams } from "@/lib/sage-mirror/list";
import { MirrorToolbar } from "@/components/sage-mirror/mirror-toolbar";
import { MirrorPagination } from "@/components/sage-mirror/mirror-pagination";
import { DetailRows, type DetailRow } from "@/components/sage-mirror/detail-rows";

const CELL_CLASSES = [
  "px-5 py-3 font-mono text-xs text-foreground-muted",
  "px-5 py-3 font-medium text-foreground",
  "px-5 py-3 capitalize text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
];

/**
 * Stock Sage. Les articles et leur stock viennent de la même table Sage : pour
 * tous les rôles qui lisent aussi le catalogue, le stock est affiché dans
 * l'onglet « Articles et stock » (/parametres/articles-sage) et cet écran n'y
 * renvoie que. Il ne reste en service que pour le chef de section, qui lit le
 * stock mais pas le catalogue (prix, rapprochement) — liste par article/dépôt.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireRole(["administrateur", "responsable_production", "chef_section", "gestionnaire_stock"]);
  if (profile.role !== "chef_section") redirect("/parametres/articles-sage");

  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams);

  let query = supabase.from("stock_item_view").select("*", { count: "exact" });
  const search = orIlike(["sage_reference", "designation", "category", "warehouse"], params.q);
  if (search) query = query.or(search);
  const [from, to] = pageRange(params.page);
  const { data: items, count, error } = await query.order("designation").order("warehouse").range(from, to);

  const rows: DetailRow[] = (items ?? []).map((i) => ({
    id: `${i.sage_reference}|${i.warehouse}`,
    cells: [
      i.sage_reference,
      i.designation,
      String(i.category).replace(/_/g, " "),
      `${i.quantity_available} ${i.unit}`,
      i.warehouse,
      formatDateTime(i.last_sync_at),
    ],
    title: i.designation,
    subtitle: `${i.sage_reference} — dépôt ${i.warehouse}`,
    fields: [
      { label: "Référence Sage", value: i.sage_reference },
      { label: "Désignation", value: i.designation },
      { label: "Catégorie", value: String(i.category).replace(/_/g, " ") },
      { label: "Unité", value: i.unit },
      { label: "Dépôt", value: i.warehouse },
      { label: "Stock réel", value: `${i.quantite_reelle} ${i.unit}` },
      { label: "Réservé", value: `${i.quantite_reservee} ${i.unit}` },
      { label: "Disponible", value: `${i.quantity_available} ${i.unit}` },
      { label: "Dernière synchro", value: formatDateTime(i.last_sync_at) },
    ],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock matières (Sage)"
        description="Vue miroir en lecture seule — Sage reste l'unique source de vérité des stocks."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Aucune écriture n&apos;est possible depuis Seritex sur cette vue : elle est alimentée par une
        synchronisation périodique utilisant un compte technique Sage à droits strictement limités à la lecture. Cliquez
        sur une ligne pour voir le détail.
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={{}}
        filters={[]}
        label="Rechercher dans le stock"
        placeholder="Rechercher : référence, désignation, catégorie, dépôt…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger le stock ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence Sage</th>
                <th className="px-5 py-3 font-medium">Désignation</th>
                <th className="px-5 py-3 font-medium">Catégorie</th>
                <th className="px-5 py-3 font-medium">Disponible</th>
                <th className="px-5 py-3 font-medium">Dépôt</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={CELL_CLASSES} />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {params.q ? "Aucune ligne de stock ne correspond à la recherche." : "Aucune donnée — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/stock"
            query={{ q: params.q }}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={count ?? 0}
            noun="ligne de stock"
            plural="lignes de stock"
          />
        </CardBody>
      </Card>
    </div>
  );
}
