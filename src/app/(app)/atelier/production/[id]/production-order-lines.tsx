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
import { LineMaquettePicker } from "./line-maquette-picker";
import { LinePrintableZonesPicker, type PrintableZoneOption } from "./line-printable-zones-picker";
import type { AttachableMediaFile, DownloadableMediaFile, MaquetteFile } from "@/lib/types/domain";
import type { StatutFiche } from "@/lib/patronnage/types";

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
  /** Sections d'atelier retenues sur cet article (migration 0037), dans l'ordre de passage. */
  sectionIds: string[];
  /** Une section de catégorie Coupe est-elle retenue ? Conditionne l'affichage de la fiche Patronnage. */
  coupeSelected: boolean;
  fiche: { id: string; numeroOt: string; statut: StatutFiche } | null;
  /**
   * Une section exigeant un visuel (ex. Impression) est-elle retenue ?
   * Conditionne aussi l'affichage de la maquette et des zones imprimables
   * (migration 0040) — les trois n'ont de sens que pour un article qui
   * passe par l'Impression.
   */
  impressionSectionSelected: boolean;
  /** Visuel(s) déposés au devis pour la ligne d'origine (migration 0041) — lecture seule sur l'ODF, seul le devis les retire. */
  visuelsFromDevis: DownloadableMediaFile[];
  /** Visuel(s) déposés directement sur cet article d'ODF — détachables ici. */
  visuelAttached: DownloadableMediaFile[];
  /** Maquette déposée au devis pour la ligne d'origine (migration 0041) — fait foi, lecture seule sur l'ODF ; null si le devis n'en avait pas. */
  maquetteFromDevis: MaquetteFile | null;
  /** Maquette déposée directement sur cet article d'ODF — rattrapage, seulement pertinent si maquetteFromDevis est null. */
  maquetteAttached: MaquetteFile[];
  /** Zones imprimables définies pour le modèle de cet article (product_printable_zones). */
  printableZoneOptions: PrintableZoneOption[];
  /** Zones imprimables déjà cochées pour cet article. */
  printableZoneIdsSelected: string[];
}

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
  mediaEditable,
  lines,
  productModels,
  colors,
  allSections,
  availableMediaFiles,
  initialNote,
}: {
  productionOrderId: string;
  editable: boolean;
  /** Visuel/maquette restent modifiables un peu plus longtemps que le reste (migration 0042) — voir page.tsx. */
  mediaEditable: boolean;
  lines: LineData[];
  productModels: { id: string; name: string }[];
  colors: ColorOption[];
  /** Toutes les sections d'atelier actives, pour le sélecteur de sections retenues de chaque article. */
  allSections: { id: string; name: string }[];
  /** Médiathèque du client, pour le sélecteur de visuel de chaque article. */
  availableMediaFiles: AttachableMediaFile[];
  /** Disponibilité couleurs, commentaire libre — jamais validé par le logiciel (section 9), reste au niveau de l'ODF entier. */
  initialNote: string | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Configuration produit"
        description="Un article par ligne du devis accepté — modèle, tissu, couleur, sections d'atelier, fiche Patronnage et visuel, tout au même endroit."
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
              mediaEditable={mediaEditable}
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
  mediaEditable,
  line,
  productModels,
  colors,
  allSections,
  availableMediaFiles,
}: {
  productionOrderId: string;
  editable: boolean;
  mediaEditable: boolean;
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

      <div className="space-y-3 border-t border-border pt-3">
        {editable && (
          <LineSectionsPicker
            lineId={line.id}
            productionOrderId={productionOrderId}
            allSections={allSections}
            initialSectionIds={line.sectionIds}
          />
        )}

        {(line.coupeSelected || line.fiche) && (
          <FichePatronnageLink
            lineId={line.id}
            editable={editable}
            fiche={line.fiche}
            productModelId={line.productModelId}
          />
        )}

        {(line.impressionSectionSelected || line.visuelsFromDevis.length > 0 || line.visuelAttached.length > 0) && (
          <LineVisuelPicker
            lineId={line.id}
            productionOrderId={productionOrderId}
            editable={mediaEditable}
            fromDevis={line.visuelsFromDevis}
            attached={line.visuelAttached}
            available={availableMediaFiles}
            required={line.impressionSectionSelected}
          />
        )}

        {(line.impressionSectionSelected || !!line.maquetteFromDevis || line.maquetteAttached.length > 0) && (
          <LineMaquettePicker
            lineId={line.id}
            productionOrderId={productionOrderId}
            editable={mediaEditable}
            fromDevis={line.maquetteFromDevis}
            attached={line.maquetteAttached}
            available={availableMediaFiles}
          />
        )}

        {(line.impressionSectionSelected || line.printableZoneIdsSelected.length > 0) &&
          (line.printableZoneOptions.length > 0 ? (
            <LinePrintableZonesPicker
              lineId={line.id}
              productionOrderId={productionOrderId}
              zones={line.printableZoneOptions}
              initialZoneIds={line.printableZoneIdsSelected}
            />
          ) : (
            <p className="text-xs text-foreground-muted">
              Aucune zone imprimable définie pour ce modèle — Paramètres &gt; Produits.
            </p>
          ))}
      </div>
    </div>
  );
}
