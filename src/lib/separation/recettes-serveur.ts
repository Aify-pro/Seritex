import "server-only";
import { createClient } from "@/lib/supabase/server";
import { lireReglages } from "./reglages";
import type { Recette } from "@/components/separation/reglages-avances";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Recettes de réglages de la séparation (migration 0118), lisibles par tout
 * le personnel. Une recette illisible (réglages d'une ancienne version) est
 * ignorée ; la suppression est proposée à l'auteur et à l'administrateur.
 */
export async function chargerRecettes(profil: { id: string; role: string }, db?: Db): Promise<Recette[]> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase.from("separation_recettes").select("id,nom,reglages,created_by").order("nom");
  return (data ?? []).flatMap((r) => {
    const reglages = lireReglages(r.reglages);
    if (!reglages) return [];
    return [{ id: r.id as string, nom: r.nom as string, reglages, peutSupprimer: r.created_by === profil.id || profil.role === "administrateur" }];
  });
}
