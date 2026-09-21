"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, requireRole } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { getSizes, getSizesForProductModel, type Size } from "@/lib/sizes";
import { parseDxfContours, type DxfContour } from "@/lib/patronnage/dxf";
import { normalizeShape, appliquerEchelleFichier, FACTEURS_ECHELLE, type FacteurEchelle } from "@/lib/patronnage/geometry";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { reconnaitreTrace } from "@/lib/patronnage/reconnaissance";
import { construireAnalyseDetaillee, type TraceAnalysisDetail } from "@/lib/patronnage/detail";
import { readDxfFile } from "@/lib/patronnage/upload";
import type { StatutFiche, RepartitionTailles } from "@/lib/patronnage/types";
import { repartitionDepuisTraces, repartitionTotal, sameRepartition } from "@/lib/patronnage/dispatching";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";

const MOTEUR_VERSION = "patronnage-v2 (rotation+180°, échelle, miroir)";
const SEUIL_RECONNAISSANCE = 98;

async function requirePermission(action: "view" | "create" | "modify" | "validate" | "unlock" | "archive" | "delete") {
  const current = await requireUser();
  if (!(await can("patronnage", action))) {
    redirect("/dashboard?erreur=acces_refuse");
  }
  return current;
}

/**
 * Droit sur un TRACÉ — module « Patronnage — tracés » (migration 0027),
 * distinct du droit sur la fiche : la PAO ajoute et corrige des tracés sans
 * pouvoir toucher un cadre de la fiche. `patronnage/modify` reste accepté,
 * pour qu'un rôle ayant la main sur la fiche garde la main sur ses tracés —
 * exactement la règle que porte la RLS, pour que l'écran ne puisse pas
 * diverger de la base.
 */
async function requireTracePermission(action: "create" | "modify") {
  const current = await requireUser();
  const [surTraces, surFiche] = await Promise.all([
    can("patronnage_traces", action),
    can("patronnage", "modify"),
  ]);
  if (!surTraces && !surFiche) {
    redirect("/dashboard?erreur=acces_refuse");
  }
  return current;
}

/**
 * Quantités par taille saisies dans un formulaire. Les champs sont nommés
 * d'après la CLÉ du référentiel (« couche_Homme/M »), et c'est cette clé qui
 * est stockée : elle relie la répartition d'un tracé aux quantités demandées
 * d'un ODF, rapprochement dont dépend la validation (lot 2). Les tailles sont
 * lues au référentiel plutôt qu'à une liste figée, donc la fonction est
 * asynchrone — `getSizes()` est mise en cache par requête serveur.
 */
async function repartitionJson(formData: FormData, prefix: string, allowedSizes?: Size[]): Promise<RepartitionTailles> {
  const out: RepartitionTailles = {};
  const sizes = allowedSizes ?? (await getSizes());
  for (const taille of sizes) {
    const raw = formData.get(`${prefix}_${taille.cle}`);
    const n = raw !== null ? Number(raw) : 0;
    if (n > 0) out[taille.cle] = n;
  }
  return out;
}

/**
 * Tailles proposables pour un modèle donné, exposées côté client : le
 * formulaire de fiche l'appelle quand l'utilisateur choisit un modèle en
 * cadre 1, pour ne plus afficher les 8 tailles du référentiel entier mais
 * seulement celles déclarées disponibles pour ce modèle (src/lib/sizes.ts,
 * même convention que le dispatching de l'ODF).
 */
export async function sizesForProductModel(productModelId: string | null) {
  await requirePermission("view");
  return getSizesForProductModel(productModelId);
}

/**
 * Résout un modèle choisi en cadre 1 vers ses valeurs figées : désignation
 * (le nom du modèle) et tissu/grammage/laize hérités de son textile
 * principal (lot C1, migration 0032 — ces trois caractéristiques du
 * placement ne se retapent plus, elles viennent du référentiel textiles).
 * Renvoie des null si le modèle est introuvable ou n'a pas encore de
 * textile rattaché — jamais une valeur inventée.
 */
async function resolveProductModel(productModelId: string | null): Promise<{
  designation_article: string | null;
  tissu_type: string | null;
  grammage: number | null;
  laize_utile_cm: number | null;
}> {
  const vide = { designation_article: null, tissu_type: null, grammage: null, laize_utile_cm: null };
  if (!productModelId) return vide;

  const supabase = await createClient();
  const { data: model } = await supabase
    .from("product_models")
    .select("name,textile_id")
    .eq("id", productModelId)
    .single();
  if (!model) return vide;

  let tissu_type: string | null = null;
  let grammage: number | null = null;
  let laize_utile_cm: number | null = null;
  if (model.textile_id) {
    const { data: textile } = await supabase
      .from("textiles")
      .select("nom,grammage,laize_cm")
      .eq("id", model.textile_id)
      .single();
    if (textile) {
      tissu_type = textile.nom as string;
      grammage = textile.grammage as number | null;
      laize_utile_cm = textile.laize_cm as number | null;
    }
  }
  return { designation_article: model.name as string, tissu_type, grammage, laize_utile_cm };
}

/**
 * Peuple une fiche depuis un article d'ODF (production_order_lines) :
 * modèle (et ses valeurs figées via resolveProductModel), quantité et
 * dispatching des tailles copiés depuis production_order_sizes — de CET
 * article seul (migration 0037, plus sommés sur tout l'ODF). Partagée par
 * generateFicheFromLine (création) et linkLine (liaison d'une fiche
 * existante) pour que les deux chemins de création — génération depuis
 * l'ODF ou liaison depuis l'OT — peuplent la fiche exactement de la même
 * façon. `premiere_liaison_le` n'est jamais réécrit une fois posé : il
 * conditionne l'interdiction de suppression définitive (commentaire de la
 * colonne, migration 0007/0037).
 */
