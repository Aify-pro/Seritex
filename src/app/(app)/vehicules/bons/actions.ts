"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { removeVehicleFile, uploadVehicleFile } from "@/lib/vehicules/files";

/**
 * Bons de carburant (VEH-3) : demande → validation (responsable logistique,
 * numéro BC-AAAA-0001) → édition du bon → justification (montant réel,
 * litres, kilométrage, ticket). Les transitions passent par les fonctions de
 * 0171, qui re-vérifient le droit et l'immobilisation du véhicule.
 */
type Result = { error?: string; id?: string; numero?: string };

const done = (id?: string, vehicleId?: string) => {
  revalidatePath("/vehicules");
  if (id) revalidatePath(`/vehicules/bons/${id}`);
  if (vehicleId) revalidatePath(`/vehicules/${vehicleId}`);
};

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const err = (e: { code?: string; message: string }) =>
  e.code === "42501" || /row-level security/i.test(e.message) ? "Droit insuffisant pour cette action." : e.message;

export async function createFuelVoucher(fd: FormData): Promise<Result> {
  await requirePermission("bons_carburant", "create");
  const vehicleId = str(fd, "vehicle_id");
  const montant = num(fd, "montant_demande");
  const km = num(fd, "km_demande");
  if (!vehicleId) return { error: "Choisissez le véhicule." };
  if (montant === undefined || Number.isNaN(montant) || montant <= 0) return { error: "Montant du bon manquant." };
  if (km !== undefined && (!Number.isInteger(km) || km < 0)) return { error: "Kilométrage invalide." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_vouchers")
    .insert({
      vehicle_id: vehicleId,
      beneficiaire_id: str(fd, "beneficiaire_id") ?? null,
      montant_demande: Math.round(montant),
      km_demande: km ?? null,
      station_id: str(fd, "station_id") ?? null,
      motif: str(fd, "motif")?.slice(0, 200) ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: err(error) };
  done(data.id, vehicleId);
  return { id: data.id };
}

export async function validateFuelVoucher(id: string): Promise<Result> {
  await requirePermission("bons_carburant", "validate");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_fuel_voucher", { p_id: id });
  if (error) return { error: err(error) };
  done(id);
  return { numero: data as string };
}

export async function refuseFuelVoucher(id: string, motif: string): Promise<Result> {
  await requirePermission("bons_carburant", "validate");
  const supabase = await createClient();
  const { error } = await supabase.rpc("refuse_fuel_voucher", { p_id: id, p_motif: motif });
  if (error) return { error: err(error) };
  done(id);
  return {};
}

export async function cancelFuelVoucher(id: string, motif: string): Promise<Result> {
  await requirePermission("bons_carburant", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_fuel_voucher", { p_id: id, p_motif: motif });
  if (error) return { error: err(error) };
  done(id);
  return {};
}

export async function justifyFuelVoucher(id: string, fd: FormData): Promise<Result> {
  await requirePermission("bons_carburant", "modify");
  const montant = num(fd, "montant_reel");
  const litres = num(fd, "litres");
  const km = num(fd, "km_plein");
  const date = str(fd, "date_plein");
  const heure = str(fd, "heure_plein") ?? "12:00";
  if (montant === undefined || Number.isNaN(montant) || montant <= 0) return { error: "Montant du ticket manquant." };
  if (litres === undefined || Number.isNaN(litres) || litres <= 0) return { error: "Nombre de litres manquant." };
  if (km === undefined || !Number.isInteger(km) || km < 0) return { error: "Kilométrage au compteur manquant." };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure)) return { error: "Date du plein manquante." };
  const supabase = await createClient();
  const { data: bon } = await supabase.from("fuel_vouchers").select("vehicle_id,ticket_path").eq("id", id).maybeSingle();
  if (!bon) return { error: "Bon introuvable." };
  const up = await uploadVehicleFile(`${bon.vehicle_id}/bons`, "ticket", fd.get("fichier"));
  if (up && "error" in up) return { error: up.error };
  // Heure locale d'Abidjan = UTC.
  const { error } = await supabase.rpc("justify_fuel_voucher", {
    p_id: id,
    p_date_plein: `${date}T${heure}:00Z`,
    p_montant: Math.round(montant),
    p_litres: Math.round(litres * 100) / 100,
    p_km: km,
    p_ticket_path: up?.path ?? null,
  });
  if (error) {
    await removeVehicleFile(up?.path);
    return { error: err(error) };
  }
  if (up?.path && bon.ticket_path) await removeVehicleFile(bon.ticket_path);
  done(id, bon.vehicle_id);
  return {};
}
