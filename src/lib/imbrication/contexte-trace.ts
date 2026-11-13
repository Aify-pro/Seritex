import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouleauxTrace } from "@/app/(app)/atelier/patronnage/fiches-actions";
import { PREREGLAGES_TEMPS } from "./calculs";

/**
 * Contexte d'un calcul automatique pour un tracé : pièces par couche, laizes
 * proposées (rouleaux), forme, ce qui bloque. Partagé par l'écran (session de
 * la personne) et par les agents IA (au nom de leur propriétaire).
 */

export const STATUTS_MODIFIABLES = ["previsionnel", "en_preparation"];

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

export async function lireTrace(supabase: SupabaseClient, traceId: string) {
  const { data } = await supabase
    .from("traces_placement")
    .select("id,fiche_id,statut,forme,largeur_matelas_cm,imbrication_calcul_id,fiches_placement(statut,laize_utile_cm)")
    .eq("id", traceId)
    .maybeSingle();
  return data;
}

export async function contexteTrace(
  supabase: SupabaseClient,
  traceId: string,
  rouleaux: RouleauxTrace | { error: string }
): Promise<ContexteCalculTrace | { error: string }> {
  const trace = await lireTrace(supabase, traceId);
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