async function applyLineToFiche(ficheId: string, lineId: string): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();

  const [{ data: line, error: lineError }, { data: fiche }] = await Promise.all([
    supabase.from("production_order_lines").select("product_model_id,quantity").eq("id", lineId).single(),
    supabase.from("fiches_placement").select("premiere_liaison_le").eq("id", ficheId).single(),
  ]);
  if (lineError || !line) return { error: "Article introuvable" };

  const { data: sizesRows } = await supabase
    .from("production_order_sizes")
    .select("taille,quantite_demandee")
    .eq("production_order_line_id", lineId);

  const repartition: RepartitionTailles = {};
  for (const row of sizesRows ?? []) {
    repartition[row.taille as string] = (repartition[row.taille as string] ?? 0) + (row.quantite_demandee as number);
  }

  const resolved = await resolveProductModel(line.product_model_id as string | null);

  const patch: Record<string, unknown> = {
    production_order_line_id: lineId,
    product_model_id: line.product_model_id,
    designation_article: resolved.designation_article,
    tissu_type: resolved.tissu_type,
    grammage: resolved.grammage,
    laize_utile_cm: resolved.laize_utile_cm,
    quantite_totale: line.quantity,
    repartition_tailles: repartition,
    updated_at: new Date().toISOString(),
  };
  if (!fiche?.premiere_liaison_le) {
    patch.premiere_liaison_le = new Date().toISOString();
  }

  const { error } = await supabase.from("fiches_placement").update(patch).eq("id", ficheId);
  if (error) return { error: error.message };
  return { ok: true };
}

// ------------------------------------------------------------
// Recherche (autocomplétion ODF / client)
// ------------------------------------------------------------

/**
 * Recherche d'articles (production_order_lines) par référence de leur ODF —
 * une fiche se lie désormais à un article précis, pas à l'ODF entier
 * (migration 0037) : un ODF à plusieurs lignes propose ici une entrée par
 * article, avec l'ODF et la désignation dans le libellé pour les distinguer.
 */
export async function searchOdfLines(query: string) {
  await requirePermission("view");
  if (query.trim().length < 1) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_order_lines")
    .select("id,description,production_orders!inner(reference)")
    .ilike("production_orders.reference", `%${query.trim()}%`)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((l) => ({
    id: l.id as string,
    reference: `${(l.production_orders as unknown as { reference: string }).reference} — ${l.description}`,
  }));
}

export async function searchClient(query: string) {
  await requirePermission("view");
  if (query.trim().length < 1) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("sage_customers_view")
    .select("sage_code,name")
    .or(`name.ilike.%${query.trim()}%,sage_code.ilike.%${query.trim()}%`)
    .limit(10);
  return (data ?? []).map((c) => ({ code: c.sage_code as string, name: c.name as string }));
}

/**
 * Recherche de fiches à lier depuis un article précis d'un ODF (lot 2, sens
 * inverse de searchOdfLines ci-dessus — le lien est accessible des deux
 * côtés, section 10 du document de logique). Ne propose que les fiches déjà
 * libres ou déjà liées à CET article précis : toute autre fiche échouerait
 * de toute façon sur la contrainte d'unicité fiches_placement.production_
 * order_line_id (migration 0037).
 */
export async function searchFichesForLine(query: string, lineId: string) {
  await requirePermission("view");
  if (query.trim().length < 1) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("fiches_placement")
    .select("id,numero_ot,statut,client_libelle,production_order_line_id")
    .or(`numero_ot.ilike.%${query.trim()}%,client_libelle.ilike.%${query.trim()}%`)
    .or(`production_order_line_id.is.null,production_order_line_id.eq.${lineId}`)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

// ------------------------------------------------------------
// Cycle de vie de la fiche
// ------------------------------------------------------------

export async function createFiche(formData: FormData) {
  const { authId } = await requirePermission("create");
  const supabase = await createClient();

  const lineId = String(formData.get("production_order_line_id") ?? "").trim() || null;
  const productModelId = String(formData.get("product_model_id") ?? "").trim() || null;
  const resolved = await resolveProductModel(productModelId);

  const { data, error } = await supabase
    .from("fiches_placement")
    .insert({
      production_order_line_id: lineId,
      premiere_liaison_le: lineId ? new Date().toISOString() : null,
      client_code: String(formData.get("client_code") ?? "").trim() || null,
      client_libelle: String(formData.get("client_libelle") ?? "").trim() || null,
      date_retour_souhaitee: String(formData.get("date_retour_souhaitee") ?? "").trim() || null,
      product_model_id: productModelId,
      designation_article: productModelId
        ? resolved.designation_article
        : String(formData.get("designation_article") ?? "").trim() || null,
      quantite_totale: formData.get("quantite_totale") ? Number(formData.get("quantite_totale")) : null,
      tissu_type: productModelId ? resolved.tissu_type : String(formData.get("tissu_type") ?? "").trim() || null,
      grammage: productModelId ? resolved.grammage : formData.get("grammage") ? Number(formData.get("grammage")) : null,
      couleur: String(formData.get("couleur") ?? "").trim() || null,
      laize_utile_cm: productModelId
        ? resolved.laize_utile_cm
        : formData.get("laize_utile_cm")
          ? Number(formData.get("laize_utile_cm"))
          : null,
      contraintes: String(formData.get("contraintes") ?? "").trim() || null,
      observations: String(formData.get("observations") ?? "").trim() || null,
      cree_par: authId,
    })
    .select("id,numero_ot")
    .single();

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "create_fiche_placement",
    entity_type: "fiche_placement",
    entity_id: data.id,
    metadata: { numero_ot: data.numero_ot },
  });

  revalidatePath("/atelier/patronnage");
  return { id: data.id as string, numeroOt: data.numero_ot as string };
}

async function assertFicheModifiable(ficheId: string): Promise<{ error: string } | { ok: true; numeroOt: string; statut: StatutFiche }> {
  const supabase = await createClient();
  const { data: fiche, error } = await supabase
    .from("fiches_placement")
    .select("numero_ot,statut")
    .eq("id", ficheId)
    .single();
  if (error || !fiche) return { error: "Fiche introuvable" };
  if (fiche.statut === "bon_pour_coupe" || fiche.statut === "archive") {
    return { error: "Cette fiche est verrouillée (bon pour coupe ou archivée) — aucune modification possible." };
  }
  return { ok: true, numeroOt: fiche.numero_ot, statut: fiche.statut as StatutFiche };
}

