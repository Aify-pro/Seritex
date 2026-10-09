"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Info, Loader2, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dessiner, lireImage, loupeRendu, renduApercu, separerPixels, type ResultatSeparation } from "@/lib/separation/client";
import { ANGLE_AM_DEFAUT, REGLAGES_DEFAUT, type Reglages } from "@/lib/separation/reglages";
import { ajusterImage, imageNeutre } from "@/lib/separation/image";
import { ENCRES_CMJN } from "@/lib/separation/trame";
import { Plus, X } from "lucide-react";
import type { Rendu } from "@/lib/separation/trame";
import { enregistrerRecette, supprimerRecette } from "@/app/(app)/infographie/separation/recettes-actions";
import { ReglagesAvances, type Recette } from "./reglages-avances";
import { ecranConvient, tientSurMachine, type EcranCadre, type Machine } from "@/lib/atelier/parc";
import { dimensionsFilms, surfacesCm2 } from "@/lib/separation/dimensions-films";
import type { EcranChiffre, ParametresSerigraphie } from "@/lib/separation/prix-revient";
import { PrixRevientSerigraphie } from "./prix-revient-serigraphie";
import { encreSousCouche, LIBELLES_QUALITE, qualite, rapprocher, type Encre, type Qualite } from "@/lib/separation/nuancier";
import { cn } from "@/lib/utils";

/** Fond en damier : montre ce qui n'est pas imprimé (fond retiré, transparence). */
const DAMIER = "bg-[length:16px_16px] bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)]";

/** En dessous de cette largeur, le visuel est trop petit pour faire des films nets. */
const LARGEUR_MIN_FILMS = 1000;

type Image = Awaited<ReturnType<typeof lireImage>>;

