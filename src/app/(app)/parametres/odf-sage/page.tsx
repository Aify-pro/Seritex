import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { Lock } from "lucide-react";
import { MIRROR_PAGE_SIZE, orIlike, pageRange, parseMirrorParams } from "@/lib/sage-mirror/list";
import { MirrorToolbar, type MirrorFilterDef } from "@/components/sage-mirror/mirror-toolbar";
import { MirrorPagination } from "@/components/sage-mirror/mirror-pagination";
import { DetailRows, type DetailRow } from "@/components/sage-mirror/detail-rows";
import { SageDocumentLines, type SageDocumentLine } from "@/components/sage-mirror/document-lines";

const FILTER_KEYS = ["anciennete"] as const;
const SEARCH_COLUMNS = ["sage_piece", "doc_ref", "tiers_code", "tiers_name"];

const FILTERS: MirrorFilterDef[] = [
  {
    key: "anciennete",
    label: "Ancienneté",
    options: [
      { value: "", label: "Tous" },
      { value: "30", label: "Moins de 30 jours" },
      { value: "90", label: "30 à 90 jours" },
      { value: "plus", label: "Plus de 90 jours" },
    ],
  },
];

const CELL_CLASSES = [
  "px-5 py-3 font-mono text-xs text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 font-medium text-foreground",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3",
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function ageInDays(docDate: string | null): number | null {
  if (!docDate) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(docDate).getTime()) / (24 * 3600 * 1000)));
}

export default async function OdfSagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule("odf_sage");
  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams, FILTER_KEYS);

  let query = supabase
    .from("sage_documents_view")
    .select("sage_piece,doc_date,tiers_code,tiers_name,doc_ref,representant_no,total_ht,total_ttc,date_livraison,statut,last_sync_at", {
      count: "exact",
    })
    .eq("kind", "odf");
  const search = orIlike(SEARCH_COLUMNS, params.q);
  if (search) query = query.or(search);
  const anciennete = params.filters.anciennete;
  if (anciennete === "30") query = query.gte("doc_date", isoDaysAgo(30));
  else if (anciennete === "90") query = query.lt("doc_date", isoDaysAgo(30)).gte("doc_date", isoDaysAgo(90));
  else if (anciennete === "plus") query = query.lt("doc_date", isoDaysAgo(90));

  const [from, to] = pageRange(params.page);
  const [{ data: odfs, count, error }, { data: last }] = await Promise.all([
    query.order("doc_date", { ascending: false, nullsFirst: false }).order("sage_piece", { ascending: false }).range(from, to),
    supabase.from("sage_documents_view").select("last_sync_at").eq("kind", "odf").order("last_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const total = count ?? 0;

  const pieces = (odfs ?? []).map((o) => o.sage_piece as string);
  const repNos = Array.from(new Set((odfs ?? []).map((o) => o.representant_no).filter((n): n is number => n != null)));
  const [{ data: lines }, { data: reps }] = await Promise.all([
    pieces.length
      ? supabase
          .from("sage_document_lines_view")
          .select("sage_piece,line_no,position,ar_ref,designation,quantity,unit_price,remise_pct,total_ht,piece_devis,piece_commande,piece_bl")
          .eq("kind", "odf")
          .in("sage_piece", pieces)
          .order("position")
          .order("line_no")
      : Promise.resolve({ data: [] }),
    repNos.length
      ? supabase.from("sage_representants").select("co_no,name").in("co_no", repNos)
      : Promise.resolve({ data: [] as { co_no: number; name: string }[] }),
  ]);
  const repNames = new Map((reps ?? []).map((r) => [r.co_no as number, r.name as string]));

  const rows: DetailRow[] = (odfs ?? []).map((o) => {
    const odfLines = (lines ?? []).filter((l) => l.sage_piece === o.sage_piece) as unknown as SageDocumentLine[];
    const client = o.tiers_name ?? o.tiers_code;
    const age = ageInDays(o.doc_date);
    const ageBadge =
      age == null ? "—" : age > 90 ? <Badge tone="warning">{age} j</Badge> : <Badge tone="neutral">{age} j</Badge>;
    return {
      id: o.sage_piece,
      cells: [
        o.sage_piece,
        formatDate(o.doc_date),
        client,
        o.doc_ref || "—",
        formatAmount(Number(o.total_ht)),
        formatDate(o.date_livraison),
        ageBadge,
      ],
      title: `ODF ${o.sage_piece}`,
      subtitle: client,
      fields: [
        { label: "Pièce Sage", value: o.sage_piece },
        { label: "Date", value: formatDate(o.doc_date) },
        { label: "Ancienneté", value: age != null ? `${age} jour(s)` : null },
        { label: "Client", value: `${client} (${o.tiers_code})` },
        { label: "Réf. client", value: o.doc_ref },
        { label: "Commercial (Sage)", value: o.representant_no != null ? (repNames.get(o.representant_no) ?? `n° ${o.representant_no}`) : null },
        { label: "Livraison prévue", value: formatDate(o.date_livraison) },
        { label: "Total HT", value: formatAmount(Number(o.total_ht)) },
        { label: "Total TTC", value: formatAmount(Number(o.total_ttc)) },
        { label: "Dernière synchro", value: formatDateTime(o.last_sync_at) },
      ],
      extra: <SageDocumentLines lines={odfLines} noun="de l'ODF" />,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="ODF (Sage)"
        description="Ordres de fabrication en cours dans Sage, en lecture seule. Le commercial transforme le devis en ODF ; quand la fabrication est terminée, l'ODF devient BL puis facture et disparaît de cette liste."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Aucune écriture n&apos;est possible depuis Seritex. Dernière synchro : {last?.last_sync_at ? formatDateTime(last.last_sync_at) : "jamais"}.
          Les lignes sans quantité sont des instructions (impression, broderie). Cliquez sur une ligne pour voir l&apos;ODF complet.
        </span>
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={params.filters}
        filters={FILTERS}
        label="Rechercher un ODF Sage"
        placeholder="Rechercher : n° d'ODF, client, code client, référence client…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les ODF Sage ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">ODF</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Réf. client</th>
                <th className="px-5 py-3 text-right font-medium">Total HT</th>
                <th className="px-5 py-3 font-medium">Livraison</th>
                <th className="px-5 py-3 font-medium">Âge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={CELL_CLASSES} size="lg" />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {params.q || anciennete ? "Aucun ODF ne correspond à la recherche." : "Aucun ODF Sage en cours — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/odf-sage"
            query={{ q: params.q, ...params.filters }}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={total}
            noun="ODF"
            plural="ODF"
          />
        </CardBody>
      </Card>
    </div>
  );
}
