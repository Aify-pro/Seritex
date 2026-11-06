import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * L'ancien chemin « t-shirt entier » (une fiche de placement par article
 * d'ODF) est-il fermé ? (migration 0156 : tout se coupe par pièces, par des
 * tracés d'ordres de coupe regroupés.) Avant 0156 la fonction n'existe pas :
 * le chemin est alors considéré ouvert.
 */
export async function coupeEntiereFermee(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("coupe_entiere_fermee");
  return error ? false : data === true;
}
