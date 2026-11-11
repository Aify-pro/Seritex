import { nomenclaturesActives } from "@/lib/patronnage/nomenclatures-actives";
import "server-only";
import { compositionTissus, libelleTissu } from "@/lib/patronnage/tissus-matelas";
import { createClient } from "@/lib/supabase/server";
import type { ControleTrace, FichePlacement, PatronReconnu, PieceNonReconnue, RendementTrace, TracePlacement } from "@/lib/patronnage/types";

const FICHE_SELECT = `id,numero_ot,statut,statut_precedent,production_order_line_id,premiere_liaison_le,client_code,client_libelle,
   date_emission,date_retour_souhaitee,designation_article,reference_modele,product_model_id,quantite_totale,
   repartition_tailles,tissu_type,grammage,couleur,laize_utile_cm,contraintes,observations,
   valide_le,created_at,regroupee,
   coupe_groupee_lignes(production_order_line_id,production_order_lines(description,quantity,product_model_id,couleur_unique:couleur_unique_id(name),production_order_sizes(taille,quantite_demandee),production_orders(reference,status))),
   production_order_lines(description,production_orders(reference)),
   traces_placement(id,ordre,reference,reference_patron,longueur_matelas_cm,largeur_matelas_cm,nb_plis,
     repartition_par_couche,fichier_path,fichier_nom,charge_le,est_correctif,justification,
     statut,forme,trace_rouleaux(roll_id),valide_le,motif_validation,surplus_valide,modifie_valide_le,annule_le,motif_annulation,demarre_le,termine_le,
     trace_couches(production_order_line_id,nb_couches),
     controle_statut,controle_detail,controle_derogation_motif,controle_derogation_le,
     trace_semi_finis(semi_fini_id,taille,quantite_par_couche,source,semi_fini:product_models(name)),
     analyses_trace(id,nb_pieces_detectees,facteur_echelle,patrons_reconnus,pieces_non_reconnues,
       taux_reconnaissance,reconnaissance_complete,alerte_miroir,alerte_echelle,analysee_le))`;

// Ligne brute renvoyée par Supabase pour FICHE_SELECT ci-dessus — factorisé
// pour que getFichesPlacement et getFichePlacementById mappent exactement la
// même forme (une divergence entre les deux produirait des écrans
// liste/détail incohérents sur les mêmes données).
type AnalyseRow = {
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
};

