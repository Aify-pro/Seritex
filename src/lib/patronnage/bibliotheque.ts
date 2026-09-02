import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Point } from "@/lib/patronnage/geometry";
import type { ReferencePiece } from "@/lib/patronnage/reconnaissance";

/**
 * Chargement de la bibliothèque de patrons de référence, sous la forme
 * directement consommable par le moteur de reconnaissance.
 *
 * Centralisé ici pour que toutes les actions serveur qui analysent un tracé
 * partagent exactement la même vue de la bibliothèque (mêmes colonnes, même
 * filtrage) — une divergence entre deux chargements produirait des verdicts
 * différents sur le même fichier.
 */

interface PatternPieceRow {
  id: string;
  name: string;
  area: number;
  perimeter: number;
  radial_signature: number[];
  points: Point[];
  pattern_id: string;
  patterns: {
    id: string;
    size: string;
    article_id: string;
    pattern_articles: { article_code: string } | null;
  } | null;
}

const SELECT_COLUMNS =
  "id,name,area,perimeter,radial_signature,points,pattern_id,patterns(id,size,article_id,pattern_articles(article_code))";

export async function loadReferenceLibrary(
  supabase: SupabaseClient
): Promise<{ references: ReferencePiece[] } | { error: string }> {
  const { data, error } = await supabase.from("pattern_pieces").select(SELECT_COLUMNS);

  if (error) return { error: `Lecture de la bibliothèque impossible : ${error.message}` };
  if (!data || data.length === 0) {
    return {
      error: "La bibliothèque de patrons est vide — ajoutez au moins un patron avant d'analyser un tracé.",
    };
  }

  const references: ReferencePiece[] = (data as unknown as PatternPieceRow[])
    .filter((r) => r.patterns !== null)
    // Une pièce dont la signature ou les points sont incomplets fausserait
    // toutes les comparaisons : on l'écarte plutôt que de la comparer à vide.
    .filter((r) => Array.isArray(r.points) && r.points.length >= 3 && Array.isArray(r.radial_signature))
    .map((r) => ({
      id: r.id,
      article: r.patterns!.pattern_articles?.article_code ?? "?",
      taille: r.patterns!.size,
      piece: r.name,
      geom: {
        points: r.points,
        area: Number(r.area),
        perimeter: Number(r.perimeter),
        radial: r.radial_signature.map(Number),
      },
    }));

  if (references.length === 0) {
    return { error: "Aucun patron de référence exploitable dans la bibliothèque." };
  }

  return { references };
}
