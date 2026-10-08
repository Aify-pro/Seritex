import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Encre } from "./nuancier";
import { prixAuKg, type ParametresSerigraphie } from "./prix-revient";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Encres proposées par l'outil de séparation : articles actifs de la
 * sous-famille « Encres » dont les options sérigraphie disent « utilisable en
 * séparation » (migration 0117). Le prix au kg vient du prix d'achat de
 * l'article (onglet Prix de revient) : la RLS ne le rend qu'aux droits
 * Tarification, il reste vide pour les autres.
 */
export async function chargerEncres(db?: Db): Promise<Encre[]> {
  const supabase = db ?? (await createClient());
  const { data } = await supabase
    .from("article_encres")
    .select("product_model_id,hex,reference_couleur,sous_couche,depot_g_m2,product_models!inner(name,active,unite)")
    .eq("separation", true)
    .eq("product_models.active", true);
  const lignes = (data ?? []) as unknown as {
    product_model_id: string;
    hex: string;
    reference_couleur: string | null;
    sous_couche: boolean;
    depot_g_m2: number | null;
    product_models: { name: string; unite: string | null };
  }[];
  if (lignes.length === 0) return [];
  const { data: prix } = await supabase
    .from("model_pricing")
    .select("product_model_id,prix_achat,frais_pct")
    .in("product_model_id", lignes.map((l) => l.product_model_id));
  return lignes
    .map((l) => {
      const p = (prix ?? []).find((x) => x.product_model_id === l.product_model_id);
      return {
        id: l.product_model_id,
        nom: l.product_models.name,
        hex: l.hex,
        reference: l.reference_couleur,
        sous_couche: l.sous_couche,
        depotGm2: l.depot_g_m2 != null ? Number(l.depot_g_m2) : null,
        prixKg: p ? prixAuKg(p.prix_achat != null ? Number(p.prix_achat) : null, Number(p.frais_pct ?? 0), l.product_models.unite) : null,
      };
    })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Paramètres de coût de la sérigraphie ; null sans les droits Tarification (RLS). */
export async function chargerParametresSerigraphie(db?: Db): Promise<ParametresSerigraphie | null> {
  const supabase = db ?? (await createClient());
  const { data: r } = await supabase.from("serigraphie_parametres").select("*").maybeSingle();
  if (!r) return null;
  return {
    coutEcran: Number(r.cout_ecran),
    calageMin: Number(r.calage_min),
    tauxHoraire: Number(r.taux_horaire),
    impressionS: Number(r.impression_s),
    sechagePiece: Number(r.sechage_piece),
    gachePct: Number(r.gache_pct),
    depotGm2: Number(r.depot_g_m2),
    perteEncrePct: Number(r.perte_encre_pct),
    prixEncreKg: r.prix_encre_kg != null ? Number(r.prix_encre_kg) : null,
    surfaceRefCm2: Number(r.surface_ref_cm2),
    quantiteRef: Number(r.quantite_ref),
  };
}
