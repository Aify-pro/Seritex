import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { QUOTE_STATUS_LABELS, REQUEST_STATUS_LABELS, SAMPLE_STATUS_LABELS } from "@/lib/types/domain";
import { notFound } from "next/navigation";
import { StatusSelect } from "./status-select";
import { MessageThread, type Message } from "./message-thread";
import { QuoteForm, type QuoteCorrection } from "./quote-form";
import { SageQuotesPanel } from "@/components/quotes/sage-quotes-panel";
import { getSagePrefill, getSageQuotesForClient, getSageQuotesLastSync, searchSageQuotesByNumber } from "@/lib/sage-quotes";
import { postMessage } from "@/lib/actions/requests";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { CreateSampleDialog } from "@/components/samples/create-sample-dialog";
import { getSampleQuoteLineOptions } from "@/lib/samples";
import { getCompanySettings } from "@/lib/company-settings";
import { getDispatchRules, getSizeOptionsByModel } from "@/lib/quote-dispatch";
import { colorAlertsByModel, getArticleAvailability } from "@/lib/articles/availability";
import { StockRequestDetail } from "./stock-request-detail";
import { SiteRequestDetail, type SiteProspect } from "./site-request-detail";
import type { RequestArticleLine } from "@/lib/requests/articles";

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `sage` : n° d'un devis Sage à récupérer (préremplit le devis) ; `sage_q` : recherche par numéro (migration 0071). */
  searchParams: Promise<{ sage?: string; sage_q?: string }>;
}) {
  const { authId, profile } = await requireModule("demandes");
  const { id } = await params;
  const { sage: sageParam, sage_q: sageQuery } = await searchParams;
  const supabase = await createClient();

  const { data: request } = await supabase
    .from("requests")
    .select("*,companies(id,name,email,phone,address,postal_code,city,country,ncc,rccm,sage_code),contacts(first_name,last_name,email)")
    .eq("id", id)
    .single();

  if (!request) notFound();

  // Demande du site web pas encore rattachée à un client (migration 0098).
  if (!request.company_id && request.prospect) {
    if (profile.role === "responsable_production") notFound();
    return (
      <SiteRequestDetail
        request={{
          id: request.id,
          reference: request.reference,
          status: request.status,
          description: request.description,
          created_at: request.created_at,
          prospect: request.prospect as SiteProspect,
        }}
        canLink={profile.role === "commercial" || profile.role === "administrateur"}
      />
    );
  }

  // Demande pour le stock (sans client, SF-3) : sa propre fiche, sans devis.
  if (!request.company_id) {
    const { data: odfs } = await supabase
      .from("production_orders")
      .select("id,reference,status")
      .eq("request_id", id)
      .neq("status", "annulee")
      .limit(1);
    return (
      <StockRequestDetail
        request={{
          id: request.id,
          reference: request.reference,
          status: request.status,
          description: request.description,
          created_at: request.created_at,
          lignes: (request.lignes_stock ?? []) as { description: string; tailles: Record<string, number> }[],
          odf: odfs?.[0] ? { id: odfs[0].id as string, reference: odfs[0].reference as string } : null,
        }}
        canCreateOdf={profile.role === "administrateur" || profile.role === "responsable_production"}
      />
    );
  }
  // La production n'ouvre que les demandes pour le stock.
  if (profile.role === "responsable_production") notFound();

  const [
    { data: messages },
    { data: quotes },
    { data: products },
    { data: zoneTemplates },
    { data: colors },
    { data: samples },
    quoteLines,
    companySettings,
    { data: paymentTerms },
    { data: currencies },
    { data: printableZones },
  ] =
    await Promise.all([
      supabase
        .from("messages")
        .select("id,body,created_at,sender_id,app_users(full_name)")
        .eq("request_id", id)
        .order("created_at", { ascending: true }),
      // Les devis renvoyés par la Direction (brouillon, migration 0064) sont
      // chargés au complet : ils se corrigent ici, avec le même formulaire.
      supabase
        .from("quotes")
        .select(
          "*,quote_lines(id,product_model_id,textile_id,description,quantity,unit_price,remise_pct,couleur_unique_id,quote_line_zone_colors(zone_key,color_id),quote_line_printable_zones(printable_zone_id,nb_couleurs),quote_line_sizes(taille,quantite),quote_line_size_prices(taille,prix,source))"
        )
        .eq("request_id", id),
      supabase
        .from("product_models")
        .select("id,name,base_price,textile_id,textiles!product_models_textile_id_fkey(id,nom,grammage),product_model_textiles(textile_id,textiles(id,nom,grammage))")
        .eq("active", true)
        // Produits finis : les autres articles n'ont pas encore leur circuit de vente.
        .eq("nature", "pf"),
      // Gabarits de zones de tous les modèles — nécessaire au sélecteur de
      // couleur du devis (chantier config-produit-devis) dès qu'une ligne
      // choisit un modèle, sans aller-retour supplémentaire par ligne.
      supabase.from("product_zone_templates").select("product_model_id,zone_key,zone_label,display_order"),
      supabase.from("colors").select("id,name,code,hex").eq("active", true).order("name"),
      // Fiches échantillon rattachées à cette demande (migration 0051).
      supabase
        .from("sample_requests")
        .select("id,sample_number,need_description,status,quote_line_id")
        .eq("request_id", id)
        .order("created_at", { ascending: false }),
      getSampleQuoteLineOptions([id]),
      getCompanySettings(),
      supabase.from("payment_terms").select("label,is_default").eq("active", true).order("display_order"),
      supabase.from("currencies").select("code,label,rate_xof").eq("active", true).order("display_order"),
      // Emplacements imprimables de tous les modèles — impressions de chaque ligne (migration 0065).
      supabase.from("product_printable_zones").select("id,product_model_id,zone_label,display_order"),
    ]);

  const zoneTemplatesByModel = (zoneTemplates ?? []).reduce<Record<string, { zone_key: string; zone_label: string; display_order: number }[]>>(
    (acc, z) => {
      (acc[z.product_model_id] ??= []).push({ zone_key: z.zone_key, zone_label: z.zone_label, display_order: z.display_order });
      return acc;
    },
    {}
  );

  const corrections = new Map<string, { motif: string | null; correction: QuoteCorrection }>();
  for (const q of quotes ?? []) {
    if (q.status !== "brouillon") continue;
    const lines = (q.quote_lines ?? []) as unknown as {
      id: string;
      product_model_id: string | null;
      textile_id: string | null;
      description: string;
      quantity: number;
      unit_price: number;
      remise_pct: number | null;
      couleur_unique_id: string | null;
      quote_line_zone_colors: { zone_key: string; color_id: string }[] | null;
      quote_line_printable_zones: { printable_zone_id: string; nb_couleurs: number }[] | null;
      quote_line_sizes: { taille: string; quantite: number }[] | null;
      quote_line_size_prices: { taille: string; prix: number; source: "client" | "grille" | "saisie" }[] | null;
    }[];
    corrections.set(q.id, {
      motif: q.rejet_motif ?? null,
      correction: {
        quoteId: q.id,
        reference: q.reference,
        lines: lines.map((l) => ({
          id: l.id,
          productModelId: l.product_model_id,
          textileId: l.textile_id,
          description: l.description,
          quantity: l.quantity,
          unitPrice: Number(l.unit_price),
          remisePct: Number(l.remise_pct ?? 0),
          couleurUniqueId: l.couleur_unique_id,
          zoneColors: Object.fromEntries((l.quote_line_zone_colors ?? []).map((z) => [z.zone_key, z.color_id])),
          printZones: Object.fromEntries((l.quote_line_printable_zones ?? []).map((z) => [z.printable_zone_id, z.nb_couleurs])),
          sizes: Object.fromEntries((l.quote_line_sizes ?? []).map((z) => [z.taille, z.quantite])),
          sizePrices: Object.fromEntries((l.quote_line_size_prices ?? []).map((z) => [z.taille, Number(z.prix)])),
          sizePriceSources: Object.fromEntries((l.quote_line_size_prices ?? []).map((z) => [z.taille, z.source])),
        })),
        terms: {
          objet: q.objet ?? "",
          referenceClient: q.reference_client ?? "",
          remisePct: String(q.remise_pct ?? 0),
          tvaRate: String(q.tva_rate ?? 0),
          tvaExonerationMotif: q.tva_exoneration_motif ?? "",
          modeReglement: q.mode_reglement ?? "",
          conditionsPaiement: q.conditions_paiement ?? "",
          acomptePct: String(q.acompte_pct ?? 0),
          devise: q.devise ?? "XOF",
          tauxChange: String(q.taux_change ?? 1),
          livraisonMode: q.date_livraison_prevue ? "date" : "delai",
          delaiValeur: q.delai_valeur != null ? String(q.delai_valeur) : "",
          delaiUnite: q.delai_unite ?? "semaines",
          delaiDepart: q.delai_depart ?? "commande",
          dateLivraison: q.date_livraison_prevue ?? "",
          notes: q.notes ?? "",
          validUntil: q.valid_until ?? "",
        },
      },
    });
  }

  // Dispatching (migration 0066) : tailles proposables par modèle et règle de répartition.
  const [sizeOptionsByModel, dispatchRules, availability] = await Promise.all([
    getSizeOptionsByModel((products ?? []).map((pm) => pm.id as string)),
    getDispatchRules(),
    getArticleAvailability((products ?? []).map((pm) => pm.id as string)),
  ]);
  // Signalement seulement : un devis reste possible même si le tissu manque (réapprovisionnement local, marchandise en route).
  const colorAlerts = colorAlertsByModel(availability);

  const printableZonesByModel = (printableZones ?? []).reduce<Record<string, { id: string; zone_label: string; display_order: number }[]>>((acc, z) => {
    (acc[z.product_model_id] ??= []).push({ id: z.id, zone_label: z.zone_label, display_order: z.display_order });
    return acc;
  }, {});

  const company = request.companies as unknown as {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    ncc: string | null;
    rccm: string | null;
  };
  const contact = request.contacts as unknown as { first_name: string; last_name: string; email: string } | null;

  const requestArticles = ((request.lignes_stock ?? []) as RequestArticleLine[]).filter((l) => l.product_model_id);
  const quoteFormProps = {
    requestId: request.id,
    companyId: company.id,
    // Grammages autorisés (ART-D) : le principal du modèle d'abord, puis par grammage.
    products: (products ?? []).map((pm) => ({
      id: pm.id as string,
      name: pm.name as string,
      base_price: pm.base_price as number | null,
      // Textiles autorisés ; à défaut, le textile principal du modèle.
      textiles: [
        ...((pm.product_model_textiles ?? []) as unknown as { textiles: { id: string; nom: string; grammage: number | null } | null }[]).map((t) => t.textiles),
        ...((pm.product_model_textiles ?? []).length === 0 ? [pm.textiles as unknown as { id: string; nom: string; grammage: number | null } | null] : []),
      ]
        .filter((t): t is { id: string; nom: string; grammage: number | null } => !!t)
        .sort((x, y) => Number(y.id === pm.textile_id) - Number(x.id === pm.textile_id) || (x.grammage ?? 0) - (y.grammage ?? 0))
        .map((t) => ({ id: t.id, nom: t.nom })),
    })),
    zoneTemplatesByModel,
    printableZonesByModel,
    sizeOptionsByModel,
    colorAlerts,
    dispatchRules,
    colors: colors ?? [],
    defaults: {
      tvaRate: companySettings?.assujetti_tva === false ? 0 : (companySettings?.tva_taux_defaut ?? 18),
      validiteJours: companySettings?.validite_devis_jours ?? 30,
      acomptePct: companySettings?.acompte_pct_defaut ?? 0,
    },
    paymentTerms: paymentTerms ?? [],
    currencies: currencies ?? [],
    // Articles choisis dans la demande : lignes de départ du devis.
    requestLines: requestArticles,
    client: {
      name: company.name,
      address: company.address ?? null,
      postalCode: company.postal_code ?? null,
      city: company.city ?? null,
      country: company.country ?? null,
      phone: company.phone ?? null,
      email: company.email ?? null,
      ncc: company.ncc ?? null,
      rccm: company.rccm ?? null,
      contactName: contact ? `${contact.first_name} ${contact.last_name}` : null,
      contactEmail: contact?.email ?? null,
    },
  };

  // Devis Sage en cours du client (migration 0071) : liste, recherche par numéro
  // et, si `?sage=` est présent, préremplissage du formulaire de devis.
  const sageCode = (request.companies as unknown as { sage_code: string | null } | null)?.sage_code ?? null;
  const [sageList, sageSearch, sageLastSync, sagePrefillResult] = await Promise.all([
    sageCode ? getSageQuotesForClient(sageCode) : Promise.resolve({ quotes: [], total: 0 }),
    sageQuery ? searchSageQuotesByNumber(sageQuery, sageCode) : Promise.resolve(null),
    getSageQuotesLastSync(),
    sageParam ? getSagePrefill(sageParam.trim(), sageCode) : Promise.resolve(null),
  ]);
  const sagePrefill = sagePrefillResult && "prefill" in sagePrefillResult ? sagePrefillResult.prefill : undefined;
  const sagePrefillError = sagePrefillResult && "error" in sagePrefillResult ? sagePrefillResult.error : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={request.reference}
        description={company?.name}
        action={<StatusSelect requestId={request.id} current={request.status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Description du besoin" />
            <CardBody>
              <p className="text-sm text-foreground">{request.description}</p>
              {request.needs_graphics && (
                <p className="mt-3 text-xs text-accent">🎨 Nécessite une intervention graphique</p>
              )}
              {requestArticles.length > 0 && (
                <div className="mt-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Articles demandés</p>
                  <ul className="space-y-0.5 text-sm">
                    {requestArticles.map((l, i) => {
                      const total = Object.values(l.tailles ?? {}).reduce((a, b) => a + b, 0) || l.quantite || 0;
                      const couleur = colors?.find((c) => c.id === l.couleur_unique_id)?.name;
                      return (
                        <li key={i}>
                          {l.description}
                          {couleur && <span className="text-xs text-foreground-muted"> · {couleur}</span>}
                          {total > 0 && <span className="text-xs text-foreground-muted"> · {total} pièce(s)</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-foreground-muted">Ces détails sont facultatifs : ils sont repris comme lignes de départ du devis (quantité, couleur, répartition par taille).</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Devis" description="Historique et création de devis pour cette demande" />
            <CardBody className="space-y-3">
              {quotes && quotes.length > 0 && (
                <ul className="space-y-2">
                  {quotes.map((q) => {
                    const toCorrect = corrections.get(q.id);
                    return (
                      <li key={q.id} className="space-y-3 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <Link href={`/commercial/devis/${q.id}`} className="text-sm font-medium text-foreground hover:text-brand">
                              {q.reference}
                            </Link>
                            <p className="text-xs text-foreground-muted">
                              {formatDate(q.created_at)}
                              {q.sage_piece ? ` · Devis Sage ${q.sage_piece}` : ""}
                            </p>
                          </div>
                          <StatusBadge status={q.status} labels={QUOTE_STATUS_LABELS} kind="quote" />
                        </div>
                        {toCorrect && (
                          <div className="space-y-2">
                            {toCorrect.motif && (
                              <p className="rounded-md bg-danger-soft/40 px-3 py-2 text-sm text-foreground">
                                <span className="font-medium">Renvoyé par la Direction :</span> {toCorrect.motif}
                              </p>
                            )}
                            <QuoteForm {...quoteFormProps} correction={toCorrect.correction} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <SageQuotesPanel
                requestId={request.id}
                hasSageCode={!!sageCode}
                quotes={sageList.quotes}
                total={sageList.total}
                searchQuery={sageQuery ?? ""}
                searchResults={sageSearch}
                lastSync={sageLastSync}
                prefillError={sagePrefillError}
              />
              {/* key : changer de devis Sage remonte un formulaire neuf (état initial = préremplissage). */}
              <QuoteForm key={sagePrefill?.sagePiece ?? "nouveau"} {...quoteFormProps} prefill={sagePrefill} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Échantillons"
              description="Un modèle par fiche, fabriqué en un exemplaire — lien facultatif à une ligne de devis"
              action={
                <CreateSampleDialog
                  fixedRequest={{ id: request.id, reference: request.reference, companyName: company?.name ?? "" }}
                  quoteLines={quoteLines}
                />
              }
            />
            <CardBody>
              {samples && samples.length > 0 ? (
                <ul className="space-y-2">
                  {samples.map((sr) => {
                    const line = quoteLines.find((l) => l.id === sr.quote_line_id);
                    return (
                      <li key={sr.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                        <div className="min-w-0">
                          <Link href={`/echantillons/${sr.sample_number}`} className="font-mono text-sm font-medium text-foreground hover:text-brand">
                            {sr.sample_number}
                          </Link>
                          <p className="truncate text-xs text-foreground-muted" title={sr.need_description}>
                            {sr.need_description}
                          </p>
                          {line && (
                            <p className="text-xs text-foreground-muted">
                              Ligne {line.quoteReference} — {line.description}
                              {line.orderLine ? ` · ${line.orderLine.orderReference}` : ""}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={sr.status} labels={SAMPLE_STATUS_LABELS} kind="sample" />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-foreground-muted">Aucun échantillon rattaché à cette demande.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Échanges" />
            <MessageThread
              messages={(messages ?? []) as unknown as Message[]}
              currentUserId={authId}
              action={postMessage.bind(null, request.id)}
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Client" />
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium text-foreground">{company?.name}</p>
              {contact && (
                <p className="text-foreground-muted">
                  {contact.first_name} {contact.last_name}
                </p>
              )}
              <p className="text-foreground-muted">{company?.email}</p>
              <p className="text-foreground-muted">{company?.phone}</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Statut" />
            <CardBody>
              <StatusBadge status={request.status} labels={REQUEST_STATUS_LABELS} kind="request" />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