/**
 * Même rôle qu'assertFicheModifiable, mais laisse passer un tracé de
 * rattrapage déjà approuvé (lot 3) même si la fiche elle-même est verrouillée
 * — c'est tout le principe du rattrapage : ce tracé précis redevient
 * éditable par le circuit normal (updateTrace, uploadTraceDxf...), le reste
 * de la fiche reste figé. Une demande encore en attente d'approbation
 * (est_correctif=true, approuve_par=null) n'est PAS éditable ici : elle
 * suit son propre circuit (approveCorrectiveTrace/rejectCorrectiveTrace).
 */
async function assertTraceEditable(traceId: string, ficheId: string): Promise<{ error: string } | { ok: true; numeroOt: string; statut: StatutFiche }> {
  const supabase = await createClient();
  const { data: trace } = await supabase
    .from("traces_placement")
    .select("est_correctif,approuve_par")
    .eq("id", traceId)
    .single();
  if (trace?.est_correctif && trace.approuve_par) {
    const { data: fiche } = await supabase.from("fiches_placement").select("numero_ot,statut").eq("id", ficheId).single();
    if (!fiche) return { error: "Fiche introuvable" };
    return { ok: true, numeroOt: fiche.numero_ot, statut: fiche.statut as StatutFiche };
  }
  return assertFicheModifiable(ficheId);
}

