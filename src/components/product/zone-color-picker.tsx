"use client";

import type { Color, ProductZoneTemplate } from "@/lib/types/domain";

/** État d'une configuration couleur en cours d'édition — devis ou ODF. */
export type ZoneColorDraft = {
  isUni: boolean;
  couleurUniqueId: string | null;
  zoneColors: Record<string, string>;
};

export const EMPTY_ZONE_COLOR_DRAFT: ZoneColorDraft = { isUni: false, couleurUniqueId: null, zoneColors: {} };

/**
 * Sélecteur de couleur par zone, ou couleur unique pour un modèle « uni » —
 * extrait de l'ancien ProductConfigurator (ODF) pour être partagé avec
 * QuoteForm (devis) : le choix modèle + couleur se fait désormais dès la
 * ligne de devis, l'ODF n'étant plus qu'un filet de rattrapage.
 *
 * Composant contrôlé, aucun appel serveur ici : chaque appelant décide
 * quand persister (immédiatement sur l'ODF, au dépôt du formulaire sur le
 * devis).
 */
export function ZoneColorPicker({
  zoneTemplate,
  colors,
  value,
  onChange,
  disabled,
}: {
  zoneTemplate: Pick<ProductZoneTemplate, "zone_key" | "zone_label" | "display_order">[];
  colors: Pick<Color, "id" | "name" | "code">[];
  value: ZoneColorDraft;
  onChange: (next: ZoneColorDraft) => void;
  disabled?: boolean;
}) {
  const hasZones = zoneTemplate.length > 0;
  // Un modèle sans gabarit de zones n'a pas d'autre option que la couleur
  // unique — cohérent avec le garde-fou serveur (submit_production_order).
  const uni = value.isUni || !hasZones;

  function toggleUni(next: boolean) {
    onChange({
      isUni: next,
      couleurUniqueId: next ? value.couleurUniqueId : null,
      zoneColors: next ? {} : value.zoneColors,
    });
  }

  const colorById = (id: string) => colors.find((c) => c.id === id);

  return (
    <div className="space-y-2">
      {hasZones && (
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <input
            type="checkbox"
            checked={uni}
            disabled={disabled}
            onChange={(e) => toggleUni(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Modèle uni (une seule couleur, pas de couleur par zone)
        </label>
      )}

      {uni ? (
        <div className="flex items-center gap-2">
          <select
            value={value.couleurUniqueId ?? ""}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, couleurUniqueId: e.target.value || null })}
            className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
          >
            <option value="">Couleur…</option>
            {colors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {value.couleurUniqueId && (
            <span
              className="h-5 w-5 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: colorById(value.couleurUniqueId)?.code }}
              aria-hidden
            />
          )}
          {!hasZones && (
            <span className="text-xs text-foreground-muted">Ce modèle n&apos;a pas de gabarit de zones.</span>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {[...zoneTemplate]
            .sort((a, b) => a.display_order - b.display_order)
            .map((z) => (
              <div key={z.zone_key} className="flex items-center gap-2">
                <span className="w-44 shrink-0 text-xs text-foreground">{z.zone_label}</span>
                <select
                  value={value.zoneColors[z.zone_key] ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    onChange({ ...value, zoneColors: { ...value.zoneColors, [z.zone_key]: e.target.value } })
                  }
                  className="h-9 flex-1 max-w-xs rounded-md border border-border bg-surface px-2 text-sm outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60"
                >
                  <option value="">Couleur…</option>
                  {colors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {value.zoneColors[z.zone_key] && (
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: colorById(value.zoneColors[z.zone_key])?.code }}
                    aria-hidden
                  />
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Rendu lecture seule d'une configuration déjà enregistrée — devis (maquette côté client) ou ODF. */
export function ZoneColorSummary({
  couleurUnique,
  zoneColors,
}: {
  couleurUnique?: Pick<Color, "id" | "name" | "code"> | null;
  zoneColors: { zone_key: string; zone_label?: string; colors?: Pick<Color, "id" | "name" | "code"> | null }[];
}) {
  if (couleurUnique) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: couleurUnique.code }}
          aria-hidden
        />
        Couleur unique : {couleurUnique.name}
      </span>
    );
  }
  if (zoneColors.length === 0) {
    return <span className="text-xs text-foreground-muted">Aucune couleur configurée.</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {zoneColors.map((z) => (
        <span key={z.zone_key} className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
          <span
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: z.colors?.code }}
            aria-hidden
          />
          {z.zone_label ?? z.zone_key} : {z.colors?.name ?? "—"}
        </span>
      ))}
    </div>
  );
}
