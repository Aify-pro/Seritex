"use client";

import { useState } from "react";
import { ChevronDown, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ARCHETYPES } from "@/lib/separation/archetypes";
import { AM_DEFAUT, ANGLE_AM_DEFAUT, REGLAGES_DEFAUT, type Reglages } from "@/lib/separation/reglages";
import { PROFILS_ADAPTATIFS } from "@/lib/separation/separer";
import { LIBELLES_RENDU, lpiMaxPourMaillage, type Rendu } from "@/lib/separation/trame";
import { cn } from "@/lib/utils";

export type Recette = { id: string; nom: string; reglages: Reglages; peutSupprimer: boolean };

const GROUPES: Record<string, string> = {
  graphic: "Graphique",
  faithful: "Fidèle",
  dramatic: "Dramatique",
  soft: "Doux",
};

const champ = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-60";
const titre = "text-xs font-semibold uppercase tracking-wide text-foreground-muted";

function Nombre({
  label,
  valeur,
  onChange,
  min,
  max,
  pas = 1,
  aide,
}: {
  label: string;
  valeur: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  pas?: number;
  aide?: string;
}) {
  return (
    <label className="block text-xs text-foreground-muted">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={pas}
        value={valeur}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className={cn(champ, "mt-1")}
      />
      {aide && <span className="mt-0.5 block text-[11px]">{aide}</span>}
    </label>
  );
}

