"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQuote, resubmitQuote, type QuoteLineInput } from "../../actions";
import { useRouter } from "next/navigation";
import { ZoneColorPicker, EMPTY_ZONE_COLOR_DRAFT, type ZoneColorDraft } from "@/components/product/zone-color-picker";
import { computeQuoteTotals, lineNet } from "@/lib/quote-totals";
import { BASE_CURRENCY, currencyDecimals, formatMoney } from "@/lib/currency";
import { DELAI_DEPARTS, DELAI_UNITES } from "@/lib/delivery";
import type { DelaiDepart, DelaiUnite } from "@/lib/types/domain";
import { MapPin, Phone, Mail, User } from "lucide-react";
import { DispatchEditor, type SizeOption } from "@/components/quotes/dispatch-editor";
import { generateDispatch, pickRule, type Dispatch, type DispatchRule } from "@/lib/dispatching";
import { averageUnitPrice } from "@/lib/quote-totals";
import { LinePricesEditor, type PriceSource } from "./line-prices-editor";

type ProductModel = { id: string; name: string; base_price: number | null };
type ZoneTemplate = { zone_key: string; zone_label: string; display_order: number };
type ColorOption = { id: string; name: string; code: string };
/** Emplacement imprimable d'un modèle (Paramètres > Produits, migration 0039). */
export type PrintableZoneOption = { id: string; zone_label: string; display_order: number };

/** Nombre de couleurs proposé par impression — même plafond que la contrainte de 0065. */
const NB_COULEURS_MAX = 12;

type LineDraft = {
  /** Identité côté client (clé React / suppression) — jamais envoyée au serveur. */
  key: string;
  /** Ligne déjà enregistrée (correction d'un devis renvoyé) — conservée telle quelle côté serveur. */
  id?: string;
  productModelId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  remisePct: string;
  colorDraft: ZoneColorDraft;
  /** Impressions retenues : emplacement → nombre de couleurs (migration 0065). */
  printZones: Record<string, number>;
  /** Répartition par taille (migration 0066). */
  sizes: Dispatch;
  /** Vrai tant que la répartition est celle proposée par la règle : elle suit alors la quantité. */
  sizesAuto: boolean;
  /** Prix par taille (migration 0068), saisis en texte ; leur provenance ; suivent-ils la proposition ? */
  sizePrices: Record<string, string>;
  sizePriceSources: Record<string, PriceSource>;
  pricesAuto: boolean;
};

/** Valeurs par défaut des mentions de proforma, issues de Paramètres > Informations société (migration 0061). */
export type QuoteDefaults = {
  tvaRate: number;
  validiteJours: number;
  acomptePct: number;
};

/** Identité du client affichée avant les articles (fiche entreprise + contact de la demande). */
export type QuoteClientInfo = {
  name: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  ncc: string | null;
  rccm: string | null;
  contactName: string | null;
  contactEmail: string | null;
};

type PaymentTermOption = { label: string; is_default: boolean };
type CurrencyOption = { code: string; label: string; rate_xof: number | null };

const EXPORT_MOTIF = "Vente à l'exportation — exonérée de TVA";

export type TermsDraft = {
  objet: string;
  referenceClient: string;
  remisePct: string;
  tvaRate: string;
  tvaExonerationMotif: string;
  modeReglement: string;
  conditionsPaiement: string;
  acomptePct: string;
  devise: string;
  tauxChange: string;
  /** Livraison : un délai normalisé OU une date ferme. */
  livraisonMode: "delai" | "date";
  delaiValeur: string;
  delaiUnite: DelaiUnite;
  delaiDepart: DelaiDepart;
  dateLivraison: string;
  notes: string;
  validUntil: string;
};

