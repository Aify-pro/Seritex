"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQuote, type QuoteLineInput } from "../../actions";
import { useRouter } from "next/navigation";
import { ZoneColorPicker, EMPTY_ZONE_COLOR_DRAFT, type ZoneColorDraft } from "@/components/product/zone-color-picker";
import { computeQuoteTotals } from "@/lib/quote-totals";
import { formatAmount } from "@/lib/utils";

type ProductModel = { id: string; name: string; base_price: number | null };
type ZoneTemplate = { zone_key: string; zone_label: string; display_order: number };
type ColorOption = { id: string; name: string; code: string };

type LineDraft = {
  /** Identité côté client (clé React / suppression) — jamais envoyée au serveur. */
  key: string;
  productModelId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  colorDraft: ZoneColorDraft;
};

/** Valeurs par défaut des mentions de proforma, issues de Paramètres > Informations société (migration 0061). */
export type QuoteDefaults = {
  tvaRate: number;
  validiteJours: number;
  acomptePct: number;
  conditionsPaiement: string;
};

type TermsDraft = {
  objet: string;
  referenceClient: string;
  remisePct: string;
  tvaRate: string;
  tvaExonerationMotif: string;
  modeReglement: string;
  conditionsPaiement: string;
  acomptePct: string;
  delaiLivraison: string;
  notes: string;
  validUntil: string;
};

const MODES_REGLEMENT = ["Virement bancaire", "Chèque", "Espèces", "Mobile money", "Traite / effet"];

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function newTerms(defaults: QuoteDefaults): TermsDraft {
  return {
    objet: "",
    referenceClient: "",
    remisePct: "0",
    tvaRate: String(defaults.tvaRate),
    tvaExonerationMotif: "",
    modeReglement: "",
    conditionsPaiement: defaults.conditionsPaiement,
    acomptePct: String(defaults.acomptePct),
    delaiLivraison: "",
    notes: "",
    validUntil: addDays(defaults.validiteJours),
  };
}

function newLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    productModelId: "",
    description: "",
    quantity: "",
    unitPrice: "",
    colorDraft: EMPTY_ZONE_COLOR_DRAFT,
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
  products,
  zoneTemplatesByModel,
  colors,
  defaults,
}: {
  requestId: string;
  companyId: string;
  products: ProductModel[];
  /** Gabarit de zones par modèle de produit — nécessaire au ZoneColorPicker dès qu'une ligne choisit un modèle. */
  zoneTemplatesByModel: Record<string, ZoneTemplate[]>;
  colors: ColorOption[];
  defaults: QuoteDefaults;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [dateLivraisonPrevue, setDateLivraisonPrevue] = useState("");
  const [terms, setTerms] = useState<TermsDraft>(() => newTerms(defaults));
  const router = useRouter();

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setLines([newLine()]);
          setDateLivraisonPrevue("");
          setTerms(newTerms(defaults));
          setOpen(true);
        }}
      >
        Établir un devis
      </Button>
    );
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
            }
          : l
      )
    );
  }

  function updateTerms(patch: Partial<TermsDraft>) {
    setTerms((prev) => ({ ...prev, ...patch }));
  }

  const totals = computeQuoteTotals(
    lines.map((l) => ({ quantity: Number(l.quantity) || 0, unit_price: Number(l.unitPrice) || 0 })),
    Number(terms.remisePct) || 0,
    Number(terms.tvaRate) || 0,
    Number(terms.acomptePct) || 0
  );

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function submit() {
    const payload: QuoteLineInput[] = lines.map((l) => {
      const zoneTemplate = zoneTemplatesByModel[l.productModelId] ?? [];
      const uni = l.colorDraft.isUni || zoneTemplate.length === 0;
      return {
        description: l.description,
        quantity: Number(l.quantity),
        unit_price: Number(l.unitPrice),
        product_model_id: l.productModelId || null,
        couleur_unique_id: uni ? l.colorDraft.couleurUniqueId : null,
        zone_colors: uni
          ? []
          : Object.entries(l.colorDraft.zoneColors)
              .filter(([, colorId]) => !!colorId)
              .map(([zone_key, color_id]) => ({ zone_key, color_id })),
      };
    });

    startTransition(async () => {
      const res = await createQuote(requestId, companyId, payload, dateLivraisonPrevue || null, {
        objet: terms.objet,
        reference_client: terms.referenceClient,
        remise_pct: Number(terms.remisePct) || 0,
        tva_rate: Number(terms.tvaRate) || 0,
        tva_exoneration_motif: terms.tvaExonerationMotif,
        mode_reglement: terms.modeReglement,
        conditions_paiement: terms.conditionsPaiement,
        acompte_pct: Number(terms.acomptePct) || 0,
        delai_livraison: terms.delaiLivraison,
        notes: terms.notes,
        valid_until: terms.validUntil || null,
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Devis créé et envoyé au client");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-4">
      <div className="max-w-xs">
        <label className="mb-1 block text-xs font-medium text-foreground">Date de livraison prévue</label>
        <input
          type="date"
          value={dateLivraisonPrevue}
          onChange={(e) => setDateLivraisonPrevue(e.target.value)}
          disabled={pending}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-foreground-muted">
          Optionnelle — reprise sur le PDF de l&apos;ordre de fabrication qui héritera de ce devis.
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
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  type="number"
                  min={1}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Prix unitaire HT (F CFA)</label>
                <input
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  type="number"
                  min={0}
                  step="1"
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                />
              </div>
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
          <TermField label="Délai de livraison" value={terms.delaiLivraison} onChange={(v) => updateTerms({ delaiLivraison: v })} disabled={pending} placeholder="ex. 3 semaines après acompte" />
          <TermField label="Remise commerciale (%)" type="number" value={terms.remisePct} onChange={(v) => updateTerms({ remisePct: v })} disabled={pending} />
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
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-foreground">Conditions de paiement</label>
            <textarea
              value={terms.conditionsPaiement}
              onChange={(e) => updateTerms({ conditionsPaiement: e.target.value })}
              disabled={pending}
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </div>
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
          <TotalRow label="Total brut HT" value={totals.brut} />
          {totals.remise > 0 && <TotalRow label={`Remise ${terms.remisePct} %`} value={-totals.remise} />}
          <TotalRow label="Total HT" value={totals.ht} />
          <TotalRow label={`TVA ${terms.tvaRate || 0} %`} value={totals.tva} />
          <TotalRow label="Total TTC" value={totals.ttc} strong />
          {totals.acompte > 0 && <TotalRow label={`Acompte ${terms.acomptePct} %`} value={totals.acompte} />}
        </dl>
      </div>

      <div className="flex gap-2 border-t border-border pt-3">
        <Button type="button" size="sm" loading={pending} onClick={submit}>
          Envoyer le devis au client
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Annuler
        </Button>
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

function TotalRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold text-foreground" : "text-foreground-muted"}`}>
      <dt>{label}</dt>
      <dd>{formatAmount(value)}</dd>
    </div>
  );
}
