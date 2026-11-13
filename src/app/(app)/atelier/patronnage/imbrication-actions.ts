"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { deposerFichierTrace } from "@/lib/patronnage/depot-trace";
import {
  annulerCalculImbrication,
  creerCalculImbrication,
  declencherTraitement,
  lireCalculImbrication,
  PREREGLAGES_TEMPS,
} from "@/lib/imbrication/calculs";
import { entreeSchema, LIBELLES_ARRET } from "@/lib/imbrication/contrat";
import { genererDxfImbrication } from "@/lib/imbrication/export-dxf";
import { validerTrace } from "@/lib/imbrication/validation";
import { chargerRouleauxTrace } from "./fiches-actions";

/**
 * Calcul automatique d'un tracé (imbrication Seritex), depuis la fenêtre
 * d'un tracé du module patronnage. Voie FACULTATIVE : le dépôt d'un fichier
 * Modaris / Diamino reste possible à tout moment et suit le même chemin
 * (`deposerFichierTrace`).
 *
 * Le calcul part des pièces par couche du tracé et compare, si on le
 * demande, plusieurs laizes (celles des rouleaux) : un calcul par laize,
 * lancés ensemble. Un calcul terminé est une PROPOSITION ; il ne devient le
 * fichier du tracé que lorsqu'une personne choisit « Utiliser ce tracé ».
 */

const STATUTS_MODIFIABLES = ["previsionnel", "en_preparation"];

export interface LaizeCandidate {
  laizeCm: number;
  /** D'où vient cette laize : rouleaux choisis, rouleaux en stock, saisie. */
  origine: "rouleaux_choisis" | "stock" | "trace" | "fiche";
  nbRouleaux: number;
  poidsKg: number;
}

export interface PieceParCouche {
  semiFiniId: string;
  semiFiniNom: string;
  taille: string;
  quantite: number;
}

export interface ContexteCalculTrace {
  pieces: PieceParCouche[];
  laizes: LaizeCandidate[];
  forme: "ouvert" | "tubulaire";
  /** Raison pour laquelle le calcul ne peut pas être lancé, sinon null. */
  blocage: string | null;
  modifiable: boolean;
  imbricationCalculId: string | null;
  prereglages: typeof PREREGLAGES_TEMPS;
}

async function lireTrace(traceId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("traces_placement")
    .select("id,fiche_id,statut,forme,largeur_matelas_cm,imbrication_calcul_id,fiches_placement(statut,laize_utile_cm)")
    .eq("id", traceId)
    .maybeSingle();
  return { supabase, trace: data };
}

