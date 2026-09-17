import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, type AttachableMediaFile, type Quote, type QuoteLine } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import { AcceptQuoteButton } from "./accept-quote-button";
import { ZoneColorSummary } from "@/components/product/zone-color-picker";
import { QuoteLineVisuelPicker } from "./quote-line-visuel-picker";
import { QuoteLineMaquettePicker } from "./quote-line-maquette-picker";

export function QuoteDetail({
  quote,
  lines,
  companyName,
  canAccept,
  editable = false,
  availableMediaFiles = [],
}: {
  quote: Quote;
  lines: QuoteLine[];
  companyName?: string;
  canAccept: boolean;
  /** Vue commercial (dépose/remplace visuel et maquette) vs vue client (consultation seule). */
  editable?: boolean;
  /** Médiathèque du client du devis, pour les sélecteurs d'ajout — vide côté client (lecture seule). */
  availableMediaFiles?: AttachableMediaFile[];
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
                  <td className="px-5 py-3">
                    <p>{l.description}</p>
                    {(l.couleur_unique || (l.zone_colors && l.zone_colors.length > 0)) && (
                      <div className="mt-1">
                        <ZoneColorSummary
                          couleurUnique={l.couleur_unique}
                          zoneColors={(l.zone_colors ?? []).map((z) => ({
                            zone_key: z.zone_key,
                            zone_label: z.zone_label,
                            colors: z.colors,
                          }))}
                        />
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <QuoteLineMaquettePicker
                        quoteLineId={l.id}
                        quoteId={quote.id}
                        companyId={quote.company_id}
                        requestId={quote.request_id}
                        editable={editable}
                        attached={l.maquette ?? null}
                        available={availableMediaFiles}
                      />
                      <QuoteLineVisuelPicker
                        quoteLineId={l.id}
                        quoteId={quote.id}
                        companyId={quote.company_id}
                        requestId={quote.request_id}
                        editable={editable}
                        attached={l.visuels ?? []}
                        available={availableMediaFiles}
                      />
                    </div>
                  </td>
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