/** Rendu avec un angle AM pour chaque écran de couleur. */
function renduComplet(rendu: Rendu, n: number): Rendu {
  if (rendu.type !== "am") return rendu;
  const angles = Array.from({ length: Math.max(1, n) }, (_, i) => rendu.angles[i] ?? rendu.angles[0] ?? ANGLE_AM_DEFAUT);
  return { ...rendu, angles };
}
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
  parametres = null,
  quantite = null,
  recettes = [],
  machines = [],
  ecransParc = [],
}: {
  source: Blob | string;
  nom: string;
  /** Largeur du marquage connue (composition du site), en cm. */
  largeurCm?: number | null;
  /** Référence de la demande, reprise sur les films. */
  reference?: string | null;
  /** Encres de l'atelier : articles de la sous-famille Encres utilisables en séparation. */
  encres?: Encre[];
  /** Textile foncé connu (composition du site) : la sous-couche est conseillée. */
  textileFonce?: boolean;
  /** Paramètres de coût de la sérigraphie : présents seulement pour la Direction (droits Tarification). */
  parametres?: ParametresSerigraphie | null;
  /** Quantité connue (composition du site), pour le prix de revient. */
  quantite?: number | null;
  /** Recettes de réglages enregistrées (migration 0118). */
  recettes?: Recette[];
  /** Machines actives du parc (migration 0119). */
  machines?: Machine[];
  /** Écrans du parc : maillages, formats, disponibilité. */
  ecransParc?: EcranCadre[];
}) {
  const [image, setImage] = useState<Image | null>(null);
  const [nb, setNb] = useState<number | null>(null);
  const [resultatSepare, setResultat] = useState<ResultatSeparation | null>(null);
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
  const [reglages, setReglages] = useState<Reglages>(REGLAGES_DEFAUT);
  const [listeRecettes, setListeRecettes] = useState<Recette[]>(recettes);
  // Aperçu du rendu et loupe, marqués des réglages qui les ont produits.
  const [rendu, setRendu] = useState<{ cle: string; indices?: Uint8Array; tons?: Uint8Array[] } | null>(null);
  const [loupe, setLoupe] = useState<{ cle: string; url: string; cote: number } | null>(null);
  const [calculLoupe, setCalculLoupe] = useState(false);
  const moteur = JSON.stringify(reglages.moteur);
  const imageCle = JSON.stringify(reglages.image);
  // Palette imposée par l'infographiste (couleurs modifiées, supprimées, ajoutées) ; null = automatique.
  const [palette, setPalette] = useState<string[] | null>(null);
  const [ajout, setAjout] = useState("#000000");
  const paletteCle = palette ? JSON.stringify(palette) : "";
  const estCmjn = reglages.rendu.type === "cmjn";
  const [machineId, setMachineId] = useState<string>(machines[0]?.id ?? "");
  const maillagesParc = useMemo(() => [...new Set(ecransParc.map((e) => e.maillage))].sort((a, b) => a - b), [ecransParc]);
  const [maillage, setMaillage] = useState<number | null>(() => {
    // Maillage le plus courant parmi les écrans disponibles.
    const dispo = ecransParc.filter((e) => e.etat === "disponible");
    if (!dispo.length) return maillagesParc[0] ?? null;
    const compte = new Map<number, number>();
    for (const e of dispo) compte.set(e.maillage, (compte.get(e.maillage) ?? 0) + 1);
    return [...compte.entries()].sort((a, b) => b[1] - a[1])[0][0];
  });
  const machine = machines.find((m) => m.id === machineId) ?? null;

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
    const px = ajusterImage(image.px, image.w, image.h, JSON.parse(imageCle) as Reglages["image"]);
    const pal = paletteCle ? (JSON.parse(paletteCle) as string[]) : null;
    separerPixels(px, image.w, image.h, {
      ...(JSON.parse(moteur) as Reglages["moteur"]),
      ...(pal ? { palette: pal } : nb ? { nbCouleurs: nb } : {}),
    })
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
  }, [image, nb, moteur, imageCle, paletteCle]);

  // Résultat affiché : en quadrichromie, les 4 encres CMJN remplacent les couleurs séparées.
  const resultat = useMemo<ResultatSeparation | null>(
    () => (resultatSepare && estCmjn ? { ...resultatSepare, couleurs: ENCRES_CMJN.map((e) => ({ hex: e.hex, part: 0 })) } : resultatSepare),
    [resultatSepare, estCmjn],
  );
  const pxAjuste = useMemo(() => (image ? ajusterImage(image.px, image.w, image.h, JSON.parse(imageCle) as Reglages["image"]) : null), [image, imageCle]);

  // Aperçu du rendu choisi (trame) sur l'image d'analyse ; aplats = séparation telle quelle.
  const renduCle = JSON.stringify(reglages.rendu);
  const cleVue = `${renduCle}|${largeurCm}|${resultat?.couleurs.map((c) => c.hex).join(",") ?? ""}|${imageCle}`;
  useEffect(() => {
    if (!image || !resultat) return;
    const choisi = JSON.parse(renduCle) as Rendu;
    if (choisi.type === "aplat") return;
    let annule = false;
    const pppApercu = Math.max(30, image.w / (Math.max(2, largeurCm) / 2.54));
    const cle = `${renduCle}|${largeurCm}|${resultat.couleurs.map((c) => c.hex).join(",")}|${imageCle}`;
    renduApercu(ajusterImage(image.px, image.w, image.h, JSON.parse(imageCle) as Reglages["image"]), image.w, image.h, resultat, renduComplet(choisi, resultat.couleurs.length), pppApercu)
      .then((r) => !annule && setRendu({ cle, ...r }))
      .catch(() => !annule && setRendu(null));
    return () => {
      annule = true;
    };
  }, [image, resultat, renduCle, largeurCm, imageCle]);

  const original = useMemo(() => (typeof source === "string" ? source : URL.createObjectURL(source)), [source]);
  useEffect(() => () => {
    if (typeof source !== "string") URL.revokeObjectURL(original);
  }, [source, original]);

  const vueRendu = reglages.rendu.type !== "aplat" && rendu?.cle === cleVue ? rendu : undefined;
  const loupeVisible = loupe?.cle === `${cleVue}|${reglages.ppp}` ? loupe : null;
  // En quadrichromie, rien à montrer tant que les tons CMJN ne sont pas calculés.
  const pret = !!resultat && (!estCmjn || !!vueRendu?.tons);
  const apercu = useMemo(() => (resultat && pret ? dessiner(resultat, undefined, vueRendu) : null), [resultat, vueRendu, pret]);
  const ecrans = useMemo(() => (resultat && pret ? resultat.couleurs.map((_, i) => dessiner(resultat, i, vueRendu)) : []), [resultat, vueRendu, pret]);
  // Couverture moyenne de chaque encre CMJN sur le dessin (aperçu des tons).
  const partsCmjn = useMemo(() => {
    if (!estCmjn || !vueRendu?.tons) return null;
    const tons = vueRendu.tons;
    let dessinPx = 0;
    const sommes = tons.map(() => 0);
    for (let p = 0; p < tons[0].length; p++) {
      if (!tons.some((t) => t[p] > 0)) continue;
      dessinPx += 1;
      tons.forEach((t, k) => (sommes[k] += t[p]));
    }
    return sommes.map((x) => (dessinPx ? x / 255 / dessinPx : 0));
  }, [estCmjn, vueRendu]);
  const imageRetouchee = useMemo(() => {
    if (!pxAjuste || !image || imageNeutre(reglages.image)) return null;
    const c = document.createElement("canvas");
    c.width = image.w;
    c.height = image.h;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pxAjuste), image.w, image.h), 0, 0);
    return c.toDataURL("image/png");
  }, [pxAjuste, image, reglages.image]);

  const sousCoucheApercu = useMemo(
    () => (resultat && pret && avecSousCouche ? dessiner(resultat, "dessin", vueRendu) : null),
    [resultat, avecSousCouche, vueRendu, pret],
  );
  const proches = useMemo(() => (resultat ? resultat.couleurs.map((c) => rapprocher(c.hex, encres)) : []), [resultat, encres]);
  const encreDe = (i: number) => {
    const liste = proches[i] ?? [];
    return liste.find((x) => x.encre.id === choix[i]) ?? liste[0] ?? null;
  };
  const blanc = encreSousCouche(encres);

  const ecransChiffres = useMemo<EcranChiffre[]>(() => {
    if (!resultat || !parametres || !(largeurCm > 0)) return [];
    const surfaces = surfacesCm2(resultat, largeurCm);
    const out: EcranChiffre[] = [];
    if (avecSousCouche) {
      out.push({ libelle: `Sous-couche${blanc ? ` · ${blanc.nom}` : ""}`, surfaceCm2: surfaces.dessin, depotGm2: blanc?.depotGm2, prixKg: blanc?.prixKg });
    }
    resultat.couleurs.forEach((c, i) => {
      const e = encreDe(i)?.encre;
      // Quadrichromie : surface du dessin × couverture moyenne de l'encre.
      const surface = estCmjn ? surfaces.dessin * (partsCmjn?.[i] ?? 0) : surfaces.couleurs[i];
      const libelle = estCmjn ? `${ENCRES_CMJN[i].nom}${e ? ` · ${e.nom}` : ""}` : e ? `${e.nom} · ${c.hex}` : c.hex;
      out.push({ libelle, surfaceCm2: surface, depotGm2: e?.depotGm2, prixKg: e?.prixKg });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultat, parametres, largeurCm, avecSousCouche, blanc, choix, proches, estCmjn, partsCmjn]);

  const dims = useMemo(
    () => (resultat && largeurCm > 0 ? dimensionsFilms(resultat, largeurCm, reglages.ppp) : null),
    [resultat, largeurCm, reglages.ppp],
  );

  async function voirLoupe() {
    if (!resultat) return;
    setCalculLoupe(true);
    try {
      const l = await loupeRendu(source, resultat, renduComplet(reglages.rendu, resultat.couleurs.length), dims?.ppp ?? reglages.ppp, largeurCm, reglages.image);
      setLoupe({ cle: `${cleVue}|${reglages.ppp}`, ...l });
    } catch {
      toast.error("Aperçu de la trame impossible sur ce visuel");
    } finally {
      setCalculLoupe(false);
    }
  }

  async function enregistrer(nomRecette: string) {
    const res = await enregistrerRecette(nomRecette, reglages);
    if (res.error || !res.id) {
      toast.error("Recette non enregistrée", { description: res.error });
      return false;
    }
    setListeRecettes([...listeRecettes, { id: res.id, nom: nomRecette, reglages, peutSupprimer: true }].sort((a, b) => a.nom.localeCompare(b.nom, "fr")));
    toast.success(`Recette « ${nomRecette} » enregistrée`);
    return true;
  }

  async function supprimer(id: string) {
    const res = await supprimerRecette(id);
    if (res.error) toast.error("Recette non supprimée", { description: res.error });
    else setListeRecettes(listeRecettes.filter((x) => x.id !== id));
  }

  const couleursActuelles = () => (resultatSepare ? resultatSepare.couleurs.map((c) => c.hex) : []);
  function modifierPalette(p: string[]) {
    setCalcul(true);
    setPalette(p);
  }
  function modifierCouleur(i: number, hex: string) {
    modifierPalette(couleursActuelles().map((h, j) => (j === i ? hex : h)));
  }
  function supprimerCouleur(i: number) {
    modifierPalette(couleursActuelles().filter((_, j) => j !== i));
  }
  function ajouterCouleur(hex: string) {
    const actuelles = couleursActuelles();
    if (actuelles.includes(hex) || actuelles.length >= 15) return;
    modifierPalette([...actuelles, hex]);
  }

  function angleEcran(i: number, v: number) {
    if (reglages.rendu.type !== "am" || !resultat) return;
    const r = renduComplet(reglages.rendu, resultat.couleurs.length) as Extract<Rendu, { type: "am" }>;
    setReglages({ ...reglages, rendu: { ...r, angles: r.angles.map((a, j) => (j === i ? v : a)) } });
  }

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
          sousCouche: avecSousCouche ? { nom: blanc ? libelleEncre(blanc) : "Blanc", rentreMm: reglages.rentreMm } : null,
          rendu: renduComplet(reglages.rendu, resultat.couleurs.length),
          ppp: reglages.ppp,
          pointMinMm: reglages.pointMinMm,
          recouvrementMm: reglages.recouvrementMm,
          image: reglages.image,
          largeurAnalyse: resultat.largeur,
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
          {palette && !estCmjn && <span className="ml-2 text-xs font-normal text-brand">palette manuelle</span>}
          {estCmjn && <span className="ml-2 text-xs font-normal text-brand">quadrichromie</span>}
          {calcul && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-foreground-muted" />}
        </p>
        <label className="flex items-center gap-2 text-foreground-muted">
          Nombre de couleurs
          <select
            value={palette ? "auto" : (nb ?? "auto")}
            onChange={(e) => changerNb(e.target.value)}
            disabled={!image || !!palette || estCmjn}
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

      <ReglagesAvances
        reglages={reglages}
        onChange={(r) => {
          if (JSON.stringify(r.moteur) !== moteur) setCalcul(true);
          setReglages(r);
        }}
        recettes={listeRecettes}
        onEnregistrer={enregistrer}
        onSupprimer={supprimer}
        maillage={maillage}
      />

      {resultat && (machines.length > 0 || ecransParc.length > 0) && dims && (
        <ParcAlertes
          machines={machines}
          machine={machine}
          onMachine={setMachineId}
          maillages={maillagesParc}
          maillage={maillage}
          onMaillage={setMaillage}
          ecransParc={ecransParc}
          nEcrans={nEcrans}
          largeurCm={largeurCm}
          hauteurCm={dims.hauteurCm}
        />
      )}

      {resultat && (
        <ul className="space-y-1.5 text-xs">
          <li className="flex gap-2 text-foreground-muted">
            <Info className="h-4 w-4 shrink-0" />
            Fidélité : écart moyen ΔE {resultat.ecartMoyen.toLocaleString("fr-FR")}
            {resultat.ecartMoyen < 4 ? " (excellente)" : resultat.ecartMoyen < 8 ? " (bonne)" : " (visuel simplifié)"} · profil {resultat.profil}
          </li>
          {resultat.degrade && (
            <li className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Dégradé ou photo : ces couleurs simplifient le visuel. Ajustez le nombre de couleurs ou choisissez une trame (Réglages avancés).
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
          <figcaption className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
            {imageRetouchee ? "Visuel retouché (réglages de l'image)" : "Visuel du client"}
          </figcaption>
          <div className={cn("flex aspect-square items-center justify-center rounded-md border border-border p-3", DAMIER)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageRetouchee ?? original} alt={nom} className="max-h-full max-w-full object-contain" />
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

      {resultat && reglages.rendu.type !== "aplat" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" loading={calculLoupe} onClick={voirLoupe}>
              <ZoomIn className="h-3.5 w-3.5" /> Voir la trame à 100 %
            </Button>
            <span className="text-xs text-foreground-muted">
              {reglages.rendu.type === "am"
                ? "L'aperçu ci-dessus montre les tons ; la loupe montre les vrais points du film."
                : "La loupe montre le film à sa vraie résolution."}
            </span>
          </div>
          {loupeVisible && (
            <figure className="space-y-1">
              <figcaption className="text-xs text-foreground-muted">
                Carré de 2,5 cm au centre du dessin, à {dims?.ppp ?? reglages.ppp} ppp (agrandi 2 fois)
              </figcaption>
              <div className="overflow-auto rounded-md border border-border bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={loupeVisible.url} alt="Trame à 100 %" style={{ width: loupeVisible.cote * 2, maxWidth: "none" }} className="[image-rendering:pixelated]" />
              </div>
            </figure>
          )}
        </div>
      )}

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
                    {blanc ? libelleEncre(blanc) : "Blanc (aucune encre marquée « Sous-couche »)"}
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
                      <span className="font-medium">{estCmjn ? ENCRES_CMJN[i].nom : c.hex}</span>
                      <span className="ml-auto text-xs text-foreground-muted">
                        {Math.max(estCmjn ? 0 : 1, Math.round((estCmjn ? (partsCmjn?.[i] ?? 0) : c.part) * 100))} %
                      </span>
                    </span>
                  </button>
                  {!estCmjn && (
                    <div className="mt-1 flex items-center gap-1.5 px-0.5 text-xs text-foreground-muted">
                      <input
                        type="color"
                        value={c.hex.toLowerCase()}
                        onChange={(e) => modifierCouleur(i, e.target.value.toUpperCase())}
                        aria-label={`Modifier la couleur ${c.hex}`}
                        title="Modifier la couleur : la séparation se refait sur la palette modifiée"
                        className="h-6 w-8 cursor-pointer rounded border border-border bg-surface p-0.5"
                      />
                      Modifier
                      <button
                        type="button"
                        onClick={() => supprimerCouleur(i)}
                        disabled={resultat.couleurs.length < 2}
                        aria-label={`Supprimer la couleur ${c.hex}`}
                        title="Supprimer cette couleur : ses pixels rejoignent la plus proche"
                        className="ml-auto rounded p-0.5 hover:bg-surface-muted hover:text-danger disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {reglages.rendu.type === "am" && (
                    <label className="mt-1 flex items-center gap-1.5 px-0.5 text-xs text-foreground-muted">
                      Angle
                      <input
                        type="number"
                        step={0.5}
                        min={-90}
                        max={180}
                        value={renduComplet(reglages.rendu, n).type === "am" ? (renduComplet(reglages.rendu, n) as Extract<Rendu, { type: "am" }>).angles[i] : ANGLE_AM_DEFAUT}
                        onChange={(e) => Number.isFinite(Number(e.target.value)) && angleEcran(i, Number(e.target.value))}
                        className="h-7 w-20 rounded-md border border-border bg-surface px-1.5 text-xs text-foreground"
                        aria-label={`Angle de trame de l'écran ${c.hex}`}
                      />
                      °
                    </label>
                  )}
                  {encre && !estCmjn && (
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
          {!estCmjn && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
              <span className="flex items-center gap-1.5">
                <input type="color" value={ajout.toLowerCase()} onChange={(e) => setAjout(e.target.value.toUpperCase())} className="h-7 w-9 cursor-pointer rounded border border-border bg-surface p-0.5" aria-label="Couleur à ajouter" />
                <Button type="button" size="sm" variant="secondary" onClick={() => ajouterCouleur(ajout)}>
                  <Plus className="h-3.5 w-3.5" /> Ajouter cette couleur
                </Button>
              </span>
              {resultat.suggestions.length > 0 && (
                <span className="flex flex-wrap items-center gap-1.5">
                  Couleurs suggérées par le moteur :
                  {resultat.suggestions.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => ajouterCouleur(h)}
                      title={`Ajouter ${h}`}
                      className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 hover:bg-surface-muted"
                    >
                      <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: h }} />
                      {h}
                    </button>
                  ))}
                </span>
              )}
              {palette && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setPalette(null)}>
                  Revenir à la palette automatique
                </Button>
              )}
            </div>
          )}
          {encres.length === 0 && (
            <p className="text-xs text-foreground-muted">
              Aucune encre : créez vos encres comme articles (famille Consommables › Encres, options sérigraphie dans la fiche) pour que chaque écran propose l&apos;encre la plus proche.
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
              {nEcrans} page{nEcrans > 1 ? "s" : ""}, un écran par page en noir, avec cibles de calage
              {reglages.rendu.type === "am" ? ` · trame AM ${reglages.rendu.lpi} lpi` : reglages.rendu.type !== "aplat" ? " · tramés" : ""} · dessin de{" "}
              {largeurCm.toLocaleString("fr-FR")} × {dims.hauteurCm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} cm · {dims.ppp} ppp
              {dims.ppp < reglages.ppp ? ` (${reglages.ppp} ppp demandés : limite du navigateur à cette taille)` : ""}
            </p>
          )}
          {etapeFilms && <p className="text-xs text-foreground-muted">{etapeFilms}</p>}
          {erreurFilms && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{erreurFilms}</p>}
        </section>
      )}

      {parametres && ecransChiffres.length > 0 && (
        <PrixRevientSerigraphie
          parametres={parametres}
          ecrans={ecransChiffres}
          quantiteInitiale={quantite}
          machine={machine ? { nom: machine.nom, nbTetes: machine.nbTetes, cadencePiecesH: machine.cadencePiecesH, coutHoraire: machine.coutHoraire } : null}
        />
      )}

      <p className="text-xs text-foreground-muted">
        Proposition automatique, à valider : le choix final des encres et le contrôle des films avant insolation restent faits par l&apos;infographie.
      </p>
    </div>
  );
}

