"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import {
  setProductionOrderProductModel,
  setProductionOrderZoneColors,
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
 * couleur par zone dans la palette de référence. Pas de visuel cliquable
 * (V1 actée) — juste une liste de zones nommées. Éditable uniquement en
 * brouillon, comme les autres champs de composition de l'ODF.
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
  initialNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [zoneColors, setZoneColors] = useState<Record<string, string>>(
    Object.fromEntries(initialZoneColors.map((z) => [z.zone_key, z.color_id]))
  );
  const [note, setNote] = useState(initialNote ?? "");

  function chooseModel(productModelId: string) {
    if (!productModelId) return;
    startTransition(async () => {
      const res = await setProductionOrderProductModel(productionOrderId, productModelId);
      if (res.error) toast.error("Modèle non enregistré", { description: res.error });
    });
  }

  function saveZoneColors() {
    const entries = Object.entries(zoneColors)
      .filter(([, colorId]) => !!colorId)
      .map(([zone_key, color_id]) => ({ zone_key, color_id }));
    startTransition(async () => {
      const res = await setProductionOrderZoneColors(productionOrderId, entries);
      if (res.error) toast.error("Couleurs non enregistrées", { description: res.error });
      else toast.success("Couleurs par zone enregistrées");
    });
  }

  function saveNote() {
    startTransition(async () => {
      const res = await setProductionOrderColorNote(productionOrderId, note);
      if (res.error) toast.error("Commentaire non enregistré", { description: res.error });
      else toast.success("Commentaire enregistré");
    });
  }

  const colorById = (id: string) => colors.find((c) => c.id === id);

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

            {zoneTemplate.length === 0 ? (
              <p className="text-xs text-foreground-muted">
                Ce modèle n&apos;a pas encore de gabarit de zones — à définir depuis Paramètres &gt; Modèles de
                produits.
              </p>
            ) : editable ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground-muted">Couleur par zone</p>
                {zoneTemplate.map((z) => (
                  <div key={z.zone_key} className="flex items-center gap-2">
                    <span className="w-44 shrink-0 text-xs text-foreground">{z.zone_label}</span>
                    <select
                      value={zoneColors[z.zone_key] ?? ""}
                      onChange={(e) => setZoneColors((prev) => ({ ...prev, [z.zone_key]: e.target.value }))}
                      className="h-9 flex-1 max-w-xs rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                    >
                      <option value="">Couleur…</option>
                      {colors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    {zoneColors[z.zone_key] && (
                      <span
                        className="h-5 w-5 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: colorById(zoneColors[z.zone_key])?.code }}
                        aria-hidden
                      />
                    )}
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={saveZoneColors} loading={pending}>
                  Enregistrer les couleurs
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {zoneTemplate.map((z) => {
                  const color = zoneColors[z.zone_key] ? colorById(zoneColors[z.zone_key]) : null;
                  return (
                    <div key={z.zone_key} className="flex items-center gap-2 text-xs">
                      <span className="w-44 shrink-0 text-foreground-muted">{z.zone_label}</span>
                      {color ? (
                        <span className="flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
                            style={{ backgroundColor: color.code }}
                            aria-hidden
                          />
                          {color.name}
                        </span>
                      ) : (
                        <span className="text-foreground-muted">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
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
