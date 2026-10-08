"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dessiner, lireImage, separerPixels, type ResultatSeparation } from "@/lib/separation/client";
import { dimensionsFilms, PPP_FILMS } from "@/lib/separation/dimensions-films";
import { encreSousCouche, LIBELLES_QUALITE, qualite, rapprocher, type Encre, type Qualite } from "@/lib/separation/nuancier";
import { cn } from "@/lib/utils";

/** Fond en damier : montre ce qui n'est pas imprimé (fond retiré, transparence). */
const DAMIER = "bg-[length:16px_16px] bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)]";

/** En dessous de cette largeur, le visuel est trop petit pour faire des films nets. */
const LARGEUR_MIN_FILMS = 1000;

type Image = Awaited<ReturnType<typeof lireImage>>;

/** Rentré de la sous-couche sous les couleurs, en mm. */
const RENTRE_SOUS_COUCHE_MM = 0.2;
/** Vue « sous-couche » dans l'aperçu (les écrans de couleur sont numérotés à partir de 0). */
const SOUS_COUCHE = -1;

const TONS_QUALITE: Record<Qualite, string> = {
  identique: "text-success",
  proche: "text-foreground-muted",
  "a-melanger": "text-warning",
};

const libelleEncre = (e: Encre) => (e.reference ? `${e.nom} (${e.reference})` : e.nom);

/**
 * Séparation des couleurs d'un visuel client avec le moteur Reveal :
 * proposition des encres (une par écran), aperçu recomposé et écran de
 * chaque couleur en noir sur blanc. Proposition à valider par l'infographie.
 */
