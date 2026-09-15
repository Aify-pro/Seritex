"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ZoneColorPicker, ZoneColorSummary, type ZoneColorDraft } from "@/components/product/zone-color-picker";
import {
  setProductionOrderLineProductModel,
  setProductionOrderLineZoneColors,
  setProductionOrderLineColorUnique,
  setProductionOrderLineSizes,
  setProductionOrderColorNote,
} from "../actions";
import type { Size } from "@/lib/sizes";
import { LineSectionsPicker } from "./line-sections-picker";
import { FichePatronnageLink } from "./fiche-patronnage-link";
import { LineVisuelPicker } from "./line-visuel-picker";
import type { AttachableMediaFile } from "./production-order-media-files";
import type { StatutFiche } from "@/lib/patronnage/types";
import { formatDateTime } from "@/lib/utils";
import Link from "next/link";

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

export interface LineData {
  id: string;
  description: string;
  quantity: number;
  productModelId: string | null;
  productModelName: string | null;
  /**
   * Le modèle/la couleur viennent-ils de la ligne de devis correspondante ?
   * Si oui, le client les a déjà validés en acceptant le devis : lecture
   * seule sur l'ODF. Si non (ligne de devis en texte libre, sans modèle),
   * c'est à compléter ici — pas une modification de ce que le client a
   * validé, un complément de ce qu'il n'a jamais reçu.
   */
  sourceHadModel: boolean;
  textileNom: string | null;
  textileComposition: string | null;
  textileGrammage: number | null;
  textileLaizeCm: number | null;
  couleurUniqueId: string | null;
  zoneColors: ZoneColorValue[];
  zoneTemplate: ZoneTemplate[];
  referentielTailles: Size[];
  initialSizes: { taille: string; quantite_demandee: number }[];
  /** Sections retenues sur cet article (migration 0037) — id des sections déjà choisies, dans l'ordre. */
  initialSectionIds: string[];
  /** Vrai si une des sections retenues sur cet article exige une fiche de tracé (catégorie Coupe). */
  coupeSelected: boolean;
  /** Vrai si une des sections retenues sur cet article exige un visuel (catégorie Impression). */
  visuelRequired: boolean;
  fiche: { id: string; numeroOt: string; statut: StatutFiche } | null;
  attachedVisuel: AttachableMediaFile[];
  /** Article d'échantillon hérité du devis (migration 0037) — jamais modifiable depuis l'ODF. */
  sampleItemId: string | null;
  sampleNumber: string | null;
  sampleLabel: string | null;
  /** Mouvements de stock rattachés à cet article (migration 0037). */
  stockMovements: { type: string; quantiteOuPoids: number; unite: string; createdAt: string }[];
}

const STOCK_MOVEMENT_TYPE_LABELS: Record<string, string> = {
  sortie_mp: "Sortie MP",
  entree_semi_fini: "Entrée semi-fini",
  sortie_semi_fini: "Sortie semi-fini",
  entree_fini: "Entrée fini",
  retour_mp: "Retour MP",
};

/**
 * Configuration produit de l'ODF, une carte par article du devis accepté
 * (chantier ODF multi-lignes) — modèle, tissu, couleur et dispatching des
 * tailles. Remplace l'ancien ProductConfigurator (une seule configuration
 * pour tout l'ODF), qui ne tenait plus dès qu'un devis portait plusieurs
 * articles de couleurs différentes.
 */
export function ProductionOrderLines({
  productionOrderId,
  editable,
  lines,
  productModels,
  colors,
  initialNote,
  allSections,
  availableMediaFiles,
}: {
  productionOrderId: string;
  editable: boolean;
  lines: LineData[];
  productModels: { id: string; name: string }[];
  colors: ColorOption[];
  /** Disponibilité couleurs, commentaire libre — jamais validé par le logiciel (section 9), reste au niveau de l'ODF entier. */
  initialNote: string | null;
  /** Référentiel des sections d'atelier — pour LineSectionsPicker, partagé par tous les articles. */
  allSections: { id: string; name: string }[];
  /** Médiathèque du client — pour le sélecteur de visuel de LineVisuelPicker, partagé par tous les articles. */
  availableMediaFiles: AttachableMediaFile[];
}) {
  return (
    <Card>
      <CardHeader
        title="Configuration produit"
        description="Un article par ligne du devis accepté — modèle, tissu, couleur, tailles, sections retenues, fiche de tracé et visuel : tout ce qui concerne cet article, au même endroit."
      />
      <CardBody className="space-y-4">
        {lines.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun article sur cet ordre de fabrication.</p>
        ) : (
          lines.map((line) => (
            <LineCard
              key={line.id}
              productionOrderId={productionOrderId}
              editable={editable}
              line={line}
              productModels={productModels}
              colors={colors}
              allSections={allSections}
              availableMediaFiles={availableMediaFiles}
            />
          ))
        )}
        <ColorNote productionOrderId={productionOrderId} editable={editable} initialNote={initialNote} />
      </CardBody>
    </Card>
  );
}