type FicheRow = {
  id: string;
  numero_ot: string;
  statut: FichePlacement["statut"];
  statut_precedent: FichePlacement["statutPrecedent"];
  production_order_line_id: string | null;
  premiere_liaison_le: string | null;
  client_code: string | null;
  client_libelle: string | null;
  date_emission: string;
  date_retour_souhaitee: string | null;
  designation_article: string | null;
  reference_modele: string | null;
  product_model_id: string | null;
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
  regroupee: boolean;
  coupe_groupee_lignes:
    | {
        production_order_line_id: string;
        production_order_lines: {
          description: string;
          quantity: number | null;
          product_model_id: string | null;
          couleur_unique: { name: string } | { name: string }[] | null;
          production_order_sizes: { taille: string; quantite_demandee: number }[] | null;
          production_orders: { reference: string; status: string } | { reference: string; status: string }[] | null;
        } | null;
      }[]
    | null;
  production_order_lines:
    | { description: string; production_orders: { reference: string } | { reference: string }[] | null }
    | { description: string; production_orders: { reference: string } | { reference: string }[] | null }[]
    | null;
  traces_placement: {
    id: string;
    ordre: number;
    reference: string;
    reference_patron: string | null;
    longueur_matelas_cm: number | null;
    largeur_matelas_cm: number | null;
    nb_plis: number | null;
    repartition_par_couche: FichePlacement["repartitionTailles"] | null;
    fichier_path: string | null;
    fichier_nom: string | null;
    charge_le: string | null;
    est_correctif: boolean;
    justification: string | null;
    statut: TracePlacement["statut"];
    valide_le: string | null;
    motif_validation: string | null;
    surplus_valide: Record<string, number> | null;
    modifie_valide_le: string | null;
    annule_le: string | null;
    motif_annulation: string | null;
    demarre_le: string | null;
    forme: TracePlacement["forme"];
    trace_rouleaux: { roll_id: string }[] | null;
    termine_le: string | null;
    trace_couches: { production_order_line_id: string; nb_couches: number }[] | null;
    controle_statut: ControleTrace["statut"];
    controle_detail: ControleTrace["detail"];
    controle_derogation_motif: string | null;
    controle_derogation_le: string | null;
    trace_semi_finis:
      | {
          semi_fini_id: string;
          taille: string;
          quantite_par_couche: number;
          source: "dxf" | "saisie";
          semi_fini: { name: string } | { name: string }[] | null;
        }[]
      | null;
    // `analyses_trace.trace_id` est UNIQUE : PostgREST renvoie alors l'analyse
    // comme un OBJET (relation 1-1), pas comme une liste. Les deux formes sont
    // acceptées pour ne pas dépendre de ce détail de schéma.
    analyses_trace: AnalyseRow | AnalyseRow[] | null;
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

  // Semi-finis des nomenclatures utilisées par les articles regroupés (D1 : un
  // article doit avoir tous les semi-finis d'un tracé pour recevoir des couches).
  const actives = await nomenclaturesActives(
    supabase,
    fichesRaw.flatMap((f) => (f.coupe_groupee_lignes ?? []).map((g) => ({ id: g.production_order_line_id, modele: g.production_order_lines?.product_model_id ?? null })))
  );
  const idsActifs = [...new Set([...actives.values()].flat())];
  // Couleur de chaque pièce (0165) : imposée par la nomenclature, sinon celle
  // de sa zone, sinon la couleur unique de l'article.
  const lignesGroupees = [...new Set(fichesRaw.flatMap((f) => (f.coupe_groupee_lignes ?? []).map((g) => g.production_order_line_id)))];
  const couleurPiece = new Map<string, string | null>();
  if (lignesGroupees.length > 0) {
    const { data: couleurs } = await supabase.rpc("couleurs_pieces_lignes", { p_line_ids: lignesGroupees });
    for (const c of (couleurs ?? []) as { line_id: string; semi_fini_id: string; couleur: string | null }[]) {
      couleurPiece.set(`${c.line_id}|${c.semi_fini_id}`, c.couleur);
    }
  }
  const semiFinisParLigne = new Map<string, { id: string; nom: string }[]>();
  if (idsActifs.length > 0) {
    const { data: nomRows } = await supabase
      .from("nomenclature_lines")
      .select("nomenclature_id,semi_fini_id")
      .in("nomenclature_id", idsActifs)
      .not("semi_fini_id", "is", null);
    const sfIds = [...new Set((nomRows ?? []).map((r) => r.semi_fini_id as string))];
    const { data: sfRows } = sfIds.length
      ? await supabase.from("product_models").select("id,name").in("id", sfIds)
      : { data: [] as { id: string; name: string }[] };
    const noms = new Map((sfRows ?? []).map((r) => [r.id as string, r.name as string]));
    for (const [lineId, ids] of actives) {
      const liste: { id: string; nom: string }[] = [];
      for (const r of nomRows ?? []) {
        if (ids.includes(r.nomenclature_id as string) && !liste.some((x) => x.id === r.semi_fini_id)) liste.push({ id: r.semi_fini_id as string, nom: noms.get(r.semi_fini_id as string) ?? "?" });
      }
      semiFinisParLigne.set(lineId, liste);
    }
  }

  return fichesRaw.map((f) => {
    const line = Array.isArray(f.production_order_lines) ? f.production_order_lines[0] : f.production_order_lines;
    const odf = line ? (Array.isArray(line.production_orders) ? line.production_orders[0] : line.production_orders) : null;
    return {
    id: f.id,
    numeroOt: f.numero_ot,
    statut: f.statut,
    statutPrecedent: f.statut_precedent,
    lineId: f.production_order_line_id,
    odfReference: odf ? `${odf.reference}${line?.description ? ` — ${line.description}` : ""}` : null,
    premiereLiaisonLe: f.premiere_liaison_le,
    clientCode: f.client_code,
    clientLibelle: f.client_libelle,
    dateEmission: f.date_emission,
    dateRetourSouhaitee: f.date_retour_souhaitee,
    designationArticle: f.designation_article,
    referenceModele: f.reference_modele,
    productModelId: f.product_model_id,
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
    regroupee: f.regroupee,
    lignesRegroupees: (f.coupe_groupee_lignes ?? []).map((g) => {
      const po = g.production_order_lines?.production_orders;
      return {
        lineId: g.production_order_line_id,
        description: g.production_order_lines?.description ?? "—",
        odfReference: (Array.isArray(po) ? po[0]?.reference : po?.reference) ?? null,
        odfAnnule: (Array.isArray(po) ? po[0]?.status : po?.status) === "annulee",
        quantite: g.production_order_lines?.quantity ?? null,
        couleur: (() => {
          const cu = g.production_order_lines?.couleur_unique;
          return (Array.isArray(cu) ? cu[0]?.name : cu?.name) ?? null;
        })(),
        semiFinis: (semiFinisParLigne.get(g.production_order_line_id) ?? []).map((x) => ({
          ...x,
          couleur: couleurPiece.get(`${g.production_order_line_id}|${x.id}`) ?? null,
        })),
        tailles: (g.production_order_lines?.production_order_sizes ?? []).map((x) => x.taille),
        repartition: Object.fromEntries((g.production_order_lines?.production_order_sizes ?? []).map((x) => [x.taille, x.quantite_demandee])),
      };
    }),
    traces: (f.traces_placement ?? [])
      .sort((a, b) => a.ordre - b.ordre)
      .map((t) => {
        const analyse = Array.isArray(t.analyses_trace) ? t.analyses_trace[0] : (t.analyses_trace ?? undefined);
        return {
          id: t.id,
          ordre: t.ordre,
          reference: t.reference,
          referencePatron: t.reference_patron,
          longueurMatelasCm: t.longueur_matelas_cm,
          largeurMatelasCm: t.largeur_matelas_cm,
          nbPlis: t.nb_plis,
          repartitionParCouche: t.repartition_par_couche ?? {},
          fichierPath: t.fichier_path,
          fichierNom: t.fichier_nom,
          chargeLe: t.charge_le,
          statut: t.statut,
          forme: t.forme,
          nbRouleaux: t.trace_rouleaux?.length ?? 0,
          valideLe: t.valide_le,
          motifValidation: t.motif_validation,
          surplusValide: t.surplus_valide,
          modifieValideLe: t.modifie_valide_le,
          annuleLe: t.annule_le,
          motifAnnulation: t.motif_annulation,
          demarreLe: t.demarre_le,
          termineLe: t.termine_le,
          estCorrectif: t.est_correctif,
          justification: t.justification,
          couches: (t.trace_couches ?? []).map((c) => ({ lineId: c.production_order_line_id, nbCouches: c.nb_couches })),
          pieces: (t.trace_semi_finis ?? [])
            .map((p) => ({
              semiFiniId: p.semi_fini_id,
              semiFiniNom: (Array.isArray(p.semi_fini) ? p.semi_fini[0]?.name : p.semi_fini?.name) ?? "?",
              taille: p.taille,
              quantiteParCouche: p.quantite_par_couche,
              source: p.source,
            }))
            .sort((a, b) => a.semiFiniNom.localeCompare(b.semiFiniNom) || a.taille.localeCompare(b.taille)),
          controle: {
            statut: t.controle_statut,
            detail: t.controle_detail,
            derogationMotif: t.controle_derogation_motif,
            derogationLe: t.controle_derogation_le,
          },
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
    };
  });
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
  if (!mapped) return null;
  // Tracés regroupés : couches par tissu (grammage, couleur, référence).
  const odfDe = new Map(mapped.lignesRegroupees.map((l) => [l.lineId, l.odfReference]));
  const compo = await compositionTissus(
    supabase,
    new Map(
      mapped.traces
        .filter((t) => t.couches.length > 0)
        .map((t) => [
          t.id,
          t.couches.map((c) => ({ lineId: c.lineId, nbCouches: c.nbCouches, semiFiniIds: t.pieces.map((p) => p.semiFiniId), odf: odfDe.get(c.lineId) ?? null })),
        ])
    )
  );
  for (const t of mapped.traces) {
    const tissus = compo.get(t.id);
    if (tissus) {
      t.compositionTissus = tissus.map((x) => ({
        libelle: libelleTissu(x),
        couches: x.couches,
        odfs: x.odfs.map((o) => `${o.odf ?? "-"} (${o.couches})`).join(", "),
      }));
    }
  }
  return mapped;
}

/**
 * Modèles actifs pour le cadre 1 d'une fiche (lot C2), avec leur textile
 * principal déjà résolu (lot C1) — le formulaire n'a ainsi aucun aller-retour
 * à faire pour prévisualiser tissu/grammage/laize au choix du modèle.
 * Commune à l'écran liste et à la page dédiée d'une fiche, comme
 * getPatternReferenceOptions ci-dessous.
 */
export async function getProductModelOptions(): Promise<
  { id: string; name: string; textile: { nom: string | null; grammage: number | null; laizeCm: number | null } | null }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_models")
    .select("id,name,textiles!product_models_textile_id_fkey(nom,grammage,laize_cm)")
    .eq("active", true)
    .eq("nature", "pf")
    .order("name");

  return (data ?? []).map((m) => {
    const textile = (Array.isArray(m.textiles) ? m.textiles[0] : m.textiles) as
      | { nom: string; grammage: number | null; laize_cm: number | null }
      | null;
    return {
      id: m.id as string,
      name: m.name as string,
      textile: textile ? { nom: textile.nom, grammage: textile.grammage, laizeCm: textile.laize_cm } : null,
    };
  });
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
