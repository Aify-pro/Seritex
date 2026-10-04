import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import { getSageQuotesLastSync } from "@/lib/sage-quotes";
import { Lock } from "lucide-react";
import { MIRROR_PAGE_SIZE, orIlike, pageRange, parseMirrorParams, searchPattern } from "@/lib/sage-mirror/list";
import { MirrorToolbar } from "@/components/sage-mirror/mirror-toolbar";
import { MirrorPagination } from "@/components/sage-mirror/mirror-pagination";
import { DetailRows, type DetailRow } from "@/components/sage-mirror/detail-rows";

const SEARCH_COLUMNS = ["sage_piece", "client_ref", "client_sage_code"];

const CELL_CLASSES = [
  "px-5 py-3 font-mono text-xs text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 font-medium text-foreground",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3",
];

export default async function DevisSagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["administrateur", "commercial", "responsable_production"]);
  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams);

  // La recherche porte aussi sur le nom du client : on retrouve d'abord les
  // codes clients correspondants, puis on les ajoute au filtre sur les devis.
  const clauses: string[] = [];
  const base = orIlike(SEARCH_COLUMNS, params.q);
  if (base) clauses.push(base);
  const pattern = searchPattern(params.q);
  if (pattern) {
    const { data: matching } = await supabase.from("sage_customers_view").select("sage_code").ilike("name", pattern).limit(200);
    const codes = (matching ?? []).map((c) => String(c.sage_code).replace(/["\\,()]/g, ""));
    if (codes.length) clauses.push(`client_sage_code.in.(${codes.map((c) => `"${c}"`).join(",")})`);
  }

  let query = supabase
    .from("sage_quotes_view")
    .select("sage_piece,doc_date,client_ref,client_sage_code,representant_no,total_ht,total_ttc,date_livraison,statut,last_sync_at", {
      count: "exact",
    });
  if (clauses.length) query = query.or(clauses.join(","));

  const [from, to] = pageRange(params.page);
  const [{ data: quotes, count, error }, lastSync] = await Promise.all([
    query.order("doc_date", { ascending: false, nullsFirst: false }).range(from, to),
    getSageQuotesLastSync(),
  ]);
  const total = count ?? 0;

  const pieces = (quotes ?? []).map((q) => q.sage_piece as string);
  const codes = Array.from(new Set((quotes ?? []).map((q) => q.client_sage_code as string)));
  const repNos = Array.from(new Set((quotes ?? []).map((q) => q.representant_no).filter((n): n is number => n != null)));
  const [{ data: customers }, { data: imported }, { data: lines }, { data: reps }] = await Promise.all([
    codes.length
      ? supabase.from("sage_customers_view").select("sage_code,name").in("sage_code", codes)
      : Promise.resolve({ data: [] as { sage_code: string; name: string }[] }),
    pieces.length
      ? supabase.from("quotes").select("sage_piece,reference").in("sage_piece", pieces)
      : Promise.resolve({ data: [] as { sage_piece: string; reference: string }[] }),
    pieces.length
      ? supabase
          .from("sage_quote_lines_view")
          .select("sage_piece,line_no,position,ar_ref,designation,quantity,unit_price,remise_pct,tva_rate,total_ht")
          .in("sage_piece", pieces)
          .order("position")
          .order("line_no")
      : Promise.resolve({ data: [] }),
    repNos.length
      ? supabase.from("sage_representants").select("co_no,name").in("co_no", repNos)
      : Promise.resolve({ data: [] as { co_no: number; name: string }[] }),
  ]);
  const names = new Map((customers ?? []).map((c) => [c.sage_code as string, c.name as string]));
  const importedAs = new Map((imported ?? []).map((q) => [q.sage_piece as string, q.reference as string]));
  const repNames = new Map((reps ?? []).map((r) => [r.co_no as number, r.name as string]));

  const rows: DetailRow[] = (quotes ?? []).map((q) => {
    const reference = importedAs.get(q.sage_piece);
    const client = names.get(q.client_sage_code) ?? q.client_sage_code;
    const dansSeritex = reference ? <Badge tone="success">{reference}</Badge> : <Badge tone="neutral">Pas récupéré</Badge>;
    const quoteLines = (lines ?? []).filter((l) => l.sage_piece === q.sage_piece);
    return {
      id: q.sage_piece,
      cells: [
        q.sage_piece,
        formatDate(q.doc_date),
        client,
        q.client_ref || "—",
        formatAmount(Number(q.total_ht)),
        formatAmount(Number(q.total_ttc)),
        formatDate(q.date_livraison),
        dansSeritex,
      ],
      title: `Devis ${q.sage_piece}`,
      subtitle: client,
      fields: [
        { label: "Pièce Sage", value: q.sage_piece },
        { label: "Date", value: formatDate(q.doc_date) },
        { label: "Client", value: `${client} (${q.client_sage_code})` },
        { label: "Réf. client", value: q.client_ref },
        { label: "Commercial (Sage)", value: q.representant_no != null ? (repNames.get(q.representant_no) ?? `n° ${q.representant_no}`) : null },
        { label: "Livraison prévue", value: formatDate(q.date_livraison) },
        { label: "Total HT", value: formatAmount(Number(q.total_ht)) },
        { label: "Total TTC", value: formatAmount(Number(q.total_ttc)) },
        { label: "Dans Seritex", value: dansSeritex },
        { label: "Dernière synchro", value: formatDateTime(q.last_sync_at) },
      ],
      extra: (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Lignes du devis ({quoteLines.length})
          </h3>
          {quoteLines.length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucune ligne synchronisée pour ce devis.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left uppercase tracking-wide text-foreground-muted">
                    <th className="px-3 py-2 font-medium">Référence</th>
                    <th className="px-3 py-2 font-medium">Désignation</th>
                    <th className="px-3 py-2 text-right font-medium">Qté</th>
                    <th className="px-3 py-2 text-right font-medium">PU HT</th>
                    <th className="px-3 py-2 text-right font-medium">Remise</th>
                    <th className="px-3 py-2 text-right font-medium">Total HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quoteLines.map((l) => (
                    <tr key={l.line_no}>
                      <td className="px-3 py-2 font-mono text-foreground-muted">{l.ar_ref ?? "—"}</td>
                      <td className="px-3 py-2 text-foreground">{l.designation}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{Number(l.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">{formatAmount(Number(l.unit_price))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground-muted">
                        {Number(l.remise_pct) ? `${Number(l.remise_pct)} %` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{formatAmount(Number(l.total_ht))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devis (Sage)"
        description="Devis en cours dans Sage, en lecture seule. Pour en reprendre un, utilisez « Récupérer un devis Sage » depuis la demande du client : il préremplit le devis Seritex et évite la double saisie."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Aucune écriture n&apos;est possible depuis Seritex. Un devis disparaît de cette liste dès qu&apos;il est
          transformé (commande, BL, facture) ou purgé dans Sage. Dernière synchro :{" "}
          {lastSync ? formatDateTime(lastSync) : "jamais"}. Cliquez sur une ligne pour voir le devis complet.
        </span>
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={{}}
        filters={[]}
        label="Rechercher un devis Sage"
        placeholder="Rechercher : n° de pièce, client, code client, référence client…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les devis Sage ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Pièce Sage</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Client</th>
                <th className="px-5 py-3 font-medium">Réf. client</th>
                <th className="px-5 py-3 text-right font-medium">Total HT</th>
                <th className="px-5 py-3 text-right font-medium">Total TTC</th>
                <th className="px-5 py-3 font-medium">Livraison</th>
                <th className="px-5 py-3 font-medium">Dans Seritex</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={CELL_CLASSES} size="lg" />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {params.q ? "Aucun devis ne correspond à la recherche." : "Aucun devis Sage en cours — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/devis-sage"
            query={{ q: params.q }}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={total}
            noun="devis"
            plural="devis"
          />
        </CardBody>
      </Card>
    </div>
  );
}
