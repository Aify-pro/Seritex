import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FichePlacement, PatronReconnu, PieceNonReconnue, RendementTrace } from "@/lib/patronnage/types";

const FICHE_SELECT = `id,numero_ot,statut,statut_precedent,odf_id,premiere_liaison_odf_le,client_code,client_libelle,
   date_emission,date_retour_souhaitee,designation_article,reference_modele,quantite_totale,
   repartition_tailles,tissu_type,grammage,couleur,laize_utile_cm,contraintes,observations,
   valide_le,created_at,
   production_orders(reference),
   traces_placement(id,ordre,reference,reference_patron,longueur_matelas_m,largeur_matelas_cm,nb_plis,
     repartition_par_couche,fichier_path,fichier_nom,charge_le,est_correctif,justification,approuve_le,
     analyses_trace(id,nb_pieces_detectees,facteur_echelle,patrons_reconnus,pieces_non_reconnues,
       taux_reconnaissance,reconnaissance_complete,alerte_miroir,alerte_echelle,analysee_le))`;

// Ligne brute renvoyée par Supabase pour FICHE_SELECT ci-dessus — factorisé
// pour que getFichesPlacement et getFichePlacementById mappent exactement la
// même forme (une divergence entre les deux produirait des écrans
// liste/détail incohérents sur les mêmes données).
type FicheRow = {
  id: string;
  numero_ot: string;
  statut: FichePlacement["statut"];
  statut_precedent: FichePlacement["statutPrecedent"];
  odf_id: string | null;
  premiere_liaison_odf_le: string | null;
  client_code: string | null;
  client_libelle: string | null;
  date_emission: string;
  date_retour_souhaitee: string | null;
  designation_article: string | null;
  reference_modele: string | null;
  quantite_totale: number | null;
  repartition_tailles: FichePlacement["repartitionTailles"] | null;
  tissu_type: string | null;
  grammage: number | null;
  couleur: string | null;
  laize_utile_cm: number | null;
  contraintes: string | null;
  observations: string | null;
  valide_le: string | null;
  created_at: string;
  production_orders: { reference: string } | { reference: string }[] | null;
  traces_placement: {
    id: string;
    ordre: number;
    reference: string;
    reference_patron: string | null;
    longueur_matelas_m: number | null;
    largeur_matelas_cm: number | null;
    nb_plis: number | null;
    repartition_par_couche: FichePlacement["repartitionTailles"] | null;
    fichier_path: string | null;
    fichier_nom: string | null;
    charge_le: string | null;
    est_correctif: boolean;
    justification: string | null;
    approuve_le: string | null;
    analyses_trace:
      | {
          id: string;
          nb_pieces_detectees: number;
          facteur_echelle: number;
          patrons_reconnus: unknown;
          pieces_non_reconnues: unknown;
          taux_reconnaissance: number;
          reconnaissance_complete: boolean;
          alerte_miroir: boolean;
          alerte_echelle: boolean;
          analysee_le: string;
        }[]
      | null;
  }[];
};

