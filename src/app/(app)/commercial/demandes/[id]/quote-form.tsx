"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createQuote, type QuoteLineInput } from "../../actions";
import { useRouter } from "next/navigation";
import { ZoneColorPicker, EMPTY_ZONE_COLOR_DRAFT, type ZoneColorDraft } from "@/components/product/zone-color-picker";

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
}: {
  requestId: string;
  companyId: string;
  products: ProductModel[];
  /** Gabarit de zones par modèle de produit — nécessaire au ZoneColorPicker dès qu'une ligne choisit un modèle. */
  zoneTemplatesByModel: Record<string, ZoneTemplate[]>;
  colors: ColorOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const router = useRouter();

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setLines([newLine()]);
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
      const res = await createQuote(requestId, companyId, payload);
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
                <label className="mb-1 block text-xs font-medium text-foreground">Prix unitaire</label>
                <input
                  value={line.unitPrice}
                  onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                  type="number"
                  min={0}
                  step="0.01"
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