const MODES_REGLEMENT = ["Virement bancaire", "Chèque", "Espèces", "Mobile money", "Traite / effet"];

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function newTerms(defaults: QuoteDefaults, paymentTerms: PaymentTermOption[]): TermsDraft {
  return {
    objet: "",
    referenceClient: "",
    remisePct: "0",
    tvaRate: String(defaults.tvaRate),
    tvaExonerationMotif: "",
    modeReglement: "",
    conditionsPaiement: (paymentTerms.find((t) => t.is_default) ?? paymentTerms[0])?.label ?? "",
    acomptePct: String(defaults.acomptePct),
    devise: BASE_CURRENCY,
    tauxChange: "1",
    livraisonMode: "delai",
    delaiValeur: "",
    delaiUnite: "semaines",
    delaiDepart: "commande",
    dateLivraison: "",
    notes: "",
    validUntil: addDays(defaults.validiteJours),
  };
}

/** Ligne d'un devis renvoyé, telle qu'enregistrée — point de départ de la correction. */
export type CorrectionLine = {
  id: string;
  productModelId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  remisePct: number;
  couleurUniqueId: string | null;
  zoneColors: Record<string, string>;
  printZones: Record<string, number>;
  sizes: Dispatch;
  sizePrices: Record<string, number>;
  sizePriceSources: Record<string, PriceSource>;
};

/** Devis renvoyé par la Direction, à corriger puis resoumettre (migration 0064). */
export type QuoteCorrection = {
  quoteId: string;
  reference: string;
  lines: CorrectionLine[];
  terms: TermsDraft;
};

function lineFromCorrection(l: CorrectionLine): LineDraft {
  return {
    key: l.id,
    id: l.id,
    productModelId: l.productModelId ?? "",
    description: l.description,
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
    remisePct: String(l.remisePct),
    colorDraft: l.couleurUniqueId
      ? { isUni: true, couleurUniqueId: l.couleurUniqueId, zoneColors: {} }
      : { isUni: false, couleurUniqueId: null, zoneColors: l.zoneColors },
    printZones: l.printZones,
    sizes: l.sizes,
    sizesAuto: false,
    sizePrices: Object.fromEntries(Object.entries(l.sizePrices).map(([k, v]) => [k, String(v)])),
    sizePriceSources: l.sizePriceSources,
    pricesAuto: false,
  };
}

/** Prix saisis en texte → nombres valides (virgule décimale acceptée). */
function numericPrices(prices: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cle, v] of Object.entries(prices)) {
    const n = Number(String(v).replace(",", "."));
    if (String(v).trim() !== "" && Number.isFinite(n) && n >= 0) out[cle] = n;
  }
  return out;
}

function newLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    productModelId: "",
    description: "",
    quantity: "",
    unitPrice: "",
    remisePct: "0",
    colorDraft: EMPTY_ZONE_COLOR_DRAFT,
    printZones: {},
    sizes: {},
    sizesAuto: true,
    sizePrices: {},
    sizePriceSources: {},
    pricesAuto: true,
  };
}

/**
 * Devis à plusieurs articles (`quote_lines` est une vraie table enfant
 * depuis le schéma initial — seule l'UI n'en exposait qu'un). Chaque ligne
 * porte, en plus de la description/quantité/prix, le choix du modèle et de
 * sa couleur (par zone, ou « modèle uni ») : c'est cette configuration —
 * la « maquette », au sens déjà acté au lot 9 — que le client valide en
 * acceptant le devis (`QuoteDetail`/`AcceptQuoteButton`), avant que
 * `accept_quote()` ne l'hérite dans l'ODF (migration 0034, uniquement pour
 * un devis à une seule ligne — au-delà, à reconfigurer sur l'écran ODF).
 */