export function SeparationCouleurs({
  source,
  nom,
  largeurCm: largeurInitiale,
  reference,
  encres = [],
  textileFonce = false,
}: {
  source: Blob | string;
  nom: string;
  /** Largeur du marquage connue (composition du site), en cm. */
  largeurCm?: number | null;
  /** Référence de la demande, reprise sur les films. */
  reference?: string | null;
  /** Nuancier d'encres actives (Paramètres > Nuancier d'encres). */
  encres?: Encre[];
  /** Textile foncé connu (composition du site) : la sous-couche est conseillée. */
  textileFonce?: boolean;
}) {
  const [image, setImage] = useState<Image | null>(null);
  const [nb, setNb] = useState<number | null>(null);
  const [resultat, setResultat] = useState<ResultatSeparation | null>(null);
  const [calcul, setCalcul] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [actif, setActif] = useState<number | null>(null);
  const [largeurCm, setLargeurCm] = useState(largeurInitiale && largeurInitiale > 0 ? largeurInitiale : 25);
  const [miroir, setMiroir] = useState(false);
  const [etapeFilms, setEtapeFilms] = useState<string | null>(null);
  const [erreurFilms, setErreurFilms] = useState<string | null>(null);
  // Encre choisie par écran (id), quand l'infographiste change la proposition.
  const [choix, setChoix] = useState<Record<number, string>>({});
  const [avecSousCouche, setAvecSousCouche] = useState(false);

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
        setChoix({});
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

  const sousCoucheApercu = useMemo(() => (resultat && avecSousCouche ? dessiner(resultat, "dessin") : null), [resultat, avecSousCouche]);
  const proches = useMemo(() => (resultat ? resultat.couleurs.map((c) => rapprocher(c.hex, encres)) : []), [resultat, encres]);
  const encreDe = (i: number) => {
    const liste = proches[i] ?? [];
    return liste.find((x) => x.encre.id === choix[i]) ?? liste[0] ?? null;
  };
  const blanc = encreSousCouche(encres);

  const dims = useMemo(() => (resultat && largeurCm > 0 ? dimensionsFilms(resultat, largeurCm) : null), [resultat, largeurCm]);

  async function telechargerFilms() {
    if (!resultat) return;
    setErreurFilms(null);
    setEtapeFilms("Préparation…");
    try {
      const { preparerFilms } = await import("@/lib/separation/films");
      const pdf = await preparerFilms(
        source,
        resultat,
        {
          largeurCm,
          miroir,
          nom,
          reference,
          encres: resultat.couleurs.map((_, i) => {
            const e = encreDe(i);
            return e ? libelleEncre(e.encre) : null;
          }),
          sousCouche: avecSousCouche ? { nom: blanc ? libelleEncre(blanc) : "Blanc", rentreMm: RENTRE_SOUS_COUCHE_MM } : null,
        },
        setEtapeFilms,
      );
      const url = URL.createObjectURL(pdf);
      const a = document.createElement("a");
      a.href = url;
      a.download = `films-${nom.replace(/\.[^.]+$/, "")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErreurFilms("Les films n'ont pas pu être préparés (visuel illisible ou mémoire insuffisante : essayez une largeur plus petite).");
    } finally {
      setEtapeFilms(null);
    }
  }

  function changerNb(valeur: string) {
    setCalcul(true);
    setNb(valeur === "auto" ? null : Number(valeur));
  }

  if (erreur && !resultat) {
    return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{erreur}</p>;
  }

  const n = resultat?.couleurs.length ?? 0;
  const nEcrans = n + (avecSousCouche ? 1 : 0);
  const couleurActive = actif !== null && actif >= 0 ? resultat?.couleurs[actif] : null;
  const vue = actif === SOUS_COUCHE ? sousCoucheApercu : actif !== null ? ecrans[actif] : apercu;
  const titreVue =
    actif === SOUS_COUCHE
      ? "Sous-couche blanche"
      : couleurActive
        ? `Écran ${(actif ?? 0) + 1 + (avecSousCouche ? 1 : 0)} · ${encreDe(actif ?? 0)?.encre.nom ?? couleurActive.hex}`
        : `Aperçu en ${n} couleur${n > 1 ? "s" : ""}`;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-foreground">
          {resultat
            ? `${n} couleur${n > 1 ? "s" : ""} → ${nEcrans} écran${nEcrans > 1 ? "s" : ""}${avecSousCouche ? " (dont la sous-couche)" : ""}`
            : "Analyse du visuel…"}
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
            {titreVue}
          </figcaption>
          <div
            className={cn(
              "flex aspect-square items-center justify-center rounded-md border border-border p-3",
              actif !== null ? "bg-white" : DAMIER,
            )}
          >
            {vue && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={vue}
                alt={titreVue}
                className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
              />
            )}
          </div>
        </figure>
      </div>

      {resultat && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Écrans proposés</p>
          <label
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-xs",
              textileFonce ? "bg-warning-soft text-warning" : "text-foreground-muted",
            )}
          >
            <input
              type="checkbox"
              checked={avecSousCouche}
              onChange={(e) => {
                setAvecSousCouche(e.target.checked);
                if (!e.target.checked && actif === SOUS_COUCHE) setActif(null);
              }}
            />
            <span className="font-medium text-foreground">Sous-couche blanche</span>
            {textileFonce
              ? "— textile foncé : conseillée, sous toutes les couleurs (écran imprimé en premier)."
              : "— pour un textile foncé : un écran blanc sous toutes les couleurs, imprimé en premier."}
          </label>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {avecSousCouche && sousCoucheApercu && (
              <li>
                <button
                  type="button"
                  onClick={() => setActif(actif === SOUS_COUCHE ? null : SOUS_COUCHE)}
                  className={cn(
                    "w-full rounded-md border p-2 text-left transition-colors hover:bg-surface-muted",
                    actif === SOUS_COUCHE ? "border-brand ring-1 ring-brand" : "border-border",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sousCoucheApercu} alt="" className="aspect-square w-full rounded border border-border bg-white object-contain" />
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: blanc?.hex ?? "#FFFFFF" }} />
                    <span className="font-medium">Sous-couche</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-foreground-muted">
                    {blanc ? libelleEncre(blanc) : "Blanc (aucune encre « Sous-couche » au nuancier)"}
                  </span>
                </button>
              </li>
            )}
            {resultat.couleurs.map((c, i) => {
              const encre = encreDe(i);
              const q = encre ? qualite(encre.ecart) : null;
              return (
                <li key={`${c.hex}-${i}`} className="rounded-md">
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
                  {encre && (
                    <div className="mt-1 space-y-0.5 px-0.5">
                      <select
                        value={encre.encre.id}
                        onChange={(e) => setChoix({ ...choix, [i]: e.target.value })}
                        aria-label={`Encre de l'écran ${c.hex}`}
                        className="h-7 w-full rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
                      >
                        {(proches[i] ?? []).map((x) => (
                          <option key={x.encre.id} value={x.encre.id}>
                            {libelleEncre(x.encre)}
                          </option>
                        ))}
                      </select>
                      <p className={cn("flex items-center gap-1 text-xs", TONS_QUALITE[q!])}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-border" style={{ backgroundColor: encre.encre.hex }} />
                        {LIBELLES_QUALITE[q!]}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {encres.length === 0 && (
            <p className="text-xs text-foreground-muted">
              Nuancier d&apos;encres vide : ajoutez vos encres dans Paramètres pour que chaque écran propose l&apos;encre la plus proche.
            </p>
          )}
        </div>
      )}

      {resultat && (
        <section className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Films à taille réelle</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-foreground-muted">
              Largeur du marquage (cm)
              <input
                type="number"
                min={2}
                max={60}
                step={0.5}
                value={largeurCm}
                onChange={(e) => setLargeurCm(Number(e.target.value))}
                className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <label className="flex h-8 items-center gap-2 text-xs text-foreground-muted">
              <input type="checkbox" checked={miroir} onChange={(e) => setMiroir(e.target.checked)} />
              Miroir
            </label>
            <Button type="button" size="sm" onClick={telechargerFilms} loading={!!etapeFilms} disabled={calcul || !(largeurCm >= 2 && largeurCm <= 60)}>
              <Download className="h-3.5 w-3.5" />
              Télécharger les films (PDF)
            </Button>
          </div>
          {dims && (
            <p className="text-xs text-foreground-muted">
              {nEcrans} page{nEcrans > 1 ? "s" : ""}, un écran par page en noir, avec cibles de calage · dessin de{" "}
              {largeurCm.toLocaleString("fr-FR")} × {dims.hauteurCm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} cm · {dims.ppp} ppp
              {dims.ppp < PPP_FILMS ? " (limite du navigateur à cette taille)" : ""}
            </p>
          )}
          {etapeFilms && <p className="text-xs text-foreground-muted">{etapeFilms}</p>}
          {erreurFilms && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{erreurFilms}</p>}
        </section>
      )}

      <p className="text-xs text-foreground-muted">
        Proposition automatique, à valider : le choix final des encres et le contrôle des films avant insolation restent faits par l&apos;infographie.
      </p>
    </div>
  );
}
