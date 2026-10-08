"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { dessiner, lireImage, separerPixels, type ResultatSeparation } from "@/lib/separation/client";
import { cn } from "@/lib/utils";

/** Fond en damier : montre ce qui n'est pas imprimé (fond retiré, transparence). */
const DAMIER = "bg-[length:16px_16px] bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)]";

/** En dessous de cette largeur, le visuel est trop petit pour faire des films nets. */
const LARGEUR_MIN_FILMS = 1000;

type Image = Awaited<ReturnType<typeof lireImage>>;

/**
 * Séparation des couleurs d'un visuel client avec le moteur Reveal :
 * proposition des encres (une par écran), aperçu recomposé et écran de
 * chaque couleur en noir sur blanc. Proposition à valider par l'infographie.
 */
export function SeparationCouleurs({ source, nom }: { source: Blob | string; nom: string }) {
  const [image, setImage] = useState<Image | null>(null);
  const [nb, setNb] = useState<number | null>(null);
  const [resultat, setResultat] = useState<ResultatSeparation | null>(null);
  const [calcul, setCalcul] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actif, setActif] = useState<number | null>(null);

  useEffect(() => {
    let annule = false;
    lireImage(source)
      .then((img) => !annule && setImage(img))
      .catch(() => {
        if (annule) return;
        setErreur("Ce fichier ne peut pas être lu comme une image (PNG, JPEG, WebP ou SVG).");
        setCalcul(false);
      });
    return () => {
      annule = true;
    };
  }, [source]);

  useEffect(() => {
    if (!image) return;
    let annule = false;
    // Copie : le tableau part vers le worker à chaque calcul.
    separerPixels(new Uint8ClampedArray(image.px), image.w, image.h, nb ? { nbCouleurs: nb } : {})
      .then((r) => {
        if (annule) return;
        setResultat(r);
        setErreur(null);
        setActif(null);
      })
      .catch(() => !annule && setErreur("La séparation a échoué sur ce visuel."))
      .finally(() => !annule && setCalcul(false));
    return () => {
      annule = true;
    };
  }, [image, nb]);

  const original = useMemo(() => (typeof source === "string" ? source : URL.createObjectURL(source)), [source]);
  useEffect(() => () => {
    if (typeof source !== "string") URL.revokeObjectURL(original);
  }, [source, original]);

  const apercu = useMemo(() => (resultat ? dessiner(resultat) : null), [resultat]);
  const ecrans = useMemo(() => (resultat ? resultat.couleurs.map((_, i) => dessiner(resultat, i)) : []), [resultat]);

  function changerNb(valeur: string) {
    setCalcul(true);
    setNb(valeur === "auto" ? null : Number(valeur));
  }

  if (erreur && !resultat) {
    return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erreur}</p>;
  }

  const n = resultat?.couleurs.length ?? 0;
  const couleurActive = actif !== null ? resultat?.couleurs[actif] : null;
  const vue = actif !== null ? ecrans[actif] : apercu;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-foreground">
          {resultat ? `${n} couleur${n > 1 ? "s" : ""} → ${n} écran${n > 1 ? "s" : ""}` : "Analyse du visuel…"}
          {calcul && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-foreground-muted" />}
        </p>
        <label className="flex items-center gap-2 text-foreground-muted">
          Nombre de couleurs
          <select
            value={nb ?? "auto"}
            onChange={(e) => changerNb(e.target.value)}
            disabled={!image}
            className="h-8 rounded-md border border-border bg-surface px-2 text-foreground"
          >
            <option value="auto">Automatique</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {resultat && (
        <ul className="space-y-1.5 text-xs">
          {resultat.degrade && (
            <li className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Dégradé ou photo : ces couleurs simplifient le visuel. Ajustez le nombre de couleurs ou prévoyez une trame.
            </li>
          )}
          {(resultat.fond || resultat.transparent) && (
            <li className="flex gap-2 text-foreground-muted">
              <Info className="h-4 w-4 shrink-0" />
              {resultat.fond ? `Fond ${resultat.fond} retiré : il n'est pas imprimé.` : "Fond transparent : seul le dessin est imprimé."}
            </li>
          )}
          {image && image.largeurOrigine < LARGEUR_MIN_FILMS && (
            <li className="flex gap-2 text-foreground-muted">
              <Info className="h-4 w-4 shrink-0" />
              Visuel de {image.largeurOrigine} px de large : suffisant pour choisir les couleurs, demandez le fichier source pour les films.
            </li>
          )}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="space-y-1">
          <figcaption className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Visuel du client</figcaption>
          <div className={cn("flex aspect-square items-center justify-center rounded-md border border-border p-3", DAMIER)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={original} alt={nom} className="max-h-full max-w-full object-contain" />
          </div>
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {couleurActive ? `Écran ${(actif ?? 0) + 1} · ${couleurActive.hex}` : `Aperçu en ${n} couleur${n > 1 ? "s" : ""}`}
          </figcaption>
          <div
            className={cn(
              "flex aspect-square items-center justify-center rounded-md border border-border p-3",
              couleurActive ? "bg-white" : DAMIER,
            )}
          >
            {vue && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vue}
                alt={couleurActive ? `Écran ${couleurActive.hex}` : "Aperçu séparé"}
                className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
              />
            )}
          </div>
        </figure>
      </div>

      {resultat && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Écrans proposés</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {resultat.couleurs.map((c, i) => (
              <li key={`${c.hex}-${i}`}>
                <button
                  type="button"
                  onClick={() => setActif(actif === i ? null : i)}
                  className={cn(
                    "w-full rounded-md border p-2 text-left transition-colors hover:bg-surface-muted",
                    actif === i ? "border-brand ring-1 ring-brand" : "border-border",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ecrans[i]} alt="" className="aspect-square w-full rounded border border-border bg-white object-contain" />
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: c.hex }} />
                    <span className="font-medium">{c.hex}</span>
                    <span className="ml-auto text-xs text-foreground-muted">{Math.max(1, Math.round(c.part * 100))} %</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-foreground-muted">
        Proposition automatique, à valider : le choix final des encres et la préparation des films restent faits par l&apos;infographie.
      </p>
    </div>
  );
}
