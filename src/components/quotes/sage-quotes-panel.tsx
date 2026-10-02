import Link from "next/link";
import { Search, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime } from "@/lib/utils";
import type { SageQuoteSummary } from "@/lib/sage-quotes";

/**
 * « Récupérer un devis Sage » (migration 0071) : les devis Sage en cours du
 * client de la demande, avec recherche par numéro. Récupérer un devis recharge
 * la page avec `?sage=<n°>` : le formulaire de devis s'ouvre alors prérempli
 * (voir QuoteForm, prop `prefill`). Rien n'est créé avant la soumission du
 * formulaire, et le devis passe ensuite par la validation interne habituelle.
 */
export function SageQuotesPanel({
  requestId,
  hasSageCode,
  quotes,
  total,
  searchQuery,
  searchResults,
  lastSync,
  prefillError,
}: {
  requestId: string;
  hasSageCode: boolean;
  quotes: SageQuoteSummary[];
  total: number;
  searchQuery: string;
  searchResults: SageQuoteSummary[] | null;
  lastSync: string | null;
  prefillError: string | null;
}) {
  const href = (piece: string) => `/commercial/demandes/${requestId}?sage=${encodeURIComponent(piece)}#devis`;

  const row = (q: SageQuoteSummary) => (
    <li key={q.sage_piece} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-mono font-medium text-foreground">{q.sage_piece}</p>
        <p className="text-xs text-foreground-muted">
          {[q.doc_date ? formatDate(q.doc_date) : null, q.client_ref ? `Réf. client ${q.client_ref}` : null, `${q.line_count} ligne${q.line_count > 1 ? "s" : ""}`]
            .filter(Boolean)
            .join(" · ")}
          {q.client_name ? ` · ${q.client_name}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p className="font-medium text-foreground">{formatAmount(q.total_ht)} HT</p>
        <p className="text-xs text-foreground-muted">{formatAmount(q.total_ttc)} TTC</p>
      </div>
      {q.importedAs ? (
        <Badge tone="neutral">Déjà récupéré : {q.importedAs}</Badge>
      ) : q.sameClient === false ? (
        <Badge tone="warning">Autre client</Badge>
      ) : q.line_count === 0 ? (
        <Badge tone="warning">Sans ligne</Badge>
      ) : (
        <Link
          href={href(q.sage_piece)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          <Download className="h-3.5 w-3.5" /> Récupérer
        </Link>
      )}
    </li>
  );

  return (
    <div id="devis" className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Récupérer un devis Sage</p>
        <p className="text-xs text-foreground-muted">
          {lastSync ? `Synchronisé le ${formatDateTime(lastSync)} (toutes les 15 min)` : "Aucune synchronisation des devis Sage pour l'instant"}
        </p>
      </div>

      {prefillError && <p className="rounded-md bg-danger-soft/40 px-3 py-2 text-sm text-foreground">{prefillError}</p>}

      <form method="get" className="flex gap-2" action={`/commercial/demandes/${requestId}#devis`}>
        <input
          name="sage_q"
          defaultValue={searchQuery}
          placeholder="Chercher un devis Sage par numéro (ex. DE00123)"
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
        />
        <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-muted">
          <Search className="h-3.5 w-3.5" /> Chercher
        </button>
      </form>

      {searchResults !== null && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-foreground-muted">Résultat de la recherche « {searchQuery} »</p>
          {searchResults.length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun devis Sage en cours avec ce numéro.</p>
          ) : (
            <ul className="space-y-2">{searchResults.map(row)}</ul>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground-muted">Devis Sage en cours de ce client{total > 0 ? ` (${total})` : ""}</p>
        {!hasSageCode ? (
          <p className="text-sm text-foreground-muted">Ce client n&apos;est pas relié à un compte Sage : aucun devis à proposer.</p>
        ) : quotes.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun devis en cours dans Sage pour ce client.</p>
        ) : (
          <>
            <ul className="space-y-2">{quotes.map(row)}</ul>
            {total > quotes.length && (
              <p className="text-xs text-foreground-muted">
                Les {quotes.length} plus récents sont affichés sur {total} : cherchez par numéro pour retrouver un devis plus ancien.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
