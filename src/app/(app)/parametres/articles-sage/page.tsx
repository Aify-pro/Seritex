import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { Lock } from "lucide-react";
import { MIRROR_PAGE_SIZE, orIlike, pageRange, parseMirrorParams } from "@/lib/sage-mirror/list";
import { MirrorToolbar, type MirrorFilterDef } from "@/components/sage-mirror/mirror-toolbar";
import { MirrorPagination } from "@/components/sage-mirror/mirror-pagination";
import { DetailRows, type DetailRow } from "@/components/sage-mirror/detail-rows";
import { StockClosureComparison } from "../stock/closure-comparison";

const FILTER_KEYS = ["statut", "rapprochement"] as const;

const FILTERS: MirrorFilterDef[] = [
  {
    key: "statut",
    label: "Statut Sage",
    options: [
      { value: "", label: "Tous" },
      { value: "actif", label: "Actifs" },
      { value: "inactif", label: "Inactifs" },
    ],
  },
  {
    key: "rapprochement",
    label: "Rapprochement",
    options: [
      { value: "", label: "Tous" },
      { value: "oui", label: "Rapprochés" },
      { value: "non", label: "Non rapprochés" },
    ],
  },
];

type StockLine = {
  sage_reference: string;
  warehouse: string;
  unit: string;
  category: string;
  quantite_reelle: number;
  quantite_reservee: number;
  quantity_available: number;
  last_sync_at: string;
};

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/**
 * Catalogue articles Sage + stock. Les articles et leur stock viennent de la
 * même table Sage (une ligne de stock par article et par dépôt) : un seul
 * écran, au lieu de deux listes quasi identiques. Le stock n'est lu que pour
 * les rôles autorisés (RLS de `stock_item_view`) ; le commercial voit le
 * catalogue sans les quantités.
 */