async function mapFiches(
  fichesRaw: FicheRow[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<FichePlacement[]> {
  // Lot 8 : rendement matière par tracé (matelas déjà clôturés uniquement,
  // voir migration 0018) — une requête à part sur la fiche_id des fiches
  // déjà chargées, plutôt qu'un embed PostgREST (rendement_par_trace est une
  // vue, pas une table liée par clé étrangère déclarée).
  const ficheIds = fichesRaw.map((f) => f.id);
  const { data: rendementRows } =
    ficheIds.length > 0
      ? await supabase.from("rendement_par_trace").select("*").in("fiche_id", ficheIds)
      : { data: [] as never[] };
  const rendementByTraceId = new Map(
    (rendementRows ?? []).map((r) => [
      r.trace_id as string,
      {
        clotureLe: r.cloture_le,
        piecesObtenues: r.pieces_obtenues,
        poidsTissuTheoriqueKg: r.poids_tissu_theorique_kg,
        poidsDechetKg: r.poids_dechet_kg,
        poidsTissuReelEstimeKg: r.poids_tissu_reel_estime_kg,
        rendementTheoriquePiecesParKg: r.rendement_theorique_pieces_par_kg,
        rendementEstimePiecesParKg: r.rendement_estime_pieces_par_kg,
      } satisfies RendementTrace,
    ])
  );

  return fichesRaw.map((f) => ({
    id: f.id,
    numeroOt: f.numero_ot,
    statut: f.statut,
    statutPrecedent: f.statut_precedent,
    odfId: f.odf_id,
    odfReference: (Array.isArray(f.production_orders) ? f.production_orders[0] : f.production_orders)?.reference ?? null,
    premiereLiaisonOdfLe: f.premiere_liaison_odf_le,
    clientCode: f.client_code,
    clientLibelle: f.client_libelle,
    dateEmission: f.date_emission,
    dateRetourSouhaitee: f.date_retour_souhaitee,
    designationArticle: f.designation_article,
    referenceModele: f.reference_modele,
    quantiteTotale: f.quantite_totale,
    repartitionTailles: f.repartition_tailles ?? {},
    tissuType: f.tissu_type,
    grammage: f.grammage,
    couleur: f.couleur,
    laizeUtileCm: f.laize_utile_cm,
    contraintes: f.contraintes,
    observations: f.observations,
    valideLe: f.valide_le,
    createdAt: f.created_at,
    traces: (f.traces_placement ?? [])
      .sort((a, b) => a.ordre - b.ordre)
      .map((t) => {
        const analyse = t.analyses_trace?.[0];
        return {
          id: t.id,
          ordre: t.ordre,
          reference: t.reference,
          referencePatron: t.reference_patron,
          longueurMatelasM: t.longueur_matelas_m,
          largeurMatelasCm: t.largeur_matelas_cm,
          nbPlis: t.nb_plis,
          repartitionParCouche: t.repartition_par_couche ?? {},
          fichierPath: t.fichier_path,
          fichierNom: t.fichier_nom,
          chargeLe: t.charge_le,
          estCorrectif: t.est_correctif,
          justification: t.justification,
          approuveLe: t.approuve_le,
          rendement: rendementByTraceId.get(t.id) ?? null,
          analyse: analyse
            ? {
                id: analyse.id,
                nbPiecesDetectees: analyse.nb_pieces_detectees,
                facteurEchelle: analyse.facteur_echelle,
                patronsReconnus: (analyse.patrons_reconnus ?? []) as PatronReconnu[],
                piecesNonReconnues: (analyse.pieces_non_reconnues ?? []) as PieceNonReconnue[],
                tauxReconnaissance: analyse.taux_reconnaissance,
                reconnaissanceComplete: analyse.reconnaissance_complete,
                alerteMiroir: analyse.alerte_miroir,
                alerteEchelle: analyse.alerte_echelle,
                analyseeLe: analyse.analysee_le,
              }
            : null,
        };
      }),
  }));
}

/** Liste complète, pour l'écran `/atelier/patronnage`. */
export async function getFichesPlacement(): Promise<FichePlacement[]> {
  const supabase = await createClient();
  const { data: fichesRaw } = await supabase
    .from("fiches_placement")
    .select(FICHE_SELECT)
    .order("created_at", { ascending: false });

  return mapFiches((fichesRaw ?? []) as unknown as FicheRow[], supabase);
}

/**
 * Une fiche précise, pour sa page dédiée `/atelier/patronnage/[id]` — même
 * mapping que getFichesPlacement ci-dessus pour que les deux écrans restent
 * rigoureusement cohérents. `null` si l'identifiant ne correspond à aucune
 * fiche (page appelante : `notFound()`).
 */
export async function getFichePlacementById(id: string): Promise<FichePlacement | null> {
  const supabase = await createClient();
  const { data: ficheRaw } = await supabase.from("fiches_placement").select(FICHE_SELECT).eq("id", id).maybeSingle();
  if (!ficheRaw) return null;

  const [mapped] = await mapFiches([ficheRaw as unknown as FicheRow], supabase);
  return mapped;
}

/**
 * Bibliothèque de patrons pour le sélecteur de référence des tracés —
 * commune à l'écran liste et à la page dédiée d'une fiche.
 */
export async function getPatternReferenceOptions() {
  const supabase = await createClient();
  const { data: libraryPieces } = await supabase
    .from("pattern_pieces")
    .select("id,name,patterns(size,pattern_articles(article_code))")
    .order("id");

  return (libraryPieces ?? []).map((p) => {
    const pat = p.patterns as unknown as { size: string; pattern_articles: { article_code: string } | null } | null;
    return {
      pieceId: p.id as string,
      articleCode: pat?.pattern_articles?.article_code ?? "?",
      size: pat?.size ?? "?",
      name: p.name as string,
    };
  });
}
