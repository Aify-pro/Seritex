import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, type AttachableMediaFile, type Quote, type QuoteLine } from "@/lib/types/domain";
import { formatAmount, formatDate } from "@/lib/utils";
import { computeQuoteTotals, hasSizePrices, lineNet } from "@/lib/quote-totals";
import { delaiLabel } from "@/lib/delivery";
import { BASE_CURRENCY } from "@/lib/currency";
import { amountInWordsFr } from "@/lib/number-to-words-fr";
import { FileDown } from "lucide-react";
import Link from "next/link";
import { printableZoneLabel } from "@/lib/printable-zones";
import { QuoteLineDispatch } from "./quote-line-dispatch";
import type { SizeOption } from "./dispatch-editor";
import { AcceptQuoteButton } from "./accept-quote-button";
import { ValidateQuoteCard } from "./validate-quote-card";
import { ZoneColorSummary } from "@/components/product/zone-color-picker";
import { QuoteLineVisuelPicker } from "./quote-line-visuel-picker";
import { QuoteLineMaquettePicker } from "./quote-line-maquette-picker";
import { QuoteLineSamplePicker, type QuoteSample } from "./quote-line-sample-picker";
import { CreateSampleDialog } from "@/components/samples/create-sample-dialog";
import type { SampleQuoteLineOption } from "@/lib/samples";