function ColorNote({
  productionOrderId,
  editable,
  initialNote,
}: {
  productionOrderId: string;
  editable: boolean;
  initialNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(initialNote ?? "");

  function saveNote() {
    startTransition(async () => {
      const res = await setProductionOrderColorNote(productionOrderId, note);
      if (res.error) toast.error("Commentaire non enregistré", { description: res.error });
      else toast.success("Commentaire enregistré");
    });
  }

  return (
    <div className="border-t border-border pt-4">
      <label className="mb-1 block text-xs font-medium text-foreground-muted">
        Disponibilité couleurs, tous articles confondus (commentaire libre — non validé par le logiciel)
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
  );
}

function LineCard({
  productionOrderId,
  editable,
  line,
  productModels,
  colors,
  allSections,
  availableMediaFiles,
}: {
  productionOrderId: string;
  editable: boolean;
  line: LineData;
  productModels: { id: string; name: string }[];
  colors: ColorOption[];
  allSections: { id: string; name: string }[];
  availableMediaFiles: AttachableMediaFile[];
}) {
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ZoneColorDraft>({
    isUni: !!line.couleurUniqueId,
    couleurUniqueId: line.couleurUniqueId,
    zoneColors: Object.fromEntries(line.zoneColors.map((z) => [z.zone_key, z.color_id])),
  });
  const [quantites, setQuantites] = useState<Record<string, number>>(
    Object.fromEntries(line.initialSizes.map((s) => [s.taille, s.quantite_demandee]))
  );

  const modelEditable = editable && !line.productModelId;
  const colorEditable = editable && !line.sourceHadModel;

  function chooseModel(productModelId: string) {
    if (!productModelId) return;
    startTransition(async () => {
      const res = await setProductionOrderLineProductModel(line.id, productModelId);
      if (res.error) toast.error("Modèle non enregistré", { description: res.error });
    });
  }

  function saveColors() {
    startTransition(async () => {
      const res =
        draft.isUni || line.zoneTemplate.length === 0
          ? await setProductionOrderLineColorUnique(line.id, draft.couleurUniqueId)
          : await setProductionOrderLineZoneColors(
              line.id,
              Object.entries(draft.zoneColors)
                .filter(([, colorId]) => !!colorId)
                .map(([zone_key, color_id]) => ({ zone_key, color_id }))
            );
      if (res.error) toast.error("Couleur non enregistrée", { description: res.error });
      else toast.success("Couleur enregistrée");
    });
  }

  function setQuantite(cle: string, valeur: number) {
    setQuantites((prev) => ({ ...prev, [cle]: Number.isFinite(valeur) && valeur > 0 ? valeur : 0 }));
  }

  function saveSizes() {
    const sizes = line.referentielTailles
      .filter((t) => (quantites[t.cle] ?? 0) > 0)
      .map((t) => ({ taille: t.cle, quantite_demandee: quantites[t.cle] }));
    startTransition(async () => {
      const res = await setProductionOrderLineSizes(line.id, productionOrderId, sizes);
      if (res.error) toast.error("Tailles non enregistrées", { description: res.error });
      else toast.success("Dispatching enregistré");
    });
  }

  const reparti = Object.values(quantites).reduce((somme, n) => somme + (n || 0), 0);
  const ecart = reparti - line.quantity;
  const groupes = [...new Set(line.referentielTailles.map((t) => t.groupe))];

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{line.description}</p>
        <p className="text-xs text-foreground-muted">{line.quantity} pièces</p>
      </div>

      {!line.productModelId ? (
        modelEditable ? (
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
              Cet article n&apos;avait pas de modèle sur le devis — à compléter ici.
            </p>
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">Aucun modèle de produit renseigné pour cet article.</p>
        )
      ) : (
        <>
          <p className="text-xs text-foreground-muted">
            Modèle : <span className="font-medium text-foreground">{line.productModelName}</span>
            {line.textileNom && (
              <>
                {" · "}Tissu : <span className="font-medium text-foreground">{line.textileNom}</span>
                {line.textileComposition && ` (${line.textileComposition})`}
              </>
            )}
            {line.textileGrammage != null && <> · {line.textileGrammage} g/m²</>}
            {line.textileLaizeCm != null && <> · laize {line.textileLaizeCm} cm</>}
          </p>

          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground-muted">Couleur</p>
            {colorEditable ? (
              <>
                <ZoneColorPicker
                  zoneTemplate={line.zoneTemplate}
                  colors={colors}
                  value={draft}
                  onChange={setDraft}
                  disabled={pending}
                />
                <Button size="sm" variant="secondary" onClick={saveColors} loading={pending}>
                  Enregistrer la couleur
                </Button>
              </>
            ) : (
              <ZoneColorSummary
                couleurUnique={line.couleurUniqueId ? colors.find((c) => c.id === line.couleurUniqueId) : null}
                zoneColors={line.zoneTemplate.map((z) => ({
                  zone_key: z.zone_key,
                  zone_label: z.zone_label,
                  colors: line.zoneColors.find((zc) => zc.zone_key === z.zone_key)
                    ? colors.find((c) => c.id === line.zoneColors.find((zc) => zc.zone_key === z.zone_key)?.color_id)
                    : null,
                }))}
              />
            )}
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-foreground-muted">Dispatching des tailles</p>
              <p className="text-xs">
                <span className="text-foreground-muted">Réparti </span>
                <span className={ecart === 0 ? "font-semibold text-success" : "font-semibold text-warning"}>
                  {reparti}
                </span>
                <span className="text-foreground-muted"> / {line.quantity}</span>
                {ecart !== 0 && (
                  <span className="text-warning"> — {ecart > 0 ? `${ecart} en trop` : `il manque ${-ecart}`}</span>
                )}
              </p>
            </div>

            {line.referentielTailles.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-foreground-muted">
                Aucune taille proposable pour ce modèle — voir Paramètres &gt; Couleurs et tailles.
              </p>
            ) : (
              <div className="space-y-3">
                {groupes.map((groupe) => (
                  <div key={groupe}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {groupe}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {line.referentielTailles
                        .filter((t) => t.groupe === groupe)
                        .map((t) => {
                          const valeur = quantites[t.cle] ?? 0;
                          return (
                            <label
                              key={t.cle}
                              className={`flex w-20 flex-col gap-1 rounded-md border p-1.5 ${
                                valeur > 0 ? "border-brand bg-brand-soft/40" : "border-border"
                              }`}
                            >
                              <span className="text-center text-[11px] font-medium text-foreground">{t.libelle}</span>
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                disabled={!editable || pending}
                                value={valeur || ""}
                                placeholder="0"
                                onChange={(e) => setQuantite(t.cle, Number(e.target.value))}
                                className="w-full rounded border border-border bg-surface p-1 text-center text-xs outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                              />
                            </label>
                          );
                        })}
                    </div>
                  </div>
                ))}
                {editable && (
                  <Button size="sm" variant="secondary" onClick={saveSizes} loading={pending}>
                    Enregistrer le dispatching
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {editable && (
        <div className="border-t border-border pt-3">
          <LineSectionsPicker
            bare
            lineId={line.id}
            productionOrderId={productionOrderId}
            lineLabel={line.description}
            allSections={allSections}
            initialSectionIds={line.initialSectionIds}
          />
        </div>
      )}

      {(line.coupeSelected || line.fiche) && (
        <div className="border-t border-border pt-3">
          <FichePatronnageLink
            bare
            lineId={line.id}
            lineLabel={line.description}
            editable={editable}
            fiche={line.fiche}
            productModelId={line.productModelId}
          />
        </div>
      )}

      {(line.visuelRequired || line.attachedVisuel.length > 0) && (
        <div className="border-t border-border pt-3">
          <LineVisuelPicker
            bare
            lineId={line.id}
            lineLabel={line.description}
            productionOrderId={productionOrderId}
            attached={line.attachedVisuel}
            available={availableMediaFiles}
            required={line.visuelRequired}
          />
        </div>
      )}

      {line.sampleLabel && (
        <div className="border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground-muted">Échantillon lié</p>
          <p className="mb-1 text-[11px] text-foreground-muted">Choisi au devis — non modifiable depuis l&apos;ODF.</p>
          <Link href={`/echantillons/${line.sampleNumber}`} className="text-sm font-medium text-brand hover:underline">
            {line.sampleLabel}
          </Link>
        </div>
      )}

      {line.stockMovements.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium text-foreground-muted">Mouvements de stock</p>
          <ul className="space-y-1">
            {line.stockMovements.map((m, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-foreground">
                <span>{STOCK_MOVEMENT_TYPE_LABELS[m.type] ?? m.type}</span>
                <span className="text-foreground-muted">
                  {m.quantiteOuPoids} {m.unite === "kg" ? "kg" : "pièce(s)"} · {formatDateTime(m.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