export async function updateFiche(ficheId: string, formData: FormData) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const productModelId = String(formData.get("product_model_id") ?? "").trim() || null;
  const resolved = await resolveProductModel(productModelId);

  const { error } = await supabase
    .from("fiches_placement")
    .update({
      client_code: String(formData.get("client_code") ?? "").trim() || null,
      client_libelle: String(formData.get("client_libelle") ?? "").trim() || null,
      date_retour_souhaitee: String(formData.get("date_retour_souhaitee") ?? "").trim() || null,
      product_model_id: productModelId,
      designation_article: productModelId
        ? resolved.designation_article
        : String(formData.get("designation_article") ?? "").trim() || null,
      quantite_totale: formData.get("quantite_totale") ? Number(formData.get("quantite_totale")) : null,
      tissu_type: productModelId ? resolved.tissu_type : String(formData.get("tissu_type") ?? "").trim() || null,
      grammage: productModelId ? resolved.grammage : formData.get("grammage") ? Number(formData.get("grammage")) : null,
      couleur: String(formData.get("couleur") ?? "").trim() || null,
      laize_utile_cm: productModelId
        ? resolved.laize_utile_cm
        : formData.get("laize_utile_cm")
          ? Number(formData.get("laize_utile_cm"))
          : null,
      contraintes: String(formData.get("contraintes") ?? "").trim() || null,
      observations: String(formData.get("observations") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

/**
 * Liaison à un article d'ODF — `force=true` passe outre l'avertissement de
 * l'étape 3 (mais jamais les refus 1 et 2, ceux-là restent bloquants).
 */
export async function linkLine(
  ficheId: string,
  lineId: string | null,
  force = false
): Promise<{ error?: string; warning?: string }> {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();

  if (!lineId) {
    const { error } = await supabase
      .from("fiches_placement")
      .update({ production_order_line_id: null })
      .eq("id", ficheId);
    if (error) return { error: error.message };
    revalidatePath("/atelier/patronnage");
    revalidatePath(`/atelier/patronnage/${ficheId}`);
    return {};
  }

  // La fiche prend ses tailles/tissu/quantité de l'article lié
  // (applyLineToFiche) — mais des garde-fous avant, dans les deux sens du
  // lien 1:1 fiche <-> article (fiches_placement_production_order_line_id_
  // unique, migration 0037, garantit déjà qu'un article ne peut porter
  // qu'une fiche ; côté fiche, la colonne est scalaire donc ne peut déjà
  // référencer qu'un seul article — mais rien n'empêchait jusqu'ici de la
  // faire glisser d'un article à l'autre sans le dire) :
  const { data: fiche } = await supabase
    .from("fiches_placement")
    .select("production_order_line_id,product_model_id,quantite_totale,traces_placement(repartition_par_couche,nb_plis)")
    .eq("id", ficheId)
    .single();
  const { data: line } = await supabase
    .from("production_order_lines")
    .select("product_model_id,description,quantity,production_orders(reference),production_order_sizes(taille,quantite_demandee)")
    .eq("id", lineId)
    .single();
  if (!line) return { error: "Article introuvable" };
  const lineLabel = `${(line.production_orders as unknown as { reference: string } | null)?.reference ?? "?"} — ${line.description}`;

  // 1. Fiche déjà liée à un AUTRE article : on refuse le glissement
  //    silencieux (l'article d'origine perdrait sa fiche sans que personne
  //    ne le voie) — déliaison explicite d'abord (linkLine(ficheId, null)).
  if (fiche?.production_order_line_id && fiche.production_order_line_id !== lineId) {
    return {
      error: "Cette fiche est déjà liée à un autre article — déliez-la d'abord avant de la lier à celui-ci.",
    };
  }

  // 2. Modèles incompatibles : la fiche porte déjà un modèle différent de
  //    celui de l'article ciblé (cadre 1 de la fiche vs. modèle réel produit).
  if (fiche?.product_model_id && line.product_model_id && fiche.product_model_id !== line.product_model_id) {
    return { error: `Cette fiche porte un autre modèle que celui de ${lineLabel} — liaison refusée.` };
  }

  // 3. Quantité/dispatching déjà renseignés sur la fiche (avant la liaison,
  //    ex. demande commerciale antérieure à l'ODF, ou fiche reliée puis
  //    déliée d'un autre article) mais différents de ceux de l'article : pas
  //    un refus, juste un avertissement (même convention que le message
  //    "fiche orpheline" de generateFicheFromLine, décision Ayman 16/09) —
  //    l'article fait foi si on confirme quand même.
  if (!force) {
    const demandeArticle: RepartitionTailles = {};
    for (const row of line.production_order_sizes ?? []) {
      demandeArticle[row.taille as string] = (demandeArticle[row.taille as string] ?? 0) + (row.quantite_demandee as number);
    }
    const dispatchingFiche = repartitionDepuisTraces(
      ((fiche?.traces_placement ?? []) as { repartition_par_couche: RepartitionTailles | null; nb_plis: number | null }[]).map((t) => ({
        repartitionParCouche: t.repartition_par_couche ?? {},
        nbPlis: t.nb_plis,
      }))
    );
    const totalDispatchingFiche = repartitionTotal(dispatchingFiche);

    const ecarts: string[] = [];
    if (fiche?.quantite_totale != null && fiche.quantite_totale !== line.quantity) {
      ecarts.push(`quantité totale ${fiche.quantite_totale} sur la fiche contre ${line.quantity} sur l'article`);
    }
    if (totalDispatchingFiche > 0 && !sameRepartition(dispatchingFiche, demandeArticle)) {
      ecarts.push(`dispatching des tracés déjà déposés (${totalDispatchingFiche} pièces) différent de celui de l'article`);
    }
    if (ecarts.length > 0) {
      return {
        warning: `Écart avec ${lineLabel} — ${ecarts.join(" ; ")}. Confirmez pour lier quand même (la quantité et le dispatching de l'article feront foi).`,
      };
    }
  }

  const applied = await applyLineToFiche(ficheId, lineId);
  if ("error" in applied) return applied;

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

/**
 * Génère l'ordre de tracé d'un article d'ODF (lot C2, devenu par article en
 * migration 0037) : un OT par article, puisqu'un article ne porte qu'un
 * seul modèle — pas de logique de découpage à construire. Droit double,
 * côté fiche ET côté ODF : un rôle qui crée des fiches mais ne touche pas
 * aux ODF ne doit pas déclencher ça depuis l'écran ODF, et inversement.
 * fiches_placement_production_order_line_id_unique (migration 0037,
 * remplace 0010) garantit qu'un article ne peut porter qu'une seule fiche à
 * la fois — la vérification ci-dessous évite juste l'erreur brute de
 * contrainte au profit d'un retour propre (retourner la fiche déjà générée
 * plutôt qu'échouer) si l'action est déclenchée deux fois.
 *
 * Une fiche orphine du même modèle (`candidate` ci-dessous) n'est plus un
 * blocage (décision Ayman, 16/09) : elle ne fait que déclencher un
 * avertissement — l'utilisateur reste libre de générer quand même
 * (`force=true`) plutôt que d'être forcé à aller la lier d'abord.
 */
export async function generateFicheFromLine(lineId: string, force = false) {
  const { authId } = await requirePermission("create");
  if (!(await can("ordres_fabrication", "modify"))) {
    return { error: "accès refusé : votre rôle ne permet pas de modifier cet ordre de fabrication" };
  }

  const supabase = await createClient();

  const { data: line, error: lineError } = await supabase
    .from("production_order_lines")
    .select("id,production_order_id,product_model_id")
    .eq("id", lineId)
    .single();
  if (lineError || !line) return { error: "Article introuvable" };
  if (!line.product_model_id) {
    return { error: "Sélectionnez un modèle sur cet article avant de générer son ordre de tracé." };
  }

  const { data: existing } = await supabase
    .from("fiches_placement")
    .select("id,numero_ot")
    .eq("production_order_line_id", lineId)
    .maybeSingle();
  if (existing) return { id: existing.id as string, numeroOt: existing.numero_ot as string };

  // Sens inverse : une fiche a pu être créée AVANT cet ODF (demande du
  // commercial ou de la PAO, modèle déjà choisi, encore sans ODF) et être
  // restée orpheline (jamais liée à un article). La signaler plutôt que de
  // bloquer : générer quand même est légitime (deux commandes distinctes du
  // même modèle), lier l'orpheline aussi — à l'utilisateur de choisir.
  // `production_order_line_id is null` exclut les fiches déjà prises par un
  // autre article (la contrainte unique les rendrait de toute façon
  // indisponibles).
  if (!force) {
    const { data: candidates, count } = await supabase
      .from("fiches_placement")
      .select("numero_ot,quantite_totale", { count: "exact" })
      .eq("product_model_id", line.product_model_id)
      .is("production_order_line_id", null)
      .neq("statut", "archive")
      .order("created_at", { ascending: false })
      .limit(1);
    const candidate = candidates?.[0];
    if (candidate) {
      const total = count ?? 1;
      const autres = total - 1;
      return {
        warning: `${total === 1 ? "Une fiche" : `${total} fiches`} en suspens pour ce modèle, non liée${total === 1 ? "" : "s"} à un article (dont ${candidate.numero_ot}${
          candidate.quantite_totale ? `, ${candidate.quantite_totale} pièces` : ""
        }${autres > 0 ? `, +${autres} autre(s)` : ""}) — liez-la plutôt ci-dessous, ou confirmez pour générer quand même.`,
      };
    }
  }

  const { data: created, error: createError } = await supabase
    .from("fiches_placement")
    .insert({ cree_par: authId })
    .select("id,numero_ot")
    .single();
  if (createError || !created) return { error: createError?.message ?? "création impossible" };

  const applied = await applyLineToFiche(created.id, lineId);
  if ("error" in applied) return applied;

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "generate_fiche_from_odf",
    entity_type: "fiche_placement",
    entity_id: created.id,
    metadata: { numero_ot: created.numero_ot, production_order_line_id: lineId },
  });

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/production/${line.production_order_id}`);
  return { id: created.id as string, numeroOt: created.numero_ot as string };
}

export async function validateFiche(ficheId: string) {
  const { authId } = await requirePermission("validate");
  const supabase = await createClient();

  const { data: fiche } = await supabase.from("fiches_placement").select("statut").eq("id", ficheId).single();
  if (!fiche) return { error: "Fiche introuvable" };

  const { error } = await supabase
    .from("fiches_placement")
    .update({
      statut: "bon_pour_coupe",
      statut_precedent: fiche.statut,
      valide_par: authId,
      valide_le: new Date().toISOString(),
    })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "valider_fiche_placement",
    entity_type: "fiche_placement",
    entity_id: ficheId,
  });

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function unlockFiche(ficheId: string) {
  const { authId } = await requirePermission("unlock");
  const supabase = await createClient();

  const { data: fiche } = await supabase
    .from("fiches_placement")
    .select("statut,statut_precedent")
    .eq("id", ficheId)
    .single();
  if (!fiche) return { error: "Fiche introuvable" };
  if (fiche.statut !== "bon_pour_coupe") return { error: "Cette fiche n'est pas verrouillée." };

  const { error } = await supabase
    .from("fiches_placement")
    .update({
      statut: fiche.statut_precedent ?? "traces_deposes",
      deverrouille_par: authId,
      deverrouille_le: new Date().toISOString(),
    })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "deverrouiller_fiche_placement",
    entity_type: "fiche_placement",
    entity_id: ficheId,
  });

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function archiveFiche(ficheId: string) {
  const { authId } = await requirePermission("archive");
  const supabase = await createClient();
  const { data: fiche } = await supabase.from("fiches_placement").select("statut").eq("id", ficheId).single();
  if (!fiche) return { error: "Fiche introuvable" };

  const { error } = await supabase
    .from("fiches_placement")
    .update({ statut: "archive", statut_precedent: fiche.statut, archive_par: authId, archive_le: new Date().toISOString() })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function unarchiveFiche(ficheId: string) {
  await requirePermission("archive");
  const supabase = await createClient();
  const { data: fiche } = await supabase
    .from("fiches_placement")
    .select("statut,statut_precedent")
    .eq("id", ficheId)
    .single();
  if (!fiche || fiche.statut !== "archive") return { error: "Cette fiche n'est pas archivée." };

  const { error } = await supabase
    .from("fiches_placement")
    .update({ statut: fiche.statut_precedent ?? "demande", archive_par: null, archive_le: null })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

/** Réservée à l'administrateur (can_delete) ; bloquée si déjà validée ou liée à un ODF (§3 spec). */
export async function deleteFicheDefinitively(ficheId: string) {
  await requirePermission("delete");
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: fiche } = await supabase
    .from("fiches_placement")
    .select("valide_le,premiere_liaison_le")
    .eq("id", ficheId)
    .single();
  if (!fiche) return { error: "Fiche introuvable" };
  if (fiche.valide_le || fiche.premiere_liaison_le) {
    return { error: "Suppression impossible : cette fiche a déjà été validée ou liée à un ODF. Archivez-la à la place." };
  }

  const { data: files } = await admin.storage.from("patronnage").list(`traces/${ficheId}`);
  if (files?.length) {
    await admin.storage.from("patronnage").remove(files.map((f) => `traces/${ficheId}/${f.name}`));
  }

  const { error } = await supabase.from("fiches_placement").delete().eq("id", ficheId);
  if (error) {
    if (error.code === "23503") return { error: "Cette fiche est encore référencée ailleurs." };
    return { error: error.message };
  }

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

// ------------------------------------------------------------
// Tracé de rattrapage (lot 3) — demande, approbation, refus.
// Seule porte d'entrée pour toucher une fiche "Bon pour coupe" : le circuit
// normal (addTrace...) reste bloqué par assertFicheModifiable/la RLS.
// ------------------------------------------------------------

/** Chef de section (ou tout rôle create/modify sur patronnage) : demande motivée. */
export async function requestCorrectiveTrace(ficheId: string, justification: string) {
  await requirePermission("modify");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_corrective_trace", {
    p_fiche_id: ficheId,
    p_justification: justification,
  });
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return { traceId: data as string };
}

/** Chef de production (has_permission('patronnage','validate')) : approuve — le tracé redevient éditable. */
export async function approveCorrectiveTrace(traceId: string) {
  await requirePermission("validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_corrective_trace", { p_trace_id: traceId });
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

/** Chef de production : refuse une demande encore en attente — la ligne est supprimée (jamais entrée dans le circuit normal). */
export async function rejectCorrectiveTrace(traceId: string, motif: string) {
  await requirePermission("validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_corrective_trace", { p_trace_id: traceId, p_motif: motif });
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

// ------------------------------------------------------------
// Tracés
// ------------------------------------------------------------

export async function addTrace(ficheId: string, formData: FormData) {
  await requireTracePermission("create");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("traces_placement")
    .select("ordre")
    .eq("fiche_id", ficheId)
    .order("ordre", { ascending: false })
    .limit(1);
  const nextOrdre = (existing?.[0]?.ordre ?? 0) + 1;

  const { error } = await supabase.from("traces_placement").insert({
    fiche_id: ficheId,
    ordre: nextOrdre,
    reference: `${gate.numeroOt}-T${nextOrdre}`,
    reference_patron: String(formData.get("reference_patron") ?? "").trim() || null,
    longueur_matelas_cm: formData.get("longueur_matelas_cm") ? Number(formData.get("longueur_matelas_cm")) : null,
    largeur_matelas_cm: formData.get("largeur_matelas_cm") ? Number(formData.get("largeur_matelas_cm")) : null,
    nb_plis: formData.get("nb_plis") ? Number(formData.get("nb_plis")) : null,
    repartition_par_couche: await repartitionJson(formData, "couche"),
  });
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function updateTrace(traceId: string, ficheId: string, formData: FormData) {
  await requireTracePermission("modify");
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("traces_placement")
    .update({
      reference_patron: String(formData.get("reference_patron") ?? "").trim() || null,
      longueur_matelas_cm: formData.get("longueur_matelas_cm") ? Number(formData.get("longueur_matelas_cm")) : null,
      largeur_matelas_cm: formData.get("largeur_matelas_cm") ? Number(formData.get("largeur_matelas_cm")) : null,
      nb_plis: formData.get("nb_plis") ? Number(formData.get("nb_plis")) : null,
      repartition_par_couche: await repartitionJson(formData, "couche"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", traceId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "La base a refusé la mise à jour du tracé (droits ou verrou de l'ODF) — aucune modification n'a été enregistrée." };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function deleteTrace(traceId: string, ficheId: string) {
  await requireTracePermission("modify");
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: trace } = await supabase.from("traces_placement").select("fichier_path").eq("id", traceId).single();
  if (trace?.fichier_path) {
    await admin.storage.from("patronnage").remove([trace.fichier_path]);
  }

  const { error } = await supabase.from("traces_placement").delete().eq("id", traceId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

export async function removeTraceDxf(traceId: string, ficheId: string) {
  await requireTracePermission("modify");
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: trace } = await supabase.from("traces_placement").select("fichier_path").eq("id", traceId).single();
  if (trace?.fichier_path) {
    await admin.storage.from("patronnage").remove([trace.fichier_path]);
  }
  await supabase.from("analyses_trace").delete().eq("trace_id", traceId);

  const { data: updated, error } = await supabase
    .from("traces_placement")
    .update({ fichier_path: null, fichier_nom: null, fichier_taille: null, charge_par: null, charge_le: null })
    .eq("id", traceId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: "La base a refusé la mise à jour du tracé (droits ou verrou de l'ODF) — aucune modification n'a été enregistrée." };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return {};
}

// ------------------------------------------------------------
// Upload + analyse d'un tracé DXF (cœur du contrôle)
// ------------------------------------------------------------

export async function uploadTraceDxf(traceId: string, ficheId: string, formData: FormData) {
  const { authId } = await requireTracePermission("create");
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  const read = readDxfFile(formData);
  if ("error" in read) return { error: read.error };

  let text: string;
  try {
    text = await read.file.text();
  } catch {
    return { error: "Impossible de lire le fichier" };
  }
  const contours = parseDxfContours(text);
  if (contours.length === 0) {
    return { error: "Aucun contour exploitable détecté dans ce tracé." };
  }

  const supabase = await createClient();
  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  // 1 → 3. Moteur : pré-passe d'échelle fichier, comparaison directe contre
  // toute la bibliothèque, puis passe miroir (cf. lib/patronnage/reconnaissance).
  const analyse = reconnaitreTrace(contours, library.references, SEUIL_RECONNAISSANCE);

  // 4. Stockage du fichier (remplace l'ancien s'il existe)
  const admin = createAdminClient();
  const { data: existingTrace } = await supabase
    .from("traces_placement")
    .select("fichier_path")
    .eq("id", traceId)
    .single();
  if (existingTrace?.fichier_path) {
    await admin.storage.from("patronnage").remove([existingTrace.fichier_path]);
  }
  const remotePath = `traces/${ficheId}/${traceId}-${Date.now()}-${sanitizeFileName(read.file.name)}`;
  const buffer = Buffer.from(await read.file.arrayBuffer());
  const { error: uploadError } = await admin.storage
    .from("patronnage")
    .upload(remotePath, buffer, { contentType: "application/dxf", upsert: false });
  if (uploadError) return { error: `Échec de l'enregistrement du fichier : ${uploadError.message}` };

  const { data: traceUpdated, error: traceUpdateError } = await supabase
    .from("traces_placement")
    .update({
      fichier_path: remotePath,
      fichier_nom: read.file.name,
      fichier_taille: read.file.size,
      charge_par: authId,
      charge_le: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", traceId)
    .select("id");
  if (traceUpdateError) return { error: traceUpdateError.message };
  // La RLS filtre sans erreur : 0 ligne modifiée = dépôt non pris en compte.
  // On retire le fichier tout juste stocké plutôt que de laisser un orphelin,
  // et surtout on ne prétend pas que le dépôt a réussi.
  if (!traceUpdated?.length) {
    await admin.storage.from("patronnage").remove([remotePath]);
    return { error: "La base a refusé la mise à jour du tracé (droits ou verrou de l'ODF) — aucune modification n'a été enregistrée." };
  }

  const analyseError = await persisterAnalyse(supabase, traceId, analyse);
  if (analyseError) return { error: analyseError };

  // 5. Fiche : passage automatique en "Tracés déposés" au premier dépôt
  if (gate.statut === "demande") {
    await supabase.from("fiches_placement").update({ statut: "traces_deposes" }).eq("id", ficheId);
  }

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "upload_trace_dxf",
    entity_type: "trace_placement",
    entity_id: traceId,
    metadata: {
      nb_pieces: analyse.nbPiecesDetectees,
      facteur_echelle: analyse.facteurEchelle,
      score_echelle: analyse.scoreEchelle,
      taux_reconnaissance: analyse.tauxReconnaissance,
      alerte_miroir: analyse.alerteMiroir,
      reconnaissance_complete: analyse.reconnaissanceComplete,
    },
  });

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return { reconnaissanceComplete: analyse.reconnaissanceComplete };
}

/** Enregistre (ou remplace) l'analyse d'un tracé. Retourne le message d'erreur éventuel. */
async function persisterAnalyse(
  supabase: Awaited<ReturnType<typeof createClient>>,
  traceId: string,
  analyse: ReturnType<typeof reconnaitreTrace>
): Promise<string | null> {
  const { error } = await supabase.from("analyses_trace").upsert(
    {
      trace_id: traceId,
      nb_pieces_detectees: analyse.nbPiecesDetectees,
      facteur_echelle: analyse.facteurEchelle,
      patrons_reconnus: analyse.patronsReconnus,
      pieces_non_reconnues: analyse.piecesNonReconnues,
      taux_reconnaissance: analyse.tauxReconnaissance,
      reconnaissance_complete: analyse.reconnaissanceComplete,
      alerte_miroir: analyse.alerteMiroir,
      alerte_echelle: analyse.alerteEchelle,
      moteur_version: MOTEUR_VERSION,
      analysee_le: new Date().toISOString(),
    },
    { onConflict: "trace_id" }
  );
  return error ? error.message : null;
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

// ------------------------------------------------------------
// Détail d'une analyse (bouton "Détail" d'un tracé déjà déposé)
// ------------------------------------------------------------

/** Relit le DXF stocké d'un tracé et en extrait les contours de coupe. */
async function chargerContoursTrace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  traceId: string,
  ficheId: string
): Promise<{ contours: DxfContour[] } | { error: string }> {
  const { data: trace, error: traceError } = await supabase
    .from("traces_placement")
    .select("fiche_id,fichier_path")
    .eq("id", traceId)
    .single();
  if (traceError || !trace || trace.fiche_id !== ficheId) return { error: "Tracé introuvable" };
  if (!trace.fichier_path) return { error: "Aucun fichier déposé pour ce tracé." };

  const admin = createAdminClient();
  const { data: blob, error: downloadError } = await admin.storage.from("patronnage").download(trace.fichier_path);
  if (downloadError || !blob) return { error: "Impossible de relire le fichier déposé." };

  let text: string;
  try {
    text = await blob.text();
  } catch {
    return { error: "Impossible de lire le fichier déposé." };
  }
  const contours = parseDxfContours(text);
  if (contours.length === 0) {
    return { error: "Aucun contour exploitable détecté dans ce tracé." };
  }
  return { contours };
}

/**
 * Reconstruit la vue détaillée d'un tracé déjà déposé — pièce par pièce,
 * avec le rendu visuel de ce que le moteur a extrait et comparé. Relit le
 * DXF déjà stocké (jamais de nouvel upload) et relance le moteur contre la
 * bibliothèque ACTUELLE : aucun changement de schéma, le résultat reste donc
 * cohérent même si la bibliothèque a évolué depuis le dépôt initial du
 * tracé. Lecture seule : ne modifie ni le tracé ni son analyse persistée.
 */
export async function getTraceDetail(traceId: string, ficheId: string): Promise<TraceAnalysisDetail | { error: string }> {
  await requirePermission("view");

  const supabase = await createClient();
  const chargement = await chargerContoursTrace(supabase, traceId, ficheId);
  if ("error" in chargement) return chargement;

  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  return construireAnalyseDetaillee(chargement.contours, library.references, SEUIL_RECONNAISSANCE, {
    facteurForce: await facteurEnregistre(supabase, traceId),
  });
}

/**
 * Facteur d'échelle de la dernière analyse enregistrée du tracé, ou
 * `undefined` s'il n'y en a pas. Le détail, l'apprentissage et la
 * ré-analyse repartent de CE facteur (auto-détecté au dépôt, ou choisi à la
 * main) : sinon un ratio choisi manuellement serait perdu à la relecture, et
 * l'écran montrerait autre chose que ce qui a été enregistré. Pour relancer la
 * détection automatique, il faut le demander explicitement (`reanalyserTrace`).
 */
async function facteurEnregistre(
  supabase: Awaited<ReturnType<typeof createClient>>,
  traceId: string
): Promise<FacteurEchelle | undefined> {
  const { data } = await supabase.from("analyses_trace").select("facteur_echelle").eq("trace_id", traceId).maybeSingle();
  const f = Number(data?.facteur_echelle);
  return (FACTEURS_ECHELLE as readonly number[]).includes(f) ? (f as FacteurEchelle) : undefined;
}

/**
 * Relance l'analyse d'un tracé DÉJÀ déposé avec un ratio d'échelle choisi à la
 * main (`facteur`), ou avec la détection automatique (`null`). Pour le cas où
 * la détection auto ne confirme rien et laisse le tracé à ×1 : la personne qui
 * charge le fichier teste les ratios (×0,01 … ×1000) et voit tout de suite le
 * résultat. Ne relit que le DXF déjà stocké, remplace l'analyse persistée et
 * laisse une trace dans l'audit.
 */
export async function reanalyserTrace(
  traceId: string,
  ficheId: string,
  facteur: number | null
): Promise<{ error: string } | { reconnaissanceComplete: boolean; facteurEchelle: number }> {
  const { authId } = await requireTracePermission("modify");
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  if (facteur !== null && !(FACTEURS_ECHELLE as readonly number[]).includes(facteur)) {
    return { error: "Ratio d'échelle invalide." };
  }

  const supabase = await createClient();
  const chargement = await chargerContoursTrace(supabase, traceId, ficheId);
  if ("error" in chargement) return chargement;
  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  const analyse = reconnaitreTrace(
    chargement.contours,
    library.references,
    SEUIL_RECONNAISSANCE,
    facteur === null ? {} : { facteurForce: facteur as FacteurEchelle }
  );
  const analyseError = await persisterAnalyse(supabase, traceId, analyse);
  if (analyseError) return { error: analyseError };

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "reanalyse_trace_echelle",
    entity_type: "trace_placement",
    entity_id: traceId,
    metadata: {
      mode: facteur === null ? "auto" : "manuel",
      facteur_echelle: analyse.facteurEchelle,
      taux_reconnaissance: analyse.tauxReconnaissance,
      reconnaissance_complete: analyse.reconnaissanceComplete,
    },
  });

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  return { reconnaissanceComplete: analyse.reconnaissanceComplete, facteurEchelle: analyse.facteurEchelle };
}