export function QuoteDetail({
  quote,
  lines,
  companyName,
  canAccept,
  editable = false,
  availableMediaFiles = [],
  samples = [],
  sampleCreation,
  canValidate = false,
  validators = [],
  validatedBy = null,
  sizeOptionsByModel = {},
}: {
  quote: Quote;
  lines: QuoteLine[];
  companyName?: string;
  canAccept: boolean;
  /** Vue commercial (dépose/remplace visuel et maquette) vs vue client (consultation seule). */
  editable?: boolean;
  /** Médiathèque du client du devis, pour les sélecteurs d'ajout — vide côté client (lecture seule). */
  availableMediaFiles?: AttachableMediaFile[];
  /** Échantillons de la demande du devis (migration 0051), liables par ligne. */
  samples?: QuoteSample[];
  /**
   * Création d'un échantillon depuis une ligne d'article (0094) : un
   * échantillon se fait par article, jamais pour le devis entier. Absent
   * côté client (consultation seule).
   */
  sampleCreation?: { requestReference: string; quoteLineOptions: SampleQuoteLineOption[] };
  /** Vue commercial : l'utilisateur a une signature active et peut valider (migration 0063). */
  canValidate?: boolean;
  /** Noms des personnes habilitées, affichés tant que le devis attend sa validation. */
  validators?: string[];
  /** Validation interne déjà faite : nom du validateur. */
  validatedBy?: string | null;
  /** Tailles proposables par modèle — affichage ordonné et ajustement de la répartition (migration 0066). */
  sizeOptionsByModel?: Record<string, SizeOption[]>;
}) {
  const tvaRate = Number(quote.tva_rate ?? 0);
  const remisePct = Number(quote.remise_pct ?? 0);
  const acomptePct = Number(quote.acompte_pct ?? 0);
  // Devis antérieur à la migration 0061 : pas de ventilation, le total fait foi.
  const detailed = quote.total_ht != null;
  const devise = quote.devise ?? BASE_CURRENCY;
  const money = (n: number | null | undefined) => formatAmount(n, devise);
  const totals = computeQuoteTotals(lines, remisePct, tvaRate, acomptePct, devise);
  const livraison = quote.date_livraison_prevue
    ? `Le ${formatDate(quote.date_livraison_prevue)}`
    : delaiLabel(quote.delai_valeur, quote.delai_unite, quote.delai_depart);
  const terms: [string, string | null | undefined][] = [
    ["Objet", quote.objet],
    ["Référence client", quote.reference_client],
    ["Mode de règlement", quote.mode_reglement],
    ["Conditions de paiement", quote.conditions_paiement],
    ["Acompte à la commande", acomptePct > 0 ? `${acomptePct} % — ${money(totals.acompte)}` : null],
    ["Livraison", livraison],
    ["Devise", devise !== BASE_CURRENCY ? `${devise} — 1 ${devise} = ${quote.taux_change} F CFA` : null],
    ["Exonération de TVA", tvaRate === 0 && detailed ? quote.tva_exoneration_motif : null],
    ["Remarques", quote.notes],
  ];

  const pendingValidation = quote.status === "en_validation_interne";

  return (
    <div className="space-y-6">
      {pendingValidation && editable && <ValidateQuoteCard quoteId={quote.id} canValidate={canValidate} validators={validators} />}
      {quote.status === "brouillon" && quote.rejet_motif && editable && (
        <Card className="border-danger/30 bg-danger-soft/40">
          <CardBody className="text-sm">
            <p className="font-medium text-foreground">Renvoyé par le validateur{quote.rejet_at ? ` le ${formatDate(quote.rejet_at)}` : ""}</p>
            <p className="text-foreground-muted">{quote.rejet_motif}</p>
            <Link href={`/commercial/demandes/${quote.request_id}`} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
              Corriger et resoumettre depuis la demande →
            </Link>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader
          title={quote.reference}
          description={companyName}
          action={
            <div className="flex items-center gap-2">
              <a
                href={`/api/devis/${quote.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted"
              >
                <FileDown className="h-3.5 w-3.5" /> Proforma PDF
              </a>
              <StatusBadge status={quote.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
            </div>
          }
        />
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Qté</th>
                <th className="px-5 py-3 font-medium">{detailed ? "PU HT" : "PU"}</th>
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
                    {l.product_model_id && (
                      <QuoteLineDispatch
                        quoteId={quote.id}
                        quoteLineId={l.id}
                        sizes={sizeOptionsByModel[l.product_model_id] ?? []}
                        initial={l.sizes ?? {}}
                        prices={l.size_prices ?? {}}
                        devise={devise}
                        remisePct={Number(l.remise_pct ?? 0)}
                        quantity={l.quantity}
                        // Ajustable une fois le devis envoyé, avant acceptation (client, ou commercial à sa demande).
                        editable={canAccept && quote.status === "envoye"}
                      />
                    )}
                    {l.printable_zones && l.printable_zones.length > 0 && (
                      <p className="mt-1 text-xs text-foreground-muted">
                        <span className="font-medium text-foreground">Impressions :</span>{" "}
                        {l.printable_zones.map((z) => printableZoneLabel(z.zone_label ?? "Emplacement", z.nb_couleurs)).join(" · ")}
                      </p>
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
                    <div className="mt-3 space-y-1.5">
                      <QuoteLineSamplePicker
                        quoteLineId={l.id}
                        samples={samples}
                        editable={editable}
                        locked={quote.status === "accepte"}
                      />
                      {editable && sampleCreation && (
                        <CreateSampleDialog
                          triggerLabel="Créer un échantillon pour cet article"
                          triggerVariant="secondary"
                          fixedRequest={{
                            id: quote.request_id,
                            reference: sampleCreation.requestReference,
                            companyName: companyName ?? "",
                          }}
                          fixedQuoteLine={{ id: l.id, label: `${quote.reference} — ${l.description}` }}
                          quoteLines={sampleCreation.quoteLineOptions}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">{l.quantity}</td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {money(l.unit_price)}
                    {hasSizePrices(l) && <span className="block text-[11px] text-foreground-muted">moyen, selon taille</span>}
                    {Number(l.remise_pct ?? 0) > 0 && <span className="block text-xs">remise {l.remise_pct} %</span>}
                  </td>
                  <td className="px-5 py-3 font-medium text-foreground">{money(lineNet(l, devise))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {detailed ? (
                <>
                  <TotalRow label="Total brut HT" value={money(totals.brut)} />
                  {totals.remiseLignes > 0 && <TotalRow label="Remises de lignes" value={`- ${money(totals.remiseLignes)}`} />}
                  {totals.remise > 0 && <TotalRow label={`Remise globale ${remisePct} %`} value={`- ${money(totals.remise)}`} />}
                  <TotalRow label="Total HT" value={money(quote.total_ht)} />
                  <TotalRow label={tvaRate > 0 ? `TVA ${tvaRate} %` : "TVA"} value={tvaRate > 0 ? money(quote.total_tva) : "Exonéré"} />
                  <TotalRow label="Total TTC" value={money(quote.total_amount)} strong />
                </>
              ) : (
                <TotalRow label="Total" value={money(quote.total_amount)} strong />
              )}
            </tfoot>
          </table>
        </CardBody>
      </Card>

      {detailed && (
        <Card>
          <CardBody className="space-y-3 text-sm">
            <p className="text-foreground-muted">
              <span className="font-medium text-foreground">Arrêté à la somme de :</span> {amountInWordsFr(quote.total_amount, devise)}
              {tvaRate > 0 ? " toutes taxes comprises" : ""}.
            </p>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {terms
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-foreground-muted">{label}</dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
            </dl>
          </CardBody>
        </Card>
      )}

      <p className="text-xs text-foreground-muted">
        {[
          quote.valid_until ? `Valable jusqu'au ${formatDate(quote.valid_until)}` : null,
          editable && quote.sage_piece ? `Devis Sage ${quote.sage_piece}` : null,
          validatedBy && quote.validated_at ? `Validé en interne par ${validatedBy} le ${formatDate(quote.validated_at)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
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

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr className={strong ? "border-t border-border" : undefined}>
      <td colSpan={3} className={`px-5 py-2 text-right text-sm ${strong ? "font-semibold text-foreground" : "text-foreground-muted"}`}>
        {label}
      </td>
      <td className={`px-5 py-2 text-sm ${strong ? "font-semibold text-foreground" : "text-foreground-muted"}`}>{value}</td>
    </tr>
  );
}