export async function contexteCalculTrace(traceId: string): Promise<ContexteCalculTrace | { error: string }> {
  await requirePermission("patronnage", "view");
  const { supabase, trace } = await lireTrace(traceId);
  if (!trace) return { error: "Tracé introuvable." };
  const fiche = (Array.isArray(trace.fiches_placement) ? trace.fiches_placement[0] : trace.fiches_placement) as {
    statut: string;
    laize_utile_cm: number | null;
  } | null;

  const { data: lignes } = await supabase
    .from("trace_semi_finis")
    .select("semi_fini_id,taille,quantite_par_couche,product_models(name)")
    .eq("trace_id", traceId);
  const pieces: PieceParCouche[] = ((lignes ?? []) as unknown as { semi_fini_id: string; taille: string; quantite_par_couche: number; product_models: { name: string } | null }[])
    .filter((l) => l.quantite_par_couche > 0)
    .map((l) => ({ semiFiniId: l.semi_fini_id, semiFiniNom: l.product_models?.name ?? "Semi-fini", taille: l.taille, quantite: l.quantite_par_couche }))
    .sort((a, b) => a.semiFiniNom.localeCompare(b.semiFiniNom) || a.taille.localeCompare(b.taille));

  // Laizes : rouleaux choisis pour le tracé, sinon rouleaux en stock du tissu
  // du tracé ; plus la laize saisie sur le tracé ou la fiche.
  const parLaize = new Map<number, LaizeCandidate>();
  const ajouter = (laizeCm: number | null | undefined, origine: LaizeCandidate["origine"], poidsKg = 0, rouleau = false) => {
    const l = Number(laizeCm);
    if (!Number.isFinite(l) || l <= 0) return;
    const cle = Math.round(l * 10) / 10;
    const e = parLaize.get(cle);
    if (e) {
      if (rouleau) {
        e.nbRouleaux += 1;
        e.poidsKg += poidsKg;
      }
      return;
    }
    parLaize.set(cle, { laizeCm: cle, origine, nbRouleaux: rouleau ? 1 : 0, poidsKg: rouleau ? poidsKg : 0 });
  };
  const rouleaux = await chargerRouleauxTrace(traceId);
  if (!("error" in rouleaux)) {
    const choisis = rouleaux.rouleaux.filter((r) => r.choisi);
    for (const r of choisis) ajouter(r.laizeCm, "rouleaux_choisis", r.poidsKg, true);
    if (choisis.length === 0) {
      const textiles = new Set(rouleaux.textilesTrace);
      const variants = new Set(rouleaux.variantsTrace);
      for (const r of rouleaux.rouleaux) {
        if (r.forme !== trace.forme || r.reservation) continue;
        if (!(variants.has(r.variantId ?? "") || textiles.has(r.textileId))) continue;
        ajouter(r.laizeCm, "stock", r.poidsKg, true);
      }
    }
  }
  ajouter(trace.largeur_matelas_cm, "trace");
  ajouter(fiche?.laize_utile_cm, "fiche");
  const laizes = [...parLaize.values()].sort((a, b) => b.nbRouleaux - a.nbRouleaux || b.laizeCm - a.laizeCm);

  let blocage: string | null = null;
  if (trace.forme === "tubulaire") {
    blocage = "Le calcul automatique ne traite pour l'instant que le tissu ouvert : ce tracé est en tubulaire. Déposez un fichier Modaris.";
  } else if (pieces.length === 0) {
    blocage = "Indiquez d'abord les pièces du tracé (pièces par couche) : le calcul part de cette liste.";
  }

  return {
    pieces,
    laizes,
    forme: trace.forme as "ouvert" | "tubulaire",
    blocage,
    modifiable: STATUTS_MODIFIABLES.includes(trace.statut as string) && fiche?.statut !== "archive",
    imbricationCalculId: (trace.imbrication_calcul_id as string | null) ?? null,
    prereglages: PREREGLAGES_TEMPS,
  };
}

const lancementSchema = z
  .object({
    laizesCm: z.array(z.number().positive().max(1000)).min(1).max(4),
    margeLisiereMm: z.number().min(0).max(100),
    espacementMm: z.number().min(0).max(20),
    tempsS: z.number().int().min(10).max(3600),
  })
  .strict();

export async function lancerCalculsTrace(
  traceId: string,
  ficheId: string,
  input: z.input<typeof lancementSchema>
): Promise<{ groupe: string; ids: string[] } | { error: string }> {
  await requirePermission("patronnage_traces", "create");
  const lecture = lancementSchema.safeParse(input);
  if (!lecture.success) return { error: "Paramètres du calcul invalides." };
  const p = lecture.data;

  const contexte = await contexteCalculTrace(traceId);
  if ("error" in contexte) return contexte;
  if (contexte.blocage) return { error: contexte.blocage };
  if (!contexte.modifiable) return { error: "Ce tracé n'est plus en préparation : on ne peut plus lui calculer de fichier." };

  const groupe = randomUUID();
  const ids: string[] = [];
  const laizes = [...new Set(p.laizesCm.map((l) => Math.round(l * 10) / 10))];
  for (const laizeCm of laizes) {
    const r = await creerCalculImbrication(
      {
        libelle: `Laize ${laizeCm.toLocaleString("fr-FR")} cm`,
        ficheId,
        traceId,
        groupe,
        demandes: contexte.pieces.map((x) => ({ semiFiniId: x.semiFiniId, taille: x.taille, quantite: x.quantite })),
        tissu: { largeurUtileMm: laizeCm * 10, margeLisiereMm: p.margeLisiereMm, espacementMm: p.espacementMm },
        tempsS: p.tempsS,
      },
      { declencher: false }
    );
    if ("error" in r) {
      // Les calculs déjà créés restent : on les annule pour ne pas laisser une comparaison incomplète tourner.
      for (const id of ids) await annulerCalculImbrication(id);
      return { error: laizes.length > 1 ? `Laize ${laizeCm} cm : ${r.error}` : r.error };
    }
    ids.push(r.id);
  }
  await declencherTraitement(ids.length);
  return { groupe, ids };
}