// ------------------------------------------------------------
// Apprentissage via le tracé : affectation d'une famille de pièces
// non reconnues à un patron de la bibliothèque
// ------------------------------------------------------------

const ROLES_BIBLIOTHEQUE: ("responsable_production" | "administrateur")[] = ["responsable_production", "administrateur"];

export interface OptionsAffectation {
  articles: { id: string; code: string; designation: string; patrons: { id: string; taille: string }[] }[];
}

/** Articles et patrons de la bibliothèque, pour les listes de l'écran d'affectation. */
export async function listerOptionsAffectation(): Promise<OptionsAffectation | { error: string }> {
  await requireRole(ROLES_BIBLIOTHEQUE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pattern_articles")
    .select("id,article_code,designation,patterns(id,size)")
    .order("article_code");
  if (error) return { error: error.message };
  return {
    articles: (data ?? []).map((a) => ({
      id: a.id as string,
      code: a.article_code as string,
      designation: a.designation as string,
      patrons: ((a.patterns ?? []) as { id: string; size: string }[]).map((p) => ({ id: p.id, taille: p.size })),
    })),
  };
}

const affectationSchema = z.object({
  indice: z.number().int().min(0),
  nomPiece: z.string().trim().min(1, "Nom de pièce manquant").max(80),
  quantiteAttendue: z.number().int().min(1).max(50),
  cible: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existant"), patternId: z.string().uuid() }),
    z.object({
      mode: z.literal("nouveau"),
      articleId: z.string().uuid().optional(),
      articleCode: z.string().trim().max(60).optional(),
      designation: z.string().trim().max(120).optional(),
      taille: z.string().trim().min(1, "Taille manquante").max(30),
    }),
  ]),
});
export type AffectationInput = z.infer<typeof affectationSchema>;

