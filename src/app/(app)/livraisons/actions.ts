"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/current-user";

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
  return rpc("prepare_shipment", { p_shipment_id: id, p_place_id: placeId, p_mode: mode, p_date_promise: datePromise || null }, id);
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
  return rpc("mark_ready_for_pickup", { p_shipment_id: id }, id);
}

export async function setShipmentStatus(
  id: string,
  statut: string,
  opts: { commentaire?: string; latitude?: number | null; longitude?: number | null; receptionnaire?: string } = {}
) {
  return rpc(
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
