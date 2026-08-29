import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, type Quote, type QuoteLine } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import { AcceptQuoteButton } from "./accept-quote-button";

export function QuoteDetail({
  quote,
  lines,
  companyName,
  canAccept,
}: {
  quote: Quote;
  lines: QuoteLine[];
  companyName?: string;
  canAccept: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={quote.reference}
          description={companyName}
          action={<StatusBadge status={quote.status} labels={QUOTE_STATUS_LABELS} kind="quote" />}
        />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Qté</th>
                <th className="px-5 py-3 font-medium">PU</th>
                <th className="px-5 py-3 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3">{l.description}</td>
                  <td className="px-5 py-3 text-foreground-muted">{l.quantity}</td>
                  <td className="px-5 py-3 text-foreground-muted">{formatAmount(l.unit_price)}</td>
                  <td className="px-5 py-3 font-medium text-foreground">{formatAmount(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={3} className="px-5 py-3 text-right text-sm font-medium text-foreground">
                  Total
                </td>
                <td className="px-5 py-3 text-sm font-semibold text-foreground">{formatAmount(quote.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </CardBody>
      </Card>

      <p className="text-xs text-foreground-muted">
        {quote.valid_until ? `Valable jusqu'au ${formatDate(quote.valid_until)}` : ""}
      </p>

      {quote.status === "envoye" && canAccept && (
        <Card className="border-success/30 bg-success-soft/40">
          <CardBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-foreground">Ce devis attend une décision</p>
              <p className="text-xs text-foreground-muted">
                La validation déclenche la création de l&apos;ordre de fabrication côté atelier.
              </p>
            </div>
            <AcceptQuoteButton quoteId={quote.id} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