/**
 * Apprend UNE famille de pièces non reconnues d'un tracé : l'administrateur
 * l'affecte à un patron (existant, ou nouveau) et la géométrie de coupe de
 * l'exemplaire devient une référence de la bibliothèque. Jamais automatique :
 * chaque appel est une décision humaine, tracée dans l'audit avec le tracé
 * d'origine. La géométrie est RECALCULÉE ici depuis le DXF stocké (aucune
 * confiance dans ce que le client affiche), à l'échelle corrigée du fichier,
 * et seulement si la pièce est bel et bien non reconnue à cet instant. L'analyse
 * du tracé est ensuite relancée et persistée.
 */
export async function affecterFamille(
  traceId: string,
  ficheId: string,
  input: AffectationInput
): Promise<{ error: string } | { reconnaissanceComplete: boolean }> {
  const { authId } = await requireRole(ROLES_BIBLIOTHEQUE);
  const gate = await assertTraceEditable(traceId, ficheId);
  if ("error" in gate) return gate;

  const parsed = affectationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Affectation invalide" };
  const { indice, nomPiece, quantiteAttendue, cible } = parsed.data;

  const supabase = await createClient();
  const chargement = await chargerContoursTrace(supabase, traceId, ficheId);
  if ("error" in chargement) return chargement;
  const library = await loadReferenceLibrary(supabase);
  if ("error" in library) return { error: library.error };

  // Même échelle que celle affichée et enregistrée pour ce tracé (auto ou choisie à la main).
  const facteurForce = await facteurEnregistre(supabase, traceId);
  const avant = reconnaitreTrace(chargement.contours, library.references, SEUIL_RECONNAISSANCE, { facteurForce });
  if (!avant.piecesNonReconnues.some((p) => p.index_piece === indice)) {
    return { error: "Cette pièce est déjà reconnue (la bibliothèque a changé depuis) — actualisez la vue." };
  }
  const corrigee = appliquerEchelleFichier(
    chargement.contours.map((c) => c.points),
    avant.facteurEchelle
  )[indice];
  if (!corrigee) return { error: "Pièce introuvable dans le tracé." };
  const geom = normalizeShape(corrigee);

  let patternId: string;
  if (cible.mode === "existant") {
    const { data: pattern } = await supabase.from("patterns").select("id").eq("id", cible.patternId).maybeSingle();
    if (!pattern) return { error: "Patron introuvable." };
    patternId = pattern.id as string;
  } else {
    let articleId = cible.articleId ?? "";
    if (!articleId) {
      if (!cible.articleCode) return { error: "Choisissez un article ou saisissez un code article." };
      const { data: article, error: articleError } = await supabase
        .from("pattern_articles")
        .insert({ article_code: cible.articleCode, designation: cible.designation || "Sans désignation", created_by: authId })
        .select("id")
        .single();
      if (articleError) {
        return {
          error: articleError.code === "23505" ? "Ce code article existe déjà : sélectionnez-le dans la liste." : articleError.message,
        };
      }
      articleId = article.id as string;
    }
    const { data: pattern, error: patternError } = await supabase
      .from("patterns")
      .insert({ article_id: articleId, size: cible.taille, created_by: authId })
      .select("id")
      .single();
    if (patternError) {
      return {
        error:
          patternError.code === "23505"
            ? "Un patron existe déjà pour cette taille sur cet article : affectez à « patron existant »."
            : patternError.message,
      };
    }
    patternId = pattern.id as string;
  }

  const { data: piece, error: pieceError } = await supabase
    .from("pattern_pieces")
    .insert({
      pattern_id: patternId,
      name: nomPiece,
      expected_count: quantiteAttendue,
      area: geom.area,
      perimeter: geom.perimeter,
      radial_signature: geom.radial,
      points: geom.points,
    })
    .select("id")
    .single();
  if (pieceError) return { error: `Enregistrement de la pièce impossible : ${pieceError.message}` };

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "learn_pattern_from_trace",
    entity_type: "pattern_piece",
    entity_id: piece.id,
    metadata: {
      trace_id: traceId,
      fiche_id: ficheId,
      pattern_id: patternId,
      mode: cible.mode,
      nom_piece: nomPiece,
      index_piece: indice,
      facteur_echelle: avant.facteurEchelle,
    },
  });

  // Relance l'analyse contre la bibliothèque enrichie et persiste le nouveau verdict.
  const bibliothequeMaj = await loadReferenceLibrary(supabase);
  if ("error" in bibliothequeMaj) return { error: bibliothequeMaj.error };
  const apres = reconnaitreTrace(chargement.contours, bibliothequeMaj.references, SEUIL_RECONNAISSANCE, { facteurForce });
  const analyseError = await persisterAnalyse(supabase, traceId, apres);
  if (analyseError) return { error: analyseError };

  revalidatePath("/atelier/patronnage");
  revalidatePath(`/atelier/patronnage/${ficheId}`);
  revalidatePath("/atelier/patronnage/bibliotheque");
  return { reconnaissanceComplete: apres.reconnaissanceComplete };
}