/** Machine et écrans du parc : choix, et ce qui ne passe pas (têtes, format, écrans disponibles). */
function ParcAlertes({
  machines,
  machine,
  onMachine,
  maillages,
  maillage,
  onMaillage,
  ecransParc,
  nEcrans,
  largeurCm,
  hauteurCm,
}: {
  machines: Machine[];
  machine: Machine | null;
  onMachine: (id: string) => void;
  maillages: number[];
  maillage: number | null;
  onMaillage: (m: number | null) => void;
  ecransParc: EcranCadre[];
  nEcrans: number;
  largeurCm: number;
  hauteurCm: number;
}) {
  const disponibles = ecransParc.filter((e) => e.etat === "disponible" && (maillage == null || e.maillage === maillage));
  const convenables = disponibles.filter((e) => ecranConvient(e, largeurCm, hauteurCm));
  const alertes: string[] = [];
  if (machine && nEcrans > machine.nbTetes) {
    const passages = Math.ceil(nEcrans / machine.nbTetes);
    alertes.push(`${nEcrans} écrans pour ${machine.nbTetes} têtes : ${passages} passages sur ${machine.nom}, ou réduisez le nombre de couleurs.`);
  }
  if (machine && !tientSurMachine(machine, largeurCm, hauteurCm)) {
    alertes.push(
      `Le dessin (${largeurCm.toLocaleString("fr-FR")} × ${hauteurCm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} cm) dépasse le format d'impression de ${machine.nom} (${machine.formatMaxLCm} × ${machine.formatMaxHCm} cm).`,
    );
  }
  if (ecransParc.length > 0 && convenables.length < nEcrans) {
    alertes.push(
      `${convenables.length} écran${convenables.length > 1 ? "s" : ""} disponible${convenables.length > 1 ? "s" : ""}${maillage ? ` en ${maillage} fils/cm` : ""} au bon format pour ${nEcrans} écran${nEcrans > 1 ? "s" : ""} à insoler.`,
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {machines.length > 0 && (
          <label className="flex items-center gap-2 text-foreground-muted">
            Machine
            <select value={machine?.id ?? ""} onChange={(e) => onMachine(e.target.value)} className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground">
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom} · {m.nbTetes} têtes{m.cadencePiecesH ? ` · ${m.cadencePiecesH} p/h` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {maillages.length > 0 && (
          <label className="flex items-center gap-2 text-foreground-muted">
            Maillage
            <select
              value={maillage ?? ""}
              onChange={(e) => onMaillage(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {maillages.map((m) => (
                <option key={m} value={m}>
                  {m} fils/cm ({ecransParc.filter((e) => e.maillage === m && e.etat === "disponible").length} disponibles)
                </option>
              ))}
            </select>
          </label>
        )}
        {alertes.length === 0 && <span className="text-success">Machine, format et écrans disponibles : tout passe.</span>}
      </div>
      {alertes.map((a) => (
        <p key={a} className="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {a}
        </p>
      ))}
    </div>
  );
}
