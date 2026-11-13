import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MM_PAR_UNITE } from "@/lib/patronnage/detail";
import { planifierCoupe, type BesoinPlan, type OptionsPlan, type PlanCoupe } from "./planification";

/**
 * Données du plan de coupe, lues dans Seritex : besoins restants (fonction
 * `besoins_coupe_agreges`, la même que l'écran « Besoins de coupe »),
 * surface des pièces (bibliothèque de patrons) et laizes des rouleaux en
 * stock. Partagé par l'écran et par les agents IA.
 */

/** Une ligne de `besoins_coupe_agreges` (colonnes utiles ici). */
export interface LigneBesoin {
  semi_fini_id: string;
  semi_fini_nom: string;
  taille: string;
  textile_id: string | null;
  tissu: string | null;
  grammage: number | string | null;
  couleur: string | null;
  reste: number | string;
  formes?: string[] | null;
}

export interface TissuAPlanifier {
  textileId: string;
  libelle: string;
  piecesRestantes: number;
  couleurs: string[];
}

const libelleTissu = (l: Pick<LigneBesoin, "tissu" | "grammage">) => `${l.tissu ?? "Tissu"}${l.grammage ? ` ${Number(l.grammage)} g` : ""}`;

export function tissusDesBesoins(lignes: LigneBesoin[]): TissuAPlanifier[] {
  const parTissu = new Map<string, TissuAPlanifier>();
  for (const l of lignes) {
    const reste = Number(l.reste);
    if (!l.textile_id || !(reste > 0)) continue;
    const t = parTissu.get(l.textile_id) ?? { textileId: l.textile_id, libelle: libelleTissu(l), piecesRestantes: 0, couleurs: [] };
    t.piecesRestantes += reste;
    const c = l.couleur ?? "Sans couleur";
    if (!t.couleurs.includes(c)) t.couleurs.push(c);
    parTissu.set(l.textile_id, t);
  }
  return [...parTissu.values()].sort((a, b) => b.piecesRestantes - a.piecesRestantes);
}

export interface LaizeStock {
  laizeCm: number;
  nbRouleaux: number;
  poidsKg: number;
}

/** Laizes des rouleaux en stock (tissu ouvert, non vides) d'un tissu. */
export async function laizesDuTissu(supabase: SupabaseClient, textileId: string): Promise<LaizeStock[]> {
  const { data } = await supabase
    .from("textile_rolls")
    .select("laize_cm,poids_kg")
    .eq("textile_id", textileId)
    .eq("statut", "en_stock")
    .eq("forme", "ouvert")
    .gt("poids_kg", 0)
    .limit(2000);
  const parLaize = new Map<number, LaizeStock>();
  for (const r of (data ?? []) as { laize_cm: number | null; poids_kg: number }[]) {
    const l = Number(r.laize_cm);
    if (!(l > 0)) continue;
    const k = Math.round(l * 10) / 10;
    const e = parLaize.get(k) ?? { laizeCm: k, nbRouleaux: 0, poidsKg: 0 };
    e.nbRouleaux++;
    e.poidsKg = Math.round((e.poidsKg + Number(r.poids_kg)) * 100) / 100;
    parLaize.set(k, e);
  }
  return [...parLaize.values()].sort((a, b) => b.poidsKg - a.poidsKg);
}

/** Surface (mm²) d'un semi-fini par taille : toutes ses pièces, d'après la bibliothèque. */
async function surfacesSemiFinis(supabase: SupabaseClient, semiFinis: string[], tailles: string[]): Promise<Map<string, number>> {
  const surfaces = new Map<string, number>();
  if (semiFinis.length === 0) return surfaces;
  const { data } = await supabase
    .from("patterns")
    .select("size,pattern_articles!inner(product_model_id,migre_le),pattern_pieces(area,expected_count)")
    .in("pattern_articles.product_model_id", semiFinis)
    .in("size", tailles);
  type Ligne = {
    size: string;
    pattern_articles: { product_model_id: string; migre_le: string | null } | null;
    pattern_pieces: { area: number | string; expected_count: number }[];
  };
  for (const l of (data ?? []) as unknown as Ligne[]) {
    if (!l.pattern_articles || l.pattern_articles.migre_le) continue;
    const s = l.pattern_pieces.reduce((acc, p) => acc + Number(p.area) * (p.expected_count || 1), 0) * MM_PAR_UNITE * MM_PAR_UNITE;
    if (s > 0) surfaces.set(`${l.pattern_articles.product_model_id}|${l.size}`, s);
  }
  return surfaces;
}

export interface ParametresPlan {
  textileId: string;
  laizeCm: number;
  /** Lisière retirée de CHAQUE bord (mm). */
  lisiereMm?: number;
  longueurTableCm: number;
  maxPlis: number;
  /** Efficience estimée en % (défaut 85). */
  efficiencePct?: number;
  /** Limiter à ces couleurs (libellés) ; toutes par défaut. */
  couleurs?: string[];
}

export interface ResultatPlan {
  tissu: string;
  laizeCm: number;
  plan: PlanCoupe;
}

export async function planPourTissu(supabase: SupabaseClient, lignes: LigneBesoin[], p: ParametresPlan): Promise<ResultatPlan | { error: string }> {
  const duTissu = lignes.filter((l) => l.textile_id === p.textileId && Number(l.reste) > 0 && (!p.couleurs?.length || p.couleurs.includes(l.couleur ?? "Sans couleur")));
  if (duTissu.length === 0) return { error: "Rien ne reste à couper dans ce tissu." };

  const lisiere = p.lisiereMm ?? 0;
  const laizeUtileMm = p.laizeCm * 10 - 2 * lisiere;
  if (!(laizeUtileMm > 0)) return { error: "La lisière retirée dépasse la laize." };

  const surfaces = await surfacesSemiFinis(
    supabase,
    [...new Set(duTissu.map((l) => l.semi_fini_id))],
    [...new Set(duTissu.map((l) => l.taille))]
  );
  const besoins: BesoinPlan[] = [];
  const exclusTubulaires: PlanCoupe["exclus"] = [];
  for (const l of duTissu) {
    const couleur = l.couleur ?? "Sans couleur";
    // Pièce qui ne se coupe qu'en tubulaire : hors du calcul automatique (v1 = tissu ouvert).
    if (l.formes && l.formes.length > 0 && !l.formes.includes("ouvert")) {
      exclusTubulaires.push({ semiFiniNom: l.semi_fini_nom, taille: l.taille, couleur, reste: Number(l.reste), raison: "se coupe en tubulaire (calcul automatique : tissu ouvert seulement)" });
      continue;
    }
    besoins.push({
      semiFiniId: l.semi_fini_id,
      semiFiniNom: l.semi_fini_nom,
      taille: l.taille,
      couleur,
      reste: Number(l.reste),
      surfaceMm2: surfaces.get(`${l.semi_fini_id}|${l.taille}`) ?? null,
    });
  }
  const options: OptionsPlan = {
    laizeUtileMm,
    longueurMaxMm: p.longueurTableCm * 10,
    maxPlis: p.maxPlis,
    efficience: (p.efficiencePct ?? 85) / 100,
  };
  const plan = planifierCoupe(besoins, options);
  if ("erreur" in plan) return { error: plan.erreur };
  plan.exclus.push(...exclusTubulaires);
  return { tissu: libelleTissu(duTissu[0]), laizeCm: p.laizeCm, plan };
}