export default async function ArticlesSagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireRole(["administrateur", "commercial", "responsable_production", "gestionnaire_stock"]);
  const canSeeStock = profile.role !== "commercial";
  const isDirection = profile.role === "administrateur" || profile.role === "responsable_production";
  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams, FILTER_KEYS);
  const { statut, rapprochement } = params.filters;

  let query = supabase.from("sage_articles_view").select("*,product_models(name)", { count: "exact" });
  const search = orIlike(["sage_reference", "designation", "category"], params.q);
  if (search) query = query.or(search);
  if (statut === "actif") query = query.eq("active", true);
  if (statut === "inactif") query = query.eq("active", false);
  if (rapprochement === "oui") query = query.not("linked_product_model_id", "is", null);
  if (rapprochement === "non") query = query.is("linked_product_model_id", null);

  const [from, to] = pageRange(params.page);
  const { data: articles, count, error } = await query.order("designation").range(from, to);

  const refs = (articles ?? []).map((a) => a.sage_reference as string);
  const { data: stockData } =
    canSeeStock && refs.length
      ? await supabase
          .from("stock_item_view")
          .select("sage_reference,warehouse,unit,category,quantite_reelle,quantite_reservee,quantity_available,last_sync_at")
          .in("sage_reference", refs)
          .order("warehouse")
      : { data: [] as StockLine[] };
  const stockByRef = new Map<string, StockLine[]>();
  for (const s of (stockData ?? []) as StockLine[]) {
    const list = stockByRef.get(s.sage_reference) ?? [];
    list.push(s);
    stockByRef.set(s.sage_reference, list);
  }

  const cellClasses = [
    "px-5 py-3 font-mono text-xs text-foreground-muted",
    "px-5 py-3 font-medium text-foreground",
    "px-5 py-3 text-foreground-muted",
    ...(canSeeStock ? ["px-5 py-3 text-foreground-muted"] : []),
    "px-5 py-3",
    "px-5 py-3 text-foreground-muted",
  ];

  const rows: DetailRow[] = (articles ?? []).map((a) => {
    const model = (a.product_models as unknown as { name: string } | null)?.name;
    const rapproche = model ? <Badge tone="success">{model}</Badge> : <Badge tone="warning">Non rapproché</Badge>;
    const price = a.sale_price != null ? `${a.sale_price} €` : "—";
    const lines = stockByRef.get(a.sage_reference) ?? [];
    const unit = a.unit ?? lines[0]?.unit ?? "";
    const disponible = lines.reduce((sum, l) => sum + Number(l.quantity_available), 0);
    const reel = lines.reduce((sum, l) => sum + Number(l.quantite_reelle), 0);
    const reserve = lines.reduce((sum, l) => sum + Number(l.quantite_reservee), 0);
    const stockCell = lines.length ? `${nf.format(disponible)} ${unit}`.trim() : "—";
    const category = a.category ?? lines[0]?.category;

    return {
      id: a.sage_reference,
      cells: [
        a.sage_reference,
        a.designation,
        price,
        ...(canSeeStock ? [stockCell] : []),
        rapproche,
        formatDateTime(a.last_sync_at),
      ],
      title: a.designation,
      subtitle: `Référence Sage ${a.sage_reference}`,
      fields: [
        { label: "Référence Sage", value: a.sage_reference },
        { label: "Désignation", value: a.designation },
        { label: "Catégorie", value: category ? String(category).replace(/_/g, " ") : null },
        { label: "Unité", value: a.unit },
        { label: "Prix de vente", value: price === "—" ? null : price },
        { label: "Statut Sage", value: a.active ? "Actif" : "Inactif" },
        { label: "Modèle Seritex rapproché", value: rapproche },
        { label: "Dernière synchro", value: formatDateTime(a.last_sync_at) },
        ...(canSeeStock && lines.length
          ? [
              { label: "Stock réel (tous dépôts)", value: `${nf.format(reel)} ${unit}`.trim() },
              { label: "Réservé (tous dépôts)", value: `${nf.format(reserve)} ${unit}`.trim() },
              { label: "Disponible (tous dépôts)", value: `${nf.format(disponible)} ${unit}`.trim() },
            ]
          : []),
      ],
      extra: canSeeStock ? (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Stock par dépôt</h3>
          {lines.length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucune ligne de stock synchronisée pour cet article.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left uppercase tracking-wide text-foreground-muted">
                    <th className="px-3 py-2 font-medium">Dépôt</th>
                    <th className="px-3 py-2 text-right font-medium">Réel</th>
                    <th className="px-3 py-2 text-right font-medium">Réservé</th>
                    <th className="px-3 py-2 text-right font-medium">Disponible</th>
                    <th className="px-3 py-2 font-medium">Dernière synchro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={l.warehouse}>
                      <td className="px-3 py-2 text-foreground">{l.warehouse}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{nf.format(Number(l.quantite_reelle))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{nf.format(Number(l.quantite_reservee))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{nf.format(Number(l.quantity_available))}</td>
                      <td className="px-3 py-2 text-foreground-muted">{formatDateTime(l.last_sync_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : undefined,
    };
  });

  const filtered = Boolean(params.q) || Object.values(params.filters).some(Boolean);
  const columns = 5 + (canSeeStock ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={canSeeStock ? "Articles et stock (Sage)" : "Articles (Sage)"}
        description={
          canSeeStock
            ? "Vue miroir en lecture seule du catalogue articles Sage et de son stock (une ligne par article, détail par dépôt dans la fiche) — le catalogue produit Seritex (modèles, gammes) reste distinct et sert la fabrication."
            : "Vue miroir en lecture seule du catalogue articles Sage — le catalogue produit Seritex (modèles, gammes) reste distinct et sert la fabrication."
        }
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Aucune écriture n&apos;est possible depuis Seritex sur cette vue. Cliquez sur une ligne pour voir la fiche
        complète.
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={params.filters}
        filters={FILTERS}
        label="Rechercher un article Sage"
        placeholder="Rechercher : référence, désignation, catégorie…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les articles Sage ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Référence Sage</th>
                <th className="px-5 py-3 font-medium">Désignation</th>
                <th className="px-5 py-3 font-medium">Prix</th>
                {canSeeStock && <th className="px-5 py-3 font-medium">Stock disponible</th>}
                <th className="px-5 py-3 font-medium">Rapprochement</th>
                <th className="px-5 py-3 font-medium">Dernière synchro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={cellClasses} />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {filtered ? "Aucun article ne correspond à la recherche." : "Aucune donnée — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/articles-sage"
            query={{ q: params.q, ...params.filters }}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={count ?? 0}
            noun="article"
          />
        </CardBody>
      </Card>

      {isDirection && <StockClosureComparison />}
    </div>
  );
}
