"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import {
  normalizeShape,
  compareShapes,
  detecterEchelleFichier,
  appliquerEchelleFichier,
  testerEnMiroir,
  type ReferenceGeom,
  type FacteurEchelle,
} from "@/lib/patronnage/geometry";
import { readDxfFile } from "@/lib/patronnage/upload";
import type { StatutFiche, RepartitionTailles } from "@/lib/patronnage/types";
import { revalidatePath } from "next/cache";
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

function repartitionJson(formData: FormData, prefix: string): RepartitionTailles {
  const out: RepartitionTailles = {};
  for (const key of ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "Autre"] as const) {
    const raw = formData.get(`${prefix}_${key}`);
    const n = raw !== null ? Number(raw) : 0;
    if (n > 0) out[key] = n;
  }
  return out;
}

// ------------------------------------------------------------
// Recherche (autocomplétion ODF / client)
// ------------------------------------------------------------

export async function searchOdf(query: string) {
  await requirePermission("view");
  if (query.trim().length < 1) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("production_orders")
    .select("id,reference")
    .ilike("reference", `%${query.trim()}%`)
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
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

// ------------------------------------------------------------
// Cycle de vie de la fiche
// ------------------------------------------------------------

export async function createFiche(formData: FormData) {
  const { authId } = await requirePermission("create");
  const supabase = await createClient();

  const odfId = String(formData.get("odf_id") ?? "").trim() || null;

  const { data, error } = await supabase
    .from("fiches_placement")
    .insert({
      odf_id: odfId,
      premiere_liaison_odf_le: odfId ? new Date().toISOString() : null,
      client_code: String(formData.get("client_code") ?? "").trim() || null,
      client_libelle: String(formData.get("client_libelle") ?? "").trim() || null,
      date_retour_souhaitee: String(formData.get("date_retour_souhaitee") ?? "").trim() || null,
      designation_article: String(formData.get("designation_article") ?? "").trim() || null,
      reference_modele: String(formData.get("reference_modele") ?? "").trim() || null,
      quantite_totale: formData.get("quantite_totale") ? Number(formData.get("quantite_totale")) : null,
      repartition_tailles: repartitionJson(formData, "taille"),
      tissu_type: String(formData.get("tissu_type") ?? "").trim() || null,
      grammage: formData.get("grammage") ? Number(formData.get("grammage")) : null,
      couleur: String(formData.get("couleur") ?? "").trim() || null,
      laize_utile_cm: formData.get("laize_utile_cm") ? Number(formData.get("laize_utile_cm")) : null,
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

export async function updateFiche(ficheId: string, formData: FormData) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("fiches_placement")
    .update({
      client_code: String(formData.get("client_code") ?? "").trim() || null,
      client_libelle: String(formData.get("client_libelle") ?? "").trim() || null,
      date_retour_souhaitee: String(formData.get("date_retour_souhaitee") ?? "").trim() || null,
      designation_article: String(formData.get("designation_article") ?? "").trim() || null,
      reference_modele: String(formData.get("reference_modele") ?? "").trim() || null,
      quantite_totale: formData.get("quantite_totale") ? Number(formData.get("quantite_totale")) : null,
      repartition_tailles: repartitionJson(formData, "taille"),
      tissu_type: String(formData.get("tissu_type") ?? "").trim() || null,
      grammage: formData.get("grammage") ? Number(formData.get("grammage")) : null,
      couleur: String(formData.get("couleur") ?? "").trim() || null,
      laize_utile_cm: formData.get("laize_utile_cm") ? Number(formData.get("laize_utile_cm")) : null,
      contraintes: String(formData.get("contraintes") ?? "").trim() || null,
      observations: String(formData.get("observations") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ficheId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

export async function linkOdf(ficheId: string, odfId: string | null) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("fiches_placement")
    .select("premiere_liaison_odf_le")
    .eq("id", ficheId)
    .single();

  const patch: Record<string, unknown> = { odf_id: odfId };
  if (odfId && !current?.premiere_liaison_odf_le) {
    patch.premiere_liaison_odf_le = new Date().toISOString();
  }

  const { error } = await supabase.from("fiches_placement").update(patch).eq("id", ficheId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
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
  return {};
}

/** Réservée à l'administrateur (can_delete) ; bloquée si déjà validée ou liée à un ODF (§3 spec). */
export async function deleteFicheDefinitively(ficheId: string) {
  await requirePermission("delete");
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: fiche } = await supabase
    .from("fiches_placement")
    .select("valide_le,premiere_liaison_odf_le")
    .eq("id", ficheId)
    .single();
  if (!fiche) return { error: "Fiche introuvable" };
  if (fiche.valide_le || fiche.premiere_liaison_odf_le) {
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
  return {};
}

// ------------------------------------------------------------
// Tracés
// ------------------------------------------------------------

export async function addTrace(ficheId: string, formData: FormData) {
  await requirePermission("modify");
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
    longueur_matelas_m: formData.get("longueur_matelas_m") ? Number(formData.get("longueur_matelas_m")) : null,
    largeur_matelas_cm: formData.get("largeur_matelas_cm") ? Number(formData.get("largeur_matelas_cm")) : null,
    nb_plis: formData.get("nb_plis") ? Number(formData.get("nb_plis")) : null,
    repartition_par_couche: repartitionJson(formData, "couche"),
  });
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

export async function updateTrace(traceId: string, ficheId: string, formData: FormData) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("traces_placement")
    .update({
      reference_patron: String(formData.get("reference_patron") ?? "").trim() || null,
      longueur_matelas_m: formData.get("longueur_matelas_m") ? Number(formData.get("longueur_matelas_m")) : null,
      largeur_matelas_cm: formData.get("largeur_matelas_cm") ? Number(formData.get("largeur_matelas_cm")) : null,
      nb_plis: formData.get("nb_plis") ? Number(formData.get("nb_plis")) : null,
      repartition_par_couche: repartitionJson(formData, "couche"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", traceId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

export async function deleteTrace(traceId: string, ficheId: string) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
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
  return {};
}

export async function removeTraceDxf(traceId: string, ficheId: string) {
  await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
  if ("error" in gate) return gate;

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: trace } = await supabase.from("traces_placement").select("fichier_path").eq("id", traceId).single();
  if (trace?.fichier_path) {
    await admin.storage.from("patronnage").remove([trace.fichier_path]);
  }
  await supabase.from("analyses_trace").delete().eq("trace_id", traceId);

  const { error } = await supabase
    .from("traces_placement")
    .update({ fichier_path: null, fichier_nom: null, fichier_taille: null, charge_par: null, charge_le: null })
    .eq("id", traceId);
  if (error) return { error: error.message };

  revalidatePath("/atelier/patronnage");
  return {};
}

// ------------------------------------------------------------
// Upload + analyse d'un tracé DXF (cœur du contrôle)
// ------------------------------------------------------------

export async function uploadTraceDxf(traceId: string, ficheId: string, formData: FormData) {
  const { authId } = await requirePermission("modify");
  const gate = await assertFicheModifiable(ficheId);
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
  const { data: allPieces, error: fetchError } = await supabase
    .from("pattern_pieces")
    .select(
      "id,name,area,perimeter,radial_signature,points,pattern_id,patterns(id,size,article_id,pattern_articles(article_code))"
    );
  if (fetchError) return { error: `Lecture de la bibliothèque impossible : ${fetchError.message}` };
  if (!allPieces || allPieces.length === 0) {
    return { error: "La bibliothèque de patrons est vide — ajoutez au moins un patron avant d'analyser un tracé." };
  }

  type RefRow = {
    id: string;
    name: string;
    area: number;
    perimeter: number;
    radial_signature: number[];
    points: [number, number][];
    pattern_id: string;
    patterns: { id: string; size: string; article_id: string; pattern_articles: { article_code: string } | null } | null;
  };
  const references = (allPieces as unknown as RefRow[]).filter((r) => r.patterns);
  const referenceGeoms: (ReferenceGeom & { row: RefRow })[] = references.map((r) => ({
    id: r.id,
    row: r,
    geom: { points: r.points, area: r.area, perimeter: r.perimeter, radial: r.radial_signature },
  }));

  // 1. Pré-passe d'échelle fichier (facteur unique, appliqué à tout le tracé)
  const rawPoints = contours.map((c) => c.points);
  const echelle = detecterEchelleFichier(rawPoints, referenceGeoms, SEUIL_RECONNAISSANCE);
  const correctedPoints = appliquerEchelleFichier(rawPoints, echelle.facteur as FacteurEchelle);

  // 2. Comparaison directe contre toute la bibliothèque, puis passe miroir
  //    pour toute pièce non reconnue directement.
  const recognizedTally = new Map<
    string,
    { row: RefRow; count: number; miroirCount: number }
  >();
  const piecesNonReconnues: {
    index_piece: number;
    calque: string;
    meilleur_score: number;
    meilleur_candidat: { patron_id: string; article: string; taille: string; piece: string } | null;
  }[] = [];

  for (let i = 0; i < correctedPoints.length; i++) {
    const candGeom = normalizeShape(correctedPoints[i]);
    let best: { confidence: number; row: RefRow } | null = null;
    for (const ref of referenceGeoms) {
      const cmp = compareShapes(candGeom, ref.geom);
      if (!best || cmp.confidence > best.confidence) best = { confidence: cmp.confidence, row: ref.row };
    }

    if (best && best.confidence >= SEUIL_RECONNAISSANCE) {
      const key = best.row.id;
      const existing = recognizedTally.get(key);
      if (existing) existing.count += 1;
      else recognizedTally.set(key, { row: best.row, count: 1, miroirCount: 0 });
      continue;
    }

    const miroir = testerEnMiroir(correctedPoints[i], referenceGeoms, SEUIL_RECONNAISSANCE);
    if (miroir.reconnu && miroir.reference) {
      const refRow = (miroir.reference as ReferenceGeom & { row: RefRow }).row;
      const key = refRow.id;
      const existing = recognizedTally.get(key);
      if (existing) {
        existing.count += 1;
        existing.miroirCount += 1;
      } else {
        recognizedTally.set(key, { row: refRow, count: 1, miroirCount: 1 });
      }
      continue;
    }

    piecesNonReconnues.push({
      index_piece: i,
      calque: contours[i].layer,
      meilleur_score: best?.confidence ?? 0,
      meilleur_candidat: best
        ? {
            patron_id: best.row.id,
            article: best.row.patterns!.pattern_articles?.article_code ?? "?",
            taille: best.row.patterns!.size,
            piece: best.row.name,
          }
        : null,
    });
  }

  const patronsReconnus = Array.from(recognizedTally.values()).map((g) => ({
    patron_id: g.row.id,
    article: g.row.patterns!.pattern_articles?.article_code ?? "?",
    taille: g.row.patterns!.size,
    piece: g.row.name,
    quantite: g.count,
    dont_en_miroir: g.miroirCount,
  }));

  const totalReconnu = patronsReconnus.reduce((s, p) => s + p.quantite, 0);
  const tauxReconnaissance = contours.length > 0 ? totalReconnu / contours.length : 0;
  const reconnaissanceComplete = piecesNonReconnues.length === 0;
  const alerteMiroir = patronsReconnus.some((p) => p.dont_en_miroir > 0);
  const alerteEchelle = echelle.facteur !== 1;

  // 3. Stockage du fichier (remplace l'ancien s'il existe)
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

  const { error: traceUpdateError } = await supabase
    .from("traces_placement")
    .update({
      fichier_path: remotePath,
      fichier_nom: read.file.name,
      fichier_taille: read.file.size,
      charge_par: authId,
      charge_le: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", traceId);
  if (traceUpdateError) return { error: traceUpdateError.message };

  const { error: analyseError } = await supabase.from("analyses_trace").upsert(
    {
      trace_id: traceId,
      nb_pieces_detectees: contours.length,
      facteur_echelle: echelle.facteur,
      patrons_reconnus: patronsReconnus,
      pieces_non_reconnues: piecesNonReconnues,
      taux_reconnaissance: tauxReconnaissance,
      reconnaissance_complete: reconnaissanceComplete,
      alerte_miroir: alerteMiroir,
      alerte_echelle: alerteEchelle,
      moteur_version: MOTEUR_VERSION,
      analysee_le: new Date().toISOString(),
    },
    { onConflict: "trace_id" }
  );
  if (analyseError) return { error: analyseError.message };

  // 4. Fiche : passage automatique en "Tracés déposés" au premier dépôt
  if (gate.statut === "demande") {
    await supabase.from("fiches_placement").update({ statut: "traces_deposes" }).eq("id", ficheId);
  }

  await supabase.from("audit_log").insert({
    user_id: authId,
    action: "upload_trace_dxf",
    entity_type: "trace_placement",
    entity_id: traceId,
    metadata: { nb_pieces: contours.length, facteur_echelle: echelle.facteur, reconnaissance_complete: reconnaissanceComplete },
  });

  revalidatePath("/atelier/patronnage");
  return { reconnaissanceComplete };
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
