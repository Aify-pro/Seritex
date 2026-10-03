"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyShipment } from "@/lib/delivery/notify";

/**
 * Actions du service livraison (LIV-1). Aucune vérification de rôle ici :
 * chaque fonction de la base (SECURITY DEFINER) contrôle le geste — service
 * livraison, comptabilité (validation), livreur affecté (statuts).
 */
type Result = { error?: string };

function done(id?: string) {
  revalidatePath("/livraisons", "layout");
  if (id) revalidatePath(`/livraisons/${id}`);
  revalidatePath("/livreur");
  revalidatePath("/atelier/production", "layout");
}

async function rpc(fn: string, args: Record<string, unknown>, id?: string): Promise<Result & { data?: unknown }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  done(id);
  return { data };
}

export async function prepareShipment(id: string, placeId: string | null, mode: "livraison" | "retrait", datePromise: string | null) {
  const supabase = await createClient();
  const { data: before } = await supabase.from("shipments").select("reference").eq("id", id).maybeSingle();
  const res = await rpc("prepare_shipment", { p_shipment_id: id, p_place_id: placeId, p_mode: mode, p_date_promise: datePromise || null }, id);
  // E-mail au client à la première préparation seulement (L8).
  if (!res.error && !before?.reference) await notifyShipment("livraison_preparee", id);
  return res;
}

export async function setShipmentLineQuantity(id: string, lineId: string, taille: string, quantite: number) {
  return rpc("set_shipment_line_quantity", { p_shipment_id: id, p_line_id: lineId, p_taille: taille, p_quantite: quantite }, id);
}

export async function addRemainingToShipment(id: string) {
  return rpc("add_remaining_to_shipment", { p_shipment_id: id }, id);
}

export async function splitShipment(id: string, lignes: { line_id: string; taille: string; quantite: number }[]) {
  const res = await rpc("split_shipment", { p_shipment_id: id, p_lignes: lignes }, id);
  return { error: res.error, newId: res.data as string | undefined };
}

export async function mergeShipments(targetId: string, sourceId: string) {
  return rpc("merge_shipments", { p_target_id: targetId, p_source_id: sourceId }, targetId);
}

export async function validateShipmentAccounting(id: string, mention: string, montant: number | null, texte: string | null) {
  return rpc("validate_shipment_accounting", { p_shipment_id: id, p_mention: mention, p_montant: montant, p_texte: texte }, id);
}

export async function planShipment(id: string, carrierId: string | null, vehicleId: string | null, livreurId: string | null, date: string) {
  return rpc("plan_shipment", { p_shipment_id: id, p_carrier_id: carrierId, p_vehicle_id: vehicleId, p_livreur_id: livreurId, p_date: date }, id);
}

export async function markReadyForPickup(id: string) {
  const res = await rpc("mark_ready_for_pickup", { p_shipment_id: id }, id);
  if (!res.error) await notifyShipment("livraison_prete_a_enlever", id);
  return res;
}

export async function setShipmentStatus(
  id: string,
  statut: string,
  opts: { commentaire?: string; latitude?: number | null; longitude?: number | null; receptionnaire?: string } = {}
) {
  const res = await rpc(
    "set_shipment_status",
    {
      p_shipment_id: id,
      p_statut: statut,
      p_commentaire: opts.commentaire?.trim() || null,
      p_latitude: opts.latitude ?? null,
      p_longitude: opts.longitude ?? null,
      p_receptionnaire: opts.receptionnaire?.trim() || null,
    },
    id
  );
  if (res.error) return res;
  await afterStatusChange(id, statut, opts.commentaire);
  return res;
}

/**
 * E-mails après un changement de statut (L8) : en route ; livrée ou enlevée
 * avec la demande de confirmation de réception (lien à jeton, sans
 * connexion) ; litige ouvert par le service (interne).
 */
async function afterStatusChange(id: string, statut: string, commentaire?: string) {
  if (statut === "en_route") await notifyShipment("livraison_en_route", id);
  if (statut === "livree" || statut === "enlevee") {
    const supabase = await createClient();
    const { data: token } = await supabase.rpc("create_shipment_confirmation", { p_shipment_id: id });
    if (typeof token === "string") {
      await notifyShipment("livraison_livree_confirmer", id, { chemin_lien: `/confirmation-livraison/${token}` });
    }
  }
  if (statut === "litige") await notifyShipment("livraison_litige", id, { commentaire: commentaire ?? "" });
}

const MAX_PHOTO = 10 * 1024 * 1024;

/**
 * Photo du BL signé (preuve de livraison, Q-LIV-3) ou photo libre. Le droit
 * est vérifié par la base (record_shipment_document : livreur affecté ou
 * service livraison) ; le fichier va dans le bucket privé « livraisons ».
 */
