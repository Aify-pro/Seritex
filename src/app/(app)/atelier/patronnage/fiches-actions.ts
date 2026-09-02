"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { parseDxfContours } from "@/lib/patronnage/dxf";
import { loadReferenceLibrary } from "@/lib/patronnage/bibliotheque";
import { reconnaitreTrace } from "@/lib/patronnage/reconnaissance";
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
  if (analyseError) return { error: analyseError.message };

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
  return { reconnaissanceComplete: analyse.reconnaissanceComplete };
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}
