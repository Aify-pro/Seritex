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

const FILTER_KEYS = ["reglement"] as const;
const SEARCH_COLUMNS = ["sage_piece", "doc_ref", "tiers_code", "tiers_name"];

// En dessous de ce solde (F CFA), une facture est considérée comme soldée :
// même seuil que les créances clients de la prospection.
const SEUIL_SOLDE = 1;

const FILTERS: MirrorFilterDef[] = [
  {
    key: "reglement",
    label: "Règlement",
    options: [
      { value: "", label: "Toutes" },
      { value: "a_payer", label: "Reste à payer" },
      { value: "soldees", label: "Soldées" },
    ],
  },
];

const CELL_CLASSES = [
  "px-5 py-3 font-mono text-xs text-foreground-muted",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 font-medium text-foreground",
  "px-5 py-3 text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground-muted",
  "px-5 py-3 text-right tabular-nums text-foreground",
  "px-5 py-3",
];

export default async function AchatsSagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule("achats_sage");
  const supabase = await createClient();
  const params = parseMirrorParams(await searchParams, FILTER_KEYS);

  let query = supabase
    .from("sage_documents_view")
    .select("sage_piece,doc_type,doc_date,tiers_code,tiers_name,doc_ref,total_ht,total_ttc,montant_regle,reste_a_payer,statut,last_sync_at", {
      count: "exact",
    })
    .eq("kind", "facture_achat");
  const search = orIlike(SEARCH_COLUMNS, params.q);
  if (search) query = query.or(search);
  const reglement = params.filters.reglement;
  if (reglement === "a_payer") query = query.gt("reste_a_payer", SEUIL_SOLDE);
  else if (reglement === "soldees") query = query.lte("reste_a_payer", SEUIL_SOLDE);

  const [from, to] = pageRange(params.page);
  const [{ data: invoices, count, error }, { data: last }] = await Promise.all([
    query.order("doc_date", { ascending: false, nullsFirst: false }).order("sage_piece", { ascending: false }).range(from, to),
    supabase.from("sage_documents_view").select("last_sync_at").eq("kind", "facture_achat").order("last_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const total = count ?? 0;

  const pieces = (invoices ?? []).map((i) => i.sage_piece as string);
  const { data: lines } = pieces.length
    ? await supabase
        .from("sage_document_lines_view")
        .select("sage_piece,line_no,position,ar_ref,designation,quantity,unit_price,remise_pct,total_ht,piece_devis,piece_commande,piece_bl")
        .eq("kind", "facture_achat")
        .in("sage_piece", pieces)
        .order("position")
        .order("line_no")
    : { data: [] };

  const rows: DetailRow[] = (invoices ?? []).map((i) => {
    const invoiceLines = (lines ?? []).filter((l) => l.sage_piece === i.sage_piece) as unknown as SageDocumentLine[];
    const fournisseur = i.tiers_name ?? i.tiers_code;
    const reste = Number(i.reste_a_payer);
    const soldee = reste <= SEUIL_SOLDE;
    const badge = soldee ? <Badge tone="success">Soldée</Badge> : <Badge tone="warning">À payer</Badge>;
    return {
      id: i.sage_piece,
      cells: [
        i.sage_piece,
        formatDate(i.doc_date),
        fournisseur,
        i.doc_ref || "—",
        formatAmount(Number(i.total_ht)),
        formatAmount(Number(i.total_ttc)),
        soldee ? "—" : formatAmount(reste),
        badge,
      ],
      title: `Facture d'achat ${i.sage_piece}`,
      subtitle: fournisseur,
      fields: [
        { label: "Pièce Sage", value: i.sage_piece },
        { label: "Nature", value: i.doc_type === 17 ? "Facture comptabilisée" : "Facture" },
        { label: "Date", value: formatDate(i.doc_date) },
        { label: "Fournisseur", value: `${fournisseur} (${i.tiers_code})` },
        { label: "Réf. fournisseur", value: i.doc_ref },
        { label: "Total HT", value: formatAmount(Number(i.total_ht)) },
        { label: "Total TTC", value: formatAmount(Number(i.total_ttc)) },
        { label: "Déjà réglé", value: formatAmount(Number(i.montant_regle)) },
        { label: "Reste à payer", value: soldee ? "Soldée" : formatAmount(reste) },
        { label: "Dernière synchro", value: formatDateTime(i.last_sync_at) },
      ],
      extra: <SageDocumentLines lines={invoiceLines} noun="de la facture" />,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factures d'achat (Sage)"
        description="Factures fournisseurs saisies dans Sage, en lecture seule, sur la période récente synchronisée (depuis le 1er janvier 2025 par défaut)."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Aucune écriture n&apos;est possible depuis Seritex. Dernière synchro : {last?.last_sync_at ? formatDateTime(last.last_sync_at) : "jamais"}.
          Les factures modifiées ces derniers jours sont relues toutes les 15 minutes ; le rapprochement complet se fait la nuit.
        </span>
      </div>

      <MirrorToolbar
        q={params.q}
        filterValues={params.filters}
        filters={FILTERS}
        label="Rechercher une facture d'achat Sage"
        placeholder="Rechercher : n° de pièce, fournisseur, code fournisseur, référence…"
      />

      {error && error.code !== "PGRST103" && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger les factures d&apos;achat Sage ({error.message}).
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Pièce Sage</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Fournisseur</th>
                <th className="px-5 py-3 font-medium">Réf. fournisseur</th>
                <th className="px-5 py-3 text-right font-medium">Total HT</th>
                <th className="px-5 py-3 text-right font-medium">Total TTC</th>
                <th className="px-5 py-3 text-right font-medium">Reste à payer</th>
                <th className="px-5 py-3 font-medium">Règlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <DetailRows rows={rows} cellClassNames={CELL_CLASSES} size="lg" />
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-foreground-muted">
                    {params.q || reglement ? "Aucune facture ne correspond à la recherche." : "Aucune facture d'achat Sage — lancez une synchronisation."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <MirrorPagination
            basePath="/parametres/achats-sage"
            query={{ q: params.q, ...params.filters }}
            page={params.page}
            size={MIRROR_PAGE_SIZE}
            total={total}
            noun="facture"
            plural="factures"
          />
        </CardBody>
      </Card>
    </div>
  );
}