export async function uploadShipmentDocument(id: string, formData: FormData): Promise<Result> {
  await requireUser();
  const file = formData.get("photo");
  const type = String(formData.get("type") ?? "decharge_bl");
  const lat = Number(formData.get("latitude"));
  const lng = Number(formData.get("longitude"));
  if (!(file instanceof File) || file.size === 0) return { error: "Prenez la photo du BL signé." };
  if (file.size > MAX_PHOTO) return { error: "Photo trop lourde (10 Mo au plus)." };
  if (!file.type.startsWith("image/")) return { error: "Le fichier doit être une photo." };

  const supabase = await createClient();
  // Contrôle d'accès AVANT le dépôt : l'expédition doit être visible et confiée.
  const { data: visible } = await supabase.from("shipments").select("id").eq("id", id).maybeSingle();
  if (!visible) return { error: "Expédition introuvable." };

  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `expeditions/${id}/${type}-${Date.now()}.${ext}`;
  const storage = createAdminClient().storage.from("livraisons");
  const { error } = await storage.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) return { error: `Photo non enregistrée : ${error.message}` };
  // La base fait autorité sur le droit (livreur affecté ou service livraison) :
  // si elle refuse, le fichier déposé est retiré.
  const { error: recordError } = await supabase.rpc("record_shipment_document", {
    p_shipment_id: id,
    p_type: type,
    p_path: path,
    p_latitude: Number.isFinite(lat) && lat !== 0 ? lat : null,
    p_longitude: Number.isFinite(lng) && lng !== 0 ? lng : null,
  });
  if (recordError) {
    await storage.remove([path]);
    return { error: recordError.message };
  }
  done(id);
  return {};
}

/** Colis de l'expédition — remplace la liste (tant qu'elle n'est pas validée). */
export async function saveShipmentPackages(
  id: string,
  colis: { poidsKg: number | null; dimensions: string | null; contenu: string | null }[]
): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error: delError } = await supabase.from("shipment_packages").delete().eq("shipment_id", id);
  if (delError) return { error: delError.message };
  if (colis.length > 0) {
    const { error } = await supabase.from("shipment_packages").insert(
      colis.map((c, i) => ({
        shipment_id: id,
        numero: i + 1,
        poids_kg: c.poidsKg && c.poidsKg > 0 ? c.poidsKg : null,
        dimensions: c.dimensions?.trim() || null,
        contenu: c.contenu?.trim() || null,
      }))
    );
    if (error) return { error: error.message };
  }
  done(id);
  return {};
}

export async function saveShipmentNotes(id: string, notes: string): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("shipments").update({ notes: notes.trim() || null }).eq("id", id);
  if (error) return { error: error.message };
  done(id);
  return {};
}

/** Départ / retour de tournée (livreur ou service livraison) : heure et kilométrage. */
export async function updateRoundProgress(roundId: string, step: "depart" | "retour", km: number | null): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const patch =
    step === "depart"
      ? { statut: "en_cours", depart_at: new Date().toISOString(), km_depart: km }
      : { statut: "terminee", retour_at: new Date().toISOString(), km_retour: km };
  const { data, error } = await supabase.from("delivery_rounds").update(patch).eq("id", roundId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Tournée introuvable." };
  done();
  return {};
}

/* ============================================================
   Tournées (LIV-2) — composées par le service livraison
============================================================ */

export async function createRound(date: string, livreurId: string, vehicleId: string | null): Promise<Result> {
  const { authId } = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("delivery_rounds")
    .insert({ date, livreur_id: livreurId, vehicle_id: vehicleId || null, created_by: authId });
  if (error) return { error: error.message };
  done();
  return {};
}

export async function addRoundStop(roundId: string, shipmentId: string) {
  return rpc("add_round_stop", { p_round_id: roundId, p_shipment_id: shipmentId }, shipmentId);
}

export async function removeRoundStop(stopId: string): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("delivery_round_stops").delete().eq("id", stopId);
  if (error) return { error: error.message };
  done();
  return {};
}

/** Réordonne les arrêts d'une tournée (ordre de passage). */
export async function reorderRoundStops(roundId: string, stopIds: string[]): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  // Deux temps pour ne pas heurter un ordre déjà pris pendant l'échange.
  for (const [i, id] of stopIds.entries()) {
    const { error } = await supabase.from("delivery_round_stops").update({ ordre: 1000 + i }).eq("id", id).eq("round_id", roundId);
    if (error) return { error: error.message };
  }
  for (const [i, id] of stopIds.entries()) {
    const { error } = await supabase.from("delivery_round_stops").update({ ordre: i + 1 }).eq("id", id).eq("round_id", roundId);
    if (error) return { error: error.message };
  }
  done();
  return {};
}