export interface CalculTraceResume {
  id: string;
  libelle: string | null;
  groupe: string | null;
  statut: "en_attente" | "en_cours" | "termine" | "echec" | "annule";
  laizeCm: number;
  tempsTotalS: number;
  tempsConsommeS: number;
  longueurCm: number | null;
  tauxUtilisation: number | null;
  /** Surface de tissu d'une couche (m²) : longueur × laize. */
  surfaceCoucheM2: number | null;
  erreur: string | null;
  annulationDemandee: boolean;
  createdAt: string;
  arret: string | null;
}

/** Calculs lancés pour ce tracé, du plus récent au plus ancien (sans les géométries). */
export async function calculsDuTrace(traceId: string): Promise<CalculTraceResume[] | { error: string }> {
  await requirePermission("patronnage", "view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("imbrication_calculs")
    .select(
      "id,libelle,groupe,statut,temps_total_s,temps_consomme_s,longueur_mm,taux_utilisation,erreur_message,annulation_demandee_le,created_at,laize:entree->tissu->largeur_utile,arret:meilleur->arret"
    )
    .eq("trace_id", traceId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return { error: error.message };
  return (data ?? []).map((c) => {
    const laizeMm = Number(c.laize);
    const longueurMm = c.longueur_mm === null ? null : Number(c.longueur_mm);
    return {
      id: c.id as string,
      libelle: c.libelle as string | null,
      groupe: c.groupe as string | null,
      statut: c.statut as CalculTraceResume["statut"],
      laizeCm: laizeMm / 10,
      tempsTotalS: Number(c.temps_total_s),
      tempsConsommeS: Number(c.temps_consomme_s),
      longueurCm: longueurMm === null ? null : Math.round(longueurMm) / 10,
      tauxUtilisation: c.taux_utilisation === null ? null : Number(c.taux_utilisation),
      surfaceCoucheM2: longueurMm === null ? null : Math.round(((longueurMm * laizeMm) / 1e6) * 1000) / 1000,
      erreur: c.erreur_message as string | null,
      annulationDemandee: !!c.annulation_demandee_le,
      createdAt: c.created_at as string,
      arret: c.arret ? (LIBELLES_ARRET[c.arret as keyof typeof LIBELLES_ARRET] ?? null) : null,
    };
  });
}

export interface ApercuCalcul {
  id: string;
  longueurMm: number;
  largeurMm: number;
  margeMm: number;
  pieces: { id: string; libelle: string; contour: [number, number][] }[];
  placements: { pieceId: string; x: number; y: number; rotation: number; miroir: boolean }[];
}

/** Géométrie d'un calcul terminé, pour l'aperçu à l'écran. */
export async function apercuCalcul(calculId: string): Promise<ApercuCalcul | { error: string }> {
  const c = await lireCalculImbrication(calculId);
  if (!c) return { error: "Calcul introuvable." };
  if (!c.meilleur || !c.validation?.valide) return { error: "Ce calcul n'a pas (encore) de tracé validé." };
  const libelles = new Map(c.pieces.map((p) => [p.id, `${p.semiFiniNom} · ${p.taille.split("/").pop()}${p.miroir ? " (retournée)" : ""}`]));
  return {
    id: c.id,
    longueurMm: c.validation.longueurMm,
    largeurMm: c.entree.tissu.largeur_utile,
    margeMm: c.entree.tissu.marge_lisiere,
    pieces: c.entree.pieces.map((p) => ({ id: p.id, libelle: libelles.get(p.id) ?? p.id, contour: p.contour as [number, number][] })),
    placements: c.meilleur.placements.map((p) => ({ pieceId: p.piece_id, x: p.x, y: p.y, rotation: p.rotation, miroir: p.miroir })),
  };
}

export async function annulerCalculTrace(calculId: string): Promise<{ error?: string }> {
  const r = await annulerCalculImbrication(calculId);
  return "error" in r ? { error: r.error } : {};
}

/**
 * « Utiliser ce tracé » : le tracé calculé devient le fichier du tracé,
 * exactement comme un fichier Modaris déposé (reconnaissance, dimensions,
 * marquage, PDF…). Décision humaine, jamais automatique.
 */
export async function utiliserCalculPourTrace(calculId: string, traceId: string, ficheId: string): Promise<{ reconnaissanceComplete: boolean } | { error: string }> {
  const { authId } = await requirePermission("patronnage_traces", "create");
  const { supabase, trace } = await lireTrace(traceId);
  if (!trace || trace.fiche_id !== ficheId) return { error: "Tracé introuvable." };
  const fiche = (Array.isArray(trace.fiches_placement) ? trace.fiches_placement[0] : trace.fiches_placement) as { statut: string } | null;
  if (!STATUTS_MODIFIABLES.includes(trace.statut as string)) {
    return { error: "Ce tracé n'est plus en préparation : un tracé validé se modifie avec un motif, un tracé coupé ou annulé ne se modifie plus." };
  }
  if (!fiche || fiche.statut === "archive") return { error: "Cette fiche est archivée — désarchivez-la pour modifier ses tracés." };

  const c = await lireCalculImbrication(calculId);
  if (!c) return { error: "Calcul introuvable." };
  const { data: lien } = await supabase.from("imbrication_calculs").select("trace_id").eq("id", calculId).maybeSingle();
  if (lien?.trace_id !== traceId) return { error: "Ce calcul n'a pas été lancé pour ce tracé." };
  if (c.statut !== "termine" || !c.meilleur) return { error: "Ce calcul n'est pas terminé." };

  // Contrôle refait au moment de l'utiliser : le fichier remis à la coupe
  // est toujours un tracé que Seritex vient de vérifier.
  const entree = entreeSchema.parse(c.entree);
  const controle = validerTrace(entree, c.meilleur);
  if (!controle.valide) return { error: `Le tracé calculé est refusé par le contrôle de Seritex : ${controle.problemes[0]?.message ?? "raison inconnue"}` };

  let texte: string;
  try {
    texte = genererDxfImbrication(entree, c.meilleur, c.pieces);
  } catch (e) {
    return { error: `Écriture du fichier DXF impossible : ${(e as Error).message}` };
  }
  const laizeCm = entree.tissu.largeur_utile / 10;
  const nom = `Seritex-${(c.libelle ?? "tracé").replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.dxf`;
  const depot = await deposerFichierTrace(
    supabase,
    authId,
    traceId,
    ficheId,
    { texte, nom, octets: Buffer.from(texte, "utf-8") },
    {
      statutFiche: fiche.statut,
      complementTrace: {
        imbrication_calcul_id: calculId,
        // La largeur du matelas est la laize du calcul (pas l'emprise des pièces).
        largeur_matelas_cm: laizeCm,
        longueur_matelas_cm: Math.ceil(controle.longueurMm) / 10,
      },
      journal: {
        action: "trace_calcule_seritex",
        metadata: { calcul_id: calculId, longueur_mm: controle.longueurMm, taux_utilisation: controle.tauxUtilisation, laize_cm: laizeCm },
      },
    }
  );
  if ("error" in depot) return depot;

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return depot;
}
