"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ZoneColorPicker, ZoneColorSummary, type ZoneColorDraft } from "@/components/product/zone-color-picker";
import {
  setProductionOrderProductModel,
  setProductionOrderZoneColors,
  setProductionOrderColorUnique,
  setProductionOrderColorNote,
} from "../actions";

interface ZoneTemplate {
  zone_key: string;
  zone_label: string;
  display_order: number;
}

interface ColorOption {
  id: string;
  name: string;
  code: string;
}

interface ZoneColorValue {
  zone_key: string;
  color_id: string;
}

/**
 * Configurateur couleur par zone (section 8 du document de logique) : choix
 * du modèle de produit puis, une fois le gabarit de zones connu, une
 * couleur par zone (ou une couleur unique pour un modèle « uni »,
 * ZoneColorPicker) dans la palette de référence. Pas de visuel cliquable
 * (V1 actée) — juste une liste de zones nommées.
 *
 * Depuis la configuration côté devis (chantier config-produit-devis), ce
 * modèle/ces couleurs sont normalement déjà hérités via accept_quote() —
 * cet écran reste un filet de rattrapage (devis à plusieurs modèles, ou ODF
 * sans devis) et un droit de correction pour l'atelier tant que l'ODF est
 * éditable (brouillon/refuse).
 */
export function ProductConfigurator({
  productionOrderId,
  editable,
  productModels,
  currentProductModelId,
  currentProductModelName,
  zoneTemplate,
  colors,
  initialZoneColors,
  initialColorUniqueId,
  initialNote,
}: {
  productionOrderId: string;
  editable: boolean;
  productModels: { id: string; name: string }[];
  currentProductModelId: string | null;
  currentProductModelName: string | null;
  zoneTemplate: ZoneTemplate[];
  colors: ColorOption[];
  initialZoneColors: ZoneColorValue[];
  initialColorUniqueId: string | null;
  initialNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ZoneColorDraft>({
    isUni: !!initialColorUniqueId,
    couleurUniqueId: initialColorUniqueId,
    zoneColors: Object.fromEntries(initialZoneColors.map((z) => [z.zone_key, z.color_id])),
  });
  const [note, setNote] = useState(initialNote ?? "");

  function chooseModel(productModelId: string) {
    if (!productModelId) return;
    startTransition(async () => {
      const res = await setProductionOrderProductModel(productionOrderId, productModelId);
      if (res.error) toast.error("Modèle non enregistré", { description: res.error });
    });
  }

  function saveColors() {
    startTransition(async () => {
      const res =
        draft.isUni || zoneTemplate.length === 0
          ? await setProductionOrderColorUnique(productionOrderId, draft.couleurUniqueId)
          : await setProductionOrderZoneColors(
              productionOrderId,
              Object.entries(draft.zoneColors)
                .filter(([, colorId]) => !!colorId)
                .map(([zone_key, color_id]) => ({ zone_key, color_id }))
            );
      if (res.error) toast.error("Couleurs non enregistrées", { description: res.error });
      else toast.success("Couleurs enregistrées");
    });
  }

  function saveNote() {
    startTransition(async () => {
      const res = await setProductionOrderColorNote(productionOrderId, note);
      if (res.error) toast.error("Commentaire non enregistré", { description: res.error });
      else toast.success("Commentaire enregistré");
    });
  }

  return (
    <Card>
      <CardHeader
        title="Configuration produit"
        description="Modèle de produit, couleur par zone et disponibilité (section 8/9 du document de logique)."
      />
      <CardBody className="space-y-5">
        {!currentProductModelId ? (
          editable ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground-muted">Modèle de produit</label>
              <select
                defaultValue=""
                disabled={pending}
                onChange={(e) => chooseModel(e.target.value)}
                className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
              >
                <option value="">Choisir un modèle…</option>
                {productModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-foreground-muted">
                Nécessaire pour connaître le gabarit de zones à configurer.
              </p>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">Aucun modèle de produit renseigné pour cet ODF.</p>
          )
        ) : (
          <>
            <p className="text-xs text-foreground-muted">
              Modèle : <span className="font-medium text-foreground">{currentProductModelName}</span>
            </p>

            {editable ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground-muted">Couleur</p>
                <ZoneColorPicker
                  zoneTemplate={zoneTemplate}
                  colors={colors}
                  value={draft}
                  onChange={setDraft}
                  disabled={pending}
                />
                <Button size="sm" variant="secondary" onClick={saveColors} loading={pending}>
                  Enregistrer les couleurs
                </Button>
              </div>
            ) : (
              <ZoneColorSummary
                couleurUnique={draft.couleurUniqueId ? colors.find((c) => c.id === draft.couleurUniqueId) : null}
                zoneColors={zoneTemplate.map((z) => ({
                  zone_key: z.zone_key,
                  zone_label: z.zone_label,
                  colors: draft.zoneColors[z.zone_key] ? colors.find((c) => c.id === draft.zoneColors[z.zone_key]) : null,
                }))}
              />
            )}
          </>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-foreground-muted">
            Disponibilité couleurs (commentaire libre — non validé par le logiciel)
          </label>
          {editable ? (
            <div className="flex items-start gap-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Ex : rupture fournisseur sur le bleu marine, prévoir une alternative"
                className="w-full flex-1 rounded-md border border-border bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
              <Button size="sm" variant="secondary" onClick={saveNote} loading={pending}>
                Enregistrer
              </Button>
            </div>
          ) : (
            <p className="text-sm text-foreground">{initialNote || "—"}</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