function Case({ label, valeur, onChange }: { label: string; valeur: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-foreground">
      <input type="checkbox" checked={valeur} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * Réglages avancés de la séparation (lot 5) : moteur, trame des écrans
 * (aplats, diffusion, Bayer, AM avec linéature et angles), production
 * (résolution des films, point minimum, recouvrement, rentré de la
 * sous-couche) et recettes enregistrées.
 */
export function ReglagesAvances({
  reglages,
  onChange,
  recettes,
  onEnregistrer,
  onSupprimer,
  maillage,
}: {
  reglages: Reglages;
  onChange: (r: Reglages) => void;
  recettes: Recette[];
  onEnregistrer: (nom: string) => Promise<boolean>;
  onSupprimer: (id: string) => Promise<void>;
  /** Maillage de l'écran (fils/cm) connu par la machine choisie, pour les conseils. */
  maillage?: number | null;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [nomRecette, setNomRecette] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const m = reglages.moteur;
  const r = reglages.rendu;
  const majMoteur = (v: Partial<Reglages["moteur"]>) => onChange({ ...reglages, moteur: { ...m, ...v } });
  const majRendu = (v: Rendu) => onChange({ ...reglages, rendu: v });
  const maillageConseil = r.type === "bayer" ? r.maillage : (maillage ?? null);

  function changerType(type: Rendu["type"]) {
    if (type === r.type) return;
    if (type === "aplat") majRendu({ type: "aplat" });
    else if (type === "diffusion") majRendu({ type: "diffusion", algo: "floyd-steinberg" });
    else if (type === "bayer") majRendu({ type: "bayer", maillage: maillage ?? 77 });
    else majRendu({ ...AM_DEFAUT, lpi: maillage ? Math.min(AM_DEFAUT.lpi, lpiMaxPourMaillage(maillage)) : AM_DEFAUT.lpi });
  }

  return (
    <section className="rounded-md border border-border">
      <button type="button" onClick={() => setOuvert(!ouvert)} className="flex w-full items-center justify-between px-3 py-2 text-left">
        <span className="text-sm font-medium text-foreground">
          Réglages avancés
          <span className="ml-2 text-xs font-normal text-foreground-muted">
            {LIBELLES_RENDU[r.type]}
            {r.type === "am" ? ` · ${r.lpi} lpi` : ""} · {reglages.ppp} ppp
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-foreground-muted transition-transform", ouvert && "rotate-180")} />
      </button>

      {ouvert && (
        <div className="space-y-5 border-t border-border p-3">
          {/* Recettes */}
          <div className="space-y-2">
            <p className={titre}>Recettes</p>
            <div className="flex flex-wrap items-end gap-2">
              <select
                value=""
                onChange={(e) => {
                  const rec = recettes.find((x) => x.id === e.target.value);
                  if (rec) onChange(rec.reglages);
                }}
                className={cn(champ, "w-56")}
                aria-label="Appliquer une recette"
              >
                <option value="">Appliquer une recette…</option>
                {recettes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nom}
                  </option>
                ))}
              </select>
              <input
                value={nomRecette}
                onChange={(e) => setNomRecette(e.target.value)}
                placeholder="Nom (ex. Photo sur tee-shirt noir)"
                maxLength={80}
                className={cn(champ, "w-64")}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={enregistrement}
                disabled={!nomRecette.trim()}
                onClick={async () => {
                  setEnregistrement(true);
                  if (await onEnregistrer(nomRecette.trim())) setNomRecette("");
                  setEnregistrement(false);
                }}
              >
                <Save className="h-3.5 w-3.5" /> Enregistrer ces réglages
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(REGLAGES_DEFAUT)}>
                Réglages par défaut
              </Button>
            </div>
            {recettes.some((x) => x.peutSupprimer) && (
              <ul className="flex flex-wrap gap-1.5">
                {recettes
                  .filter((x) => x.peutSupprimer)
                  .map((x) => (
                    <li key={x.id} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                      {x.nom}
                      <button type="button" aria-label={`Supprimer la recette ${x.nom}`} onClick={() => onSupprimer(x.id)} className="text-foreground-muted hover:text-danger">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* Moteur */}
          <div className="space-y-2">
            <p className={titre}>Séparation (moteur Reveal)</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs text-foreground-muted sm:col-span-2">
                Profil
                <select value={m.profil} onChange={(e) => majMoteur({ profil: e.target.value })} className={cn(champ, "mt-1")}>
                  <optgroup label="Adaptatifs">
                    {Object.entries(PROFILS_ADAPTATIFS).map(([id, nom]) => (
                      <option key={id} value={id}>
                        {nom}
                      </option>
                    ))}
                  </optgroup>
                  {Object.entries(GROUPES).map(([g, nomGroupe]) => {
                    const liste = ARCHETYPES.filter((a) => (a.groupe ?? "graphic") === g);
                    if (!liste.length) return null;
                    return (
                      <optgroup key={g} label={`Archétypes · ${nomGroupe}`}>
                        {liste.map((a) => (
                          <option key={a.id} value={a.id} title={a.description}>
                            {a.nom}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </label>
              <label className="block text-xs text-foreground-muted">
                Écart de couleur
                <select value={m.ecart} onChange={(e) => majMoteur({ ecart: e.target.value as Reglages["moteur"]["ecart"] })} className={cn(champ, "mt-1")}>
                  <option value="cie76">CIE76 (rapide)</option>
                  <option value="cie94">CIE94 (perceptuel)</option>
                  <option value="cie2000">CIE2000 (le plus fin)</option>
                </select>
              </label>
              <label className="block text-xs text-foreground-muted">
                Lissage (bruit JPEG)
                <select value={m.lissage} onChange={(e) => majMoteur({ lissage: e.target.value as Reglages["moteur"]["lissage"] })} className={cn(champ, "mt-1")}>
                  <option value="off">Aucun</option>
                  <option value="leger">Léger</option>
                  <option value="fort">Fort</option>
                </select>
              </label>
              <Nombre
                label="Couverture minimale (%)"
                valeur={m.couvertureMinPct}
                min={0}
                max={10}
                pas={0.1}
                onChange={(v) => majMoteur({ couvertureMinPct: v })}
                aide="Couleur plus rare : fusionnée dans sa voisine."
              />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              <Case label="Nettoyer les liserés de bord" valeur={m.nettoyage} onChange={(v) => majMoteur({ nettoyage: v })} />
              <Case label="Forcer le blanc" valeur={m.forcerBlanc} onChange={(v) => majMoteur({ forcerBlanc: v })} />
              <Case label="Forcer le noir" valeur={m.forcerNoir} onChange={(v) => majMoteur({ forcerNoir: v })} />
              <Case label="Niveaux de gris" valeur={m.niveauxDeGris} onChange={(v) => majMoteur({ niveauxDeGris: v })} />
            </div>
          </div>

          {/* Trame */}
          <div className="space-y-2">
            <p className={titre}>Trame des écrans</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(LIBELLES_RENDU) as Rendu["type"][]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => changerType(t)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    r.type === t ? "border-brand bg-brand/10 font-medium text-foreground" : "border-border text-foreground-muted hover:bg-surface-muted",
                  )}
                >
                  {LIBELLES_RENDU[t]}
                </button>
              ))}
            </div>
            {r.type === "diffusion" && (
              <label className="block max-w-xs text-xs text-foreground-muted">
                Algorithme
                <select value={r.algo} onChange={(e) => majRendu({ ...r, algo: e.target.value as typeof r.algo })} className={cn(champ, "mt-1")}>
                  <option value="floyd-steinberg">Floyd-Steinberg (équilibré)</option>
                  <option value="atkinson">Atkinson (contrasté, peu de points isolés)</option>
                  <option value="stucki">Stucki (le plus doux)</option>
                </select>
              </label>
            )}
            {r.type === "bayer" && (
              <div className="grid max-w-md gap-3 sm:grid-cols-2">
                <Nombre
                  label="Maillage de l'écran (fils/cm)"
                  valeur={r.maillage}
                  min={10}
                  max={200}
                  onChange={(v) => majRendu({ ...r, maillage: v })}
                  aide="Les cellules sont agrandies pour ne pas passer entre les fils (règle de 7)."
                />
              </div>
            )}
            {r.type === "am" && (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Nombre
                    label="Linéature (lpi)"
                    valeur={r.lpi}
                    min={10}
                    max={150}
                    onChange={(v) => majRendu({ ...r, lpi: v })}
                    aide={maillageConseil ? `Max conseillé : ${lpiMaxPourMaillage(maillageConseil)} lpi (${maillageConseil} fils/cm).` : "Textile : 35 à 65 lpi."}
                  />
                  <label className="block text-xs text-foreground-muted">
                    Forme du point
                    <select value={r.forme} onChange={(e) => majRendu({ ...r, forme: e.target.value as typeof r.forme })} className={cn(champ, "mt-1")}>
                      <option value="rond">Rond</option>
                      <option value="elliptique">Elliptique (transitions douces)</option>
                      <option value="ligne">Ligne</option>
                    </select>
                  </label>
                  <Nombre label="Point minimum (%)" valeur={r.pointMinPct} min={0} max={50} onChange={(v) => majRendu({ ...r, pointMinPct: v })} aide="Plus petit point qui tient." />
                  <Nombre label="Point maximum (%)" valeur={r.pointMaxPct} min={50} max={100} onChange={(v) => majRendu({ ...r, pointMaxPct: v })} aide="Au-delà : aplat plein." />
                </div>
                <div className="flex flex-wrap items-end gap-2 text-xs text-foreground-muted">
                  <Nombre
                    label="Angle de tous les écrans (°)"
                    valeur={r.angles[0] ?? ANGLE_AM_DEFAUT}
                    min={-90}
                    max={180}
                    pas={0.5}
                    onChange={(v) => majRendu({ ...r, angles: r.angles.map(() => v) })}
                  />
                  <span className="pb-1.5">L&apos;angle de chaque écran se règle aussi sur sa carte, sous « Écrans proposés ».</span>
                </div>
                {maillageConseil != null && r.lpi > lpiMaxPourMaillage(maillageConseil) && (
                  <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                    {r.lpi} lpi dépasse ce que tient un écran de {maillageConseil} fils/cm ({lpiMaxPourMaillage(maillageConseil)} lpi) : les points risquent de se perdre.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Production */}
          <div className="space-y-2">
            <p className={titre}>Films et production</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block text-xs text-foreground-muted">
                Résolution des films
                <select value={reglages.ppp} onChange={(e) => onChange({ ...reglages, ppp: Number(e.target.value) })} className={cn(champ, "mt-1")}>
                  {[300, 360, 450, 600, 720, 1200].map((v) => (
                    <option key={v} value={v}>
                      {v} ppp
                    </option>
                  ))}
                </select>
                <span className="mt-0.5 block text-[11px]">Trame AM : au moins 8 × la linéature.</span>
              </label>
              <Nombre
                label="Point minimum (mm)"
                valeur={reglages.pointMinMm}
                min={0}
                max={5}
                pas={0.1}
                onChange={(v) => onChange({ ...reglages, pointMinMm: v })}
                aide="Aplats : îlots plus petits retirés."
              />
              <Nombre
                label="Recouvrement (mm)"
                valeur={reglages.recouvrementMm}
                min={0}
                max={2}
                pas={0.05}
                onChange={(v) => onChange({ ...reglages, recouvrementMm: v })}
                aide="Aplats : clair sous foncé, contre les défauts de calage."
              />
              <Nombre
                label="Rentré sous-couche (mm)"
                valeur={reglages.rentreMm}
                min={0}
                max={2}
                pas={0.05}
                onChange={(v) => onChange({ ...reglages, rentreMm: v })}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