export function QuoteForm({
  requestId,
  companyId,
  client,
  products,
  zoneTemplatesByModel,
  printableZonesByModel,
  sizeOptionsByModel,
  dispatchRules,
  colors,
  defaults,
  paymentTerms,
  currencies,
  correction,
}: {
  requestId: string;
  companyId: string;
  client: QuoteClientInfo;
  products: ProductModel[];
  /** Gabarit de zones par modèle de produit — nécessaire au ZoneColorPicker dès qu'une ligne choisit un modèle. */
  zoneTemplatesByModel: Record<string, ZoneTemplate[]>;
  /** Emplacements imprimables par modèle — choix des impressions de chaque ligne (migration 0065). */
  printableZonesByModel: Record<string, PrintableZoneOption[]>;
  /** Tailles proposables par modèle et règle de dispatching (migration 0066). */
  sizeOptionsByModel: Record<string, SizeOption[]>;
  dispatchRules: DispatchRule[];
  colors: ColorOption[];
  defaults: QuoteDefaults;
  paymentTerms: PaymentTermOption[];
  currencies: CurrencyOption[];
  /** Présent : le formulaire corrige ce devis renvoyé au lieu d'en créer un. */
  correction?: QuoteCorrection;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [terms, setTerms] = useState<TermsDraft>(() => newTerms(defaults, paymentTerms));
  const router = useRouter();

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setLines(correction ? correction.lines.map(lineFromCorrection) : [newLine()]);
          setTerms(correction ? correction.terms : newTerms(defaults, paymentTerms));
          setOpen(true);
        }}
      >
        {correction ? `Corriger ${correction.reference} et resoumettre` : "Établir un devis"}
      </Button>
    );
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** Ligne sous la forme du calcul des montants : chiffrée par taille pour un article de catalogue. */
  function totalsLine(l: LineDraft) {
    const priced = !!l.productModelId;
    return {
      quantity: Number(l.quantity) || 0,
      unit_price: Number(l.unitPrice) || 0,
      remise_pct: Number(l.remisePct) || 0,
      sizes: priced ? l.sizes : undefined,
      size_prices: priced ? numericPrices(l.sizePrices) : undefined,
    };
  }

  /** Répartition proposée par la règle (Paramètres > Dispatching) pour un modèle, un groupe et une quantité. */
  function proposeSizes(productModelId: string, quantity: number, groupe?: string): Dispatch {
    const options = sizeOptionsByModel[productModelId] ?? [];
    const g = groupe ?? options[0]?.groupe;
    if (!g) return {};
    const rule = pickRule(dispatchRules, g, quantity);
    if (!rule) return {};
    return generateDispatch(
      quantity,
      rule,
      options.filter((o) => o.groupe === g).map((o) => o.cle)
    );
  }

  /** Groupe de la répartition en cours, pour la recalculer dans le même groupe. */
  function groupeOf(line: LineDraft): string | undefined {
    return (sizeOptionsByModel[line.productModelId] ?? []).find((o) => (line.sizes[o.cle] ?? 0) > 0)?.groupe;
  }

  function changeQuantity(line: LineDraft, value: string) {
    const q = Number(value);
    const patch: Partial<LineDraft> = { quantity: value };
    if (line.sizesAuto && line.productModelId && Number.isInteger(q) && q > 0) {
      patch.sizes = proposeSizes(line.productModelId, q, groupeOf(line));
    }
    updateLine(line.key, patch);
  }

  function chooseProduct(key: string, productModelId: string) {
    const opt = products.find((p) => p.id === productModelId);
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              productModelId,
              unitPrice: l.unitPrice || String(opt?.base_price ?? ""),
              description: l.description || opt?.name || "",
              // Le gabarit de zones change avec le modèle — repartir d'une
              // configuration couleur vide plutôt que de laisser des zones
              // d'un autre modèle.
              colorDraft: EMPTY_ZONE_COLOR_DRAFT,
              // Les emplacements imprimables sont propres au modèle.
              printZones: {},
              // Les tailles aussi : nouvelle proposition selon la règle.
              sizes: productModelId && Number(l.quantity) > 0 ? proposeSizes(productModelId, Number(l.quantity)) : {},
              sizesAuto: true,
              // Prix propres au modèle : nouvelle proposition.
              sizePrices: {},
              sizePriceSources: {},
              pricesAuto: true,
            }
          : l
      )
    );
  }

  function updateTerms(patch: Partial<TermsDraft>) {
    setTerms((prev) => ({ ...prev, ...patch }));
  }

  const isBase = terms.devise === BASE_CURRENCY;
  const decimals = currencyDecimals(terms.devise);
  const totals = computeQuoteTotals(
    lines.map(totalsLine),
    Number(terms.remisePct) || 0,
    Number(terms.tvaRate) || 0,
    Number(terms.acomptePct) || 0,
    terms.devise
  );
  const money = (n: number) => formatMoney(n, terms.devise);

  /** Changer de devise reprend le taux des paramètres ; une vente hors F CFA est en principe un export (TVA 0). */
  function chooseCurrency(code: string) {
    const cur = currencies.find((c) => c.code === code);
    setTerms((prev) => {
      const toBase = code === BASE_CURRENCY;
      const wasExport = prev.tvaExonerationMotif === EXPORT_MOTIF;
      return {
        ...prev,
        devise: code,
        tauxChange: toBase ? "1" : String(cur?.rate_xof ?? ""),
        tvaRate: toBase ? (wasExport ? String(defaults.tvaRate) : prev.tvaRate) : "0",
        tvaExonerationMotif: toBase ? (wasExport ? "" : prev.tvaExonerationMotif) : prev.tvaExonerationMotif || EXPORT_MOTIF,
      };
    });
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function submit() {
    const payload: QuoteLineInput[] = lines.map((l) => {
      const zoneTemplate = zoneTemplatesByModel[l.productModelId] ?? [];
      const uni = l.colorDraft.isUni || zoneTemplate.length === 0;
      return {
        id: l.id ?? null,
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: l.productModelId ? averageUnitPrice(totalsLine(l)) : Number(l.unitPrice),
        remise_pct: Number(l.remisePct) || 0,
        product_model_id: l.productModelId || null,
        couleur_unique_id: uni ? l.colorDraft.couleurUniqueId : null,
        zone_colors: uni
          ? []
          : Object.entries(l.colorDraft.zoneColors)
              .filter(([, colorId]) => !!colorId)
              .map(([zone_key, color_id]) => ({ zone_key, color_id })),
        printable_zones: l.productModelId
          ? Object.entries(l.printZones).map(([printable_zone_id, nb_couleurs]) => ({ printable_zone_id, nb_couleurs }))
          : [],
        sizes: l.productModelId ? l.sizes : {},
        size_prices: l.productModelId ? numericPrices(l.sizePrices) : {},
        size_price_sources: l.productModelId ? l.sizePriceSources : {},
      };
    });

    startTransition(async () => {
      const delai = terms.livraisonMode === "delai" && terms.delaiValeur !== "";
      const dateLivraison = terms.livraisonMode === "date" ? terms.dateLivraison || null : null;
      const termsInput = {
        objet: terms.objet,
        reference_client: terms.referenceClient,
        remise_pct: Number(terms.remisePct) || 0,
        tva_rate: Number(terms.tvaRate) || 0,
        tva_exoneration_motif: terms.tvaExonerationMotif,
        mode_reglement: terms.modeReglement,
        conditions_paiement: terms.conditionsPaiement,
        acompte_pct: Number(terms.acomptePct) || 0,
        devise: terms.devise,
        taux_change: Number(terms.tauxChange) || 1,
        delai_valeur: delai ? Number(terms.delaiValeur) : null,
        delai_unite: delai ? terms.delaiUnite : null,
        delai_depart: delai ? terms.delaiDepart : null,
        notes: terms.notes,
        valid_until: terms.validUntil || null,
      };
      const res = correction
        ? await resubmitQuote(correction.quoteId, payload, dateLivraison, termsInput)
        : await createQuote(requestId, companyId, payload, dateLivraison, termsInput);
      if (res.error) toast.error(res.error);
      else {
        toast.success(correction ? "Devis corrigé — resoumis à la validation interne" : "Devis créé — en attente de validation interne");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-4">
      <div className="space-y-2 rounded-md border border-border bg-surface p-3">
        <p className="text-xs font-medium text-foreground-muted">Client</p>
        <p className="text-sm font-semibold text-foreground">{client.name}</p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-foreground-muted sm:grid-cols-2">
          <p className="flex items-start gap-2 sm:col-span-2">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {[client.address, [client.postalCode, client.city].filter(Boolean).join(" "), client.country].filter(Boolean).join(", ") || "Adresse non renseignée"}
          </p>
          {client.contactName && (
            <p className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 shrink-0" /> {client.contactName}
            </p>
          )}
          {(client.contactEmail ?? client.email) && (
            <p className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {client.contactEmail ?? client.email}
            </p>
          )}
          {client.phone && (
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 shrink-0" /> {client.phone}
            </p>
          )}
        </div>
        <p className="text-xs text-foreground-muted">
          {[client.ncc ? `NCC ${client.ncc}` : null, client.rccm ? `RCCM ${client.rccm}` : null].filter(Boolean).join(" · ") ||
            "NCC et RCCM non renseignés — à compléter sur la fiche client pour qu'ils figurent sur la proforma."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Devise du devis</label>
          <select
            value={terms.devise}
            onChange={(e) => chooseCurrency(e.target.value)}
            disabled={pending}
            className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </select>
        </div>
        {!isBase && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Taux : 1 {terms.devise} = … F CFA</label>
            <input
              type="number"
              min={0}
              step="0.000001"
              value={terms.tauxChange}
              onChange={(e) => updateTerms({ tauxChange: e.target.value })}
              disabled={pending}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
          </div>
        )}
        <p className="self-end text-xs text-foreground-muted sm:col-span-3">
          {isBase
            ? "Les prix se saisissent en F CFA. D'autres devises se configurent dans Paramètres > Informations société."
            : "Les prix se saisissent dans cette devise ; le taux est figé à l'émission du devis."}
        </p>
      </div>

      <div className="space-y-4">
        {lines.map((line, i) => (
          <div key={line.key} className="space-y-3 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground-muted">Article {i + 1}</p>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  title="Retirer cet article"
                  className="text-foreground-muted hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Produit</label>
                <select
                  value={line.productModelId}
                  onChange={(e) => chooseProduct(line.key, e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  <option value="">— Sélectionner —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Description de la ligne</label>
                <input
                  value={line.description}
                  onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Quantité</label>
                <input
                  value={line.quantity}
                  onChange={(e) => changeQuantity(line, e.target.value)}
                  type="number"
                  min={1}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
              </div>
              {line.productModelId ? (
                // Article de catalogue : chiffré taille par taille (ci-dessous) — PU moyen affiché.
                <p className="self-end pb-2 text-sm text-foreground-muted">
                  PU moyen HT : <span className="font-medium text-foreground">{money(averageUnitPrice(totalsLine(line)))}</span>
                </p>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">Prix unitaire HT ({isBase ? "F CFA" : terms.devise})</label>
                  <input
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    type="number"
                    min={0}
                    step={decimals === 0 ? "1" : "0.01"}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Remise sur cette ligne (%)</label>
                <input
                  value={line.remisePct}
                  onChange={(e) => updateLine(line.key, { remisePct: e.target.value })}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
              </div>
              <p className="self-end pb-2 text-sm text-foreground-muted">
                Total HT de la ligne :{" "}
                <span className="font-medium text-foreground">
                  {money(lineNet(totalsLine(line), terms.devise))}
                </span>
              </p>
            </div>

            {line.productModelId && (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Couleur — maquette validée par le client à l&apos;acceptation du devis
                </label>
                <ZoneColorPicker
                  zoneTemplate={zoneTemplatesByModel[line.productModelId] ?? []}
                  colors={colors}
                  value={line.colorDraft}
                  onChange={(next) => updateLine(line.key, { colorDraft: next })}
                  disabled={pending}
                />
              </div>
            )}

            {line.productModelId && (
              <div className="rounded-md border border-border p-2">
                <DispatchEditor
                  sizes={sizeOptionsByModel[line.productModelId] ?? []}
                  value={line.sizes}
                  quantity={Number(line.quantity) || 0}
                  disabled={pending}
                  onChange={(next) => updateLine(line.key, { sizes: next, sizesAuto: false })}
                  onPropose={(groupe) =>
                    updateLine(line.key, {
                      sizes: Number(line.quantity) > 0 ? proposeSizes(line.productModelId, Number(line.quantity), groupe) : {},
                      sizesAuto: true,
                    })
                  }
                />
                {line.sizesAuto && Object.keys(line.sizes).length === 0 && Number(line.quantity) > 0 && (
                  <p className="mt-1 text-xs text-foreground-muted">
                    Aucune règle de dispatching pour ce groupe et cette quantité (Paramètres &gt; Dispatching) — saisissez la répartition.
                  </p>
                )}
                <div className="mt-3 border-t border-border pt-3">
                  <LinePricesEditor
                    companyId={companyId}
                    productModelId={line.productModelId}
                    quantity={Number(line.quantity) || 0}
                    printZones={line.printZones}
                    devise={terms.devise}
                    tauxChange={Number(terms.tauxChange) || 1}
                    sizes={sizeOptionsByModel[line.productModelId] ?? []}
                    dispatch={line.sizes}
                    prices={line.sizePrices}
                    sources={line.sizePriceSources}
                    auto={line.pricesAuto}
                    disabled={pending}
                    onChange={(next) => updateLine(line.key, { sizePrices: next.prices, sizePriceSources: next.sources, pricesAuto: next.auto })}
                  />
                </div>
              </div>
            )}

            {line.productModelId && (
              <PrintZonesEditor
                zones={printableZonesByModel[line.productModelId] ?? []}
                value={line.printZones}
                onChange={(next) => updateLine(line.key, { printZones: next })}
                disabled={pending}
              />
            )}
          </div>
        ))}
      </div>

      <Button type="button" variant="ghost" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
        <Plus className="h-3.5 w-3.5" /> Ajouter un article
      </Button>

      <div className="space-y-3 rounded-md border border-border bg-surface p-3">
        <p className="text-xs font-medium text-foreground-muted">Mentions de la proforma</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TermField label="Objet" value={terms.objet} onChange={(v) => updateTerms({ objet: v })} disabled={pending} />
          <TermField
            label="Référence client (n° bon de commande)"
            value={terms.referenceClient}
            onChange={(v) => updateTerms({ referenceClient: v })}
            disabled={pending}
          />
          <TermField label="Validité du devis jusqu'au" type="date" value={terms.validUntil} onChange={(v) => updateTerms({ validUntil: v })} disabled={pending} />
          <TermField label="Remise commerciale globale (%)" type="number" value={terms.remisePct} onChange={(v) => updateTerms({ remisePct: v })} disabled={pending} />
          <TermField label="TVA (%)" type="number" value={terms.tvaRate} onChange={(v) => updateTerms({ tvaRate: v })} disabled={pending} />
          {Number(terms.tvaRate) === 0 && (
            <div className="sm:col-span-2">
              <TermField
                label="Motif d'exonération de TVA"
                value={terms.tvaExonerationMotif}
                onChange={(v) => updateTerms({ tvaExonerationMotif: v })}
                disabled={pending}
                placeholder="ex. vente à l'exportation, zone franche, convention…"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Mode de règlement</label>
            <select
              value={terms.modeReglement}
              onChange={(e) => updateTerms({ modeReglement: e.target.value })}
              disabled={pending}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              <option value="">— Non précisé —</option>
              {MODES_REGLEMENT.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <TermField label="Acompte à la commande (%)" type="number" value={terms.acomptePct} onChange={(v) => updateTerms({ acomptePct: v })} disabled={pending} />
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Conditions de paiement</label>
            <select
              value={terms.conditionsPaiement}
              onChange={(e) => updateTerms({ conditionsPaiement: e.target.value })}
              disabled={pending}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            >
              {paymentTerms.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2 sm:col-span-2" disabled={pending}>
            <legend className="mb-1 text-xs font-medium text-foreground">Livraison</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={terms.livraisonMode === "delai"} onChange={() => updateTerms({ livraisonMode: "delai" })} /> Délai
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={terms.livraisonMode === "date"} onChange={() => updateTerms({ livraisonMode: "date" })} /> Date ferme
              </label>
            </div>
            {terms.livraisonMode === "delai" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_10rem_1fr]">
                <input
                  type="number"
                  min={1}
                  value={terms.delaiValeur}
                  onChange={(e) => updateTerms({ delaiValeur: e.target.value })}
                  placeholder="ex. 4"
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                />
                <select
                  value={terms.delaiUnite}
                  onChange={(e) => updateTerms({ delaiUnite: e.target.value as DelaiUnite })}
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {DELAI_UNITES.map((u) => (
                    <option key={u.value} value={u.value}>
                      {Number(terms.delaiValeur) > 1 ? u.many : u.one}
                    </option>
                  ))}
                </select>
                <select
                  value={terms.delaiDepart}
                  onChange={(e) => updateTerms({ delaiDepart: e.target.value as DelaiDepart })}
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {DELAI_DEPARTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      à compter de {d.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="max-w-xs">
                <input
                  type="date"
                  value={terms.dateLivraison}
                  onChange={(e) => updateTerms({ dateLivraison: e.target.value })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
                <p className="mt-1 text-xs text-foreground-muted">Reprise sur le PDF de l&apos;ordre de fabrication qui héritera de ce devis.</p>
              </div>
            )}
          </fieldset>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-foreground">Remarques pour le client</label>
            <textarea
              value={terms.notes}
              onChange={(e) => updateTerms({ notes: e.target.value })}
              disabled={pending}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <dl className="ml-auto max-w-xs space-y-1 border-t border-border pt-3 text-sm">
          <TotalRow label="Total brut HT" value={money(totals.brut)} />
          {totals.remiseLignes > 0 && <TotalRow label="Remises de lignes" value={`- ${money(totals.remiseLignes)}`} />}
          {totals.remise > 0 && <TotalRow label={`Remise globale ${terms.remisePct} %`} value={`- ${money(totals.remise)}`} />}
          <TotalRow label="Total HT" value={money(totals.ht)} />
          <TotalRow label={`TVA ${terms.tvaRate || 0} %`} value={money(totals.tva)} />
          <TotalRow label="Total TTC" value={money(totals.ttc)} strong />
          {totals.acompte > 0 && <TotalRow label={`Acompte ${terms.acomptePct} %`} value={money(totals.acompte)} />}
          {!isBase && (
            <TotalRow label={`Équivalent F CFA (1 ${terms.devise} = ${terms.tauxChange || "?"})`} value={formatMoney(Math.round(totals.ttc * (Number(terms.tauxChange) || 0)), BASE_CURRENCY)} />
          )}
        </dl>
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" loading={pending} onClick={submit}>
          {correction ? "Resoumettre à la validation interne" : "Soumettre à la validation interne"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

/**
 * Impressions d'une ligne (migration 0065) : les emplacements imprimables du
 * modèle, cochés avec leur nombre de couleurs. Saisis une fois ici, ils servent
 * au chiffrage par la Direction et sont hérités par l'ODF à l'acceptation.
 */
function PrintZonesEditor({
  zones,
  value,
  onChange,
  disabled,
}: {
  zones: PrintableZoneOption[];
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled: boolean;
}) {
  if (zones.length === 0) {
    return <p className="text-xs text-foreground-muted">Aucun emplacement d&apos;impression défini pour ce modèle — Paramètres &gt; Produits.</p>;
  }

  function toggle(zoneId: string, checked: boolean) {
    const next = { ...value };
    if (checked) next[zoneId] = 1;
    else delete next[zoneId];
    onChange(next);
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-foreground">Impressions — emplacement et nombre de couleurs</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[...zones]
          .sort((a, b) => a.display_order - b.display_order)
          .map((zone) => {
            const checked = zone.id in value;
            return (
              <div key={zone.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
                <label className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => toggle(zone.id, e.target.checked)}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-2 focus:ring-brand/30"
                  />
                  {zone.zone_label}
                </label>
                {checked && (
                  <select
                    value={value[zone.id]}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...value, [zone.id]: Number(e.target.value) })}
                    aria-label={`Nombre de couleurs — ${zone.zone_label}`}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-sm"
                  >
                    {Array.from({ length: NB_COULEURS_MAX }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} couleur{n > 1 ? "s" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function TermField({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: "text" | "number" | "date";
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        max={type === "number" ? 100 : undefined}
        step={type === "number" ? "0.01" : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
      />
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-foreground" : "text-foreground-muted"}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
