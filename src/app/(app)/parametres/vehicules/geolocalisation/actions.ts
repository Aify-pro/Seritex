"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { runFreetrackSync, testFreetrackConnection } from "@/lib/vehicules/freetrack-sync";
import { looksLikeMoto, normalizePlate } from "@/lib/vehicules/freetrack-parse";

/**
 * Paramètres > Logistique > Géolocalisation (VEH-5). Connexion et mot de passe
 * réservés à l'administrateur de la plateforme ; le mot de passe va droit au
 * Vault (freetrack_set_password) et n'est jamais relu. Lier un traceur à un
 * véhicule relève du droit « Véhicules : modifier ».
 */
type Result = { error?: string; message?: string };

const done = () => {
  revalidatePath("/parametres/vehicules/geolocalisation");
  revalidatePath("/vehicules");
};

export async function saveFreetrackSettings(fd: FormData): Promise<Result> {
  await requirePlatformAdmin();
  const baseUrl = String(fd.get("base_url") ?? "").trim().replace(/\/+$/, "");
  const email = String(fd.get("email") ?? "").trim();
  const frequence = Number(fd.get("frequence_minutes") ?? 5);
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(baseUrl)) return { error: "Adresse invalide (https://…)." };
  if (!email || email.length > 200) return { error: "Identifiant (e-mail) manquant." };
  if (![5, 10, 15, 30, 60].includes(frequence)) return { error: "Fréquence invalide." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("freetrack_settings")
    .update({ base_url: baseUrl.toLowerCase(), email, frequence_minutes: frequence, actif: fd.get("actif") === "on" })
    .eq("id", true);
  if (error) return { error: error.message };
  const password = String(fd.get("password") ?? "");
  if (password) {
    const { error: pwError } = await supabase.rpc("freetrack_set_password", { p_password: password });
    if (pwError) return { error: pwError.message };
  }
  done();
  return {};
}

export async function testFreetrack(): Promise<Result> {
  await requirePlatformAdmin();
  try {
    const { devices } = await testFreetrackConnection();
    done();
    return { message: `Connexion réussie : ${devices.length} traceur(s) trouvé(s).` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Connexion impossible." };
  }
}

export async function syncFreetrackNow(): Promise<Result> {
  await requirePlatformAdmin();
  const r = await runFreetrackSync({ force: true });
  done();
  if (!r.ok) return { error: r.erreur ?? "Synchronisation échouée." };
  if (r.skipped) return { message: r.skipped };
  return {
    message: `${r.traceurs} traceur(s), ${r.vehiculesRelies} véhicule(s) relié(s), ${r.segments} trajet(s) ou arrêt(s), ${r.alertes} nouvelle(s) alerte(s), ${r.pleinsVerifies} plein(s) rapproché(s).`,
  };
}

/** Relie (ou délie, vehicleId vide) un traceur à un véhicule ; un traceur ne sert qu'un véhicule. */
export async function linkDevice(deviceId: number, vehicleId: string): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const supabase = await createClient();
  const { error: unlinkError } = await supabase.from("vehicles").update({ freetrack_device_id: null }).eq("freetrack_device_id", deviceId);
  if (unlinkError) return { error: unlinkError.message };
  if (vehicleId) {
    const { error } = await supabase.from("vehicles").update({ freetrack_device_id: deviceId }).eq("id", vehicleId);
    if (error) return { error: error.message };
  }
  done();
  return {};
}

/** Relie automatiquement les traceurs aux véhicules de même immatriculation. */
export async function autoLinkDevices(devices: { deviceId: number; nom: string }[]): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const supabase = await createClient();
  const { data } = await supabase.from("vehicles").select("id,immatriculation,freetrack_device_id");
  const vehicles = (data ?? []) as { id: string; immatriculation: string | null; freetrack_device_id: number | null }[];
  let n = 0;
  for (const d of devices) {
    if (vehicles.some((v) => v.freetrack_device_id === d.deviceId)) continue;
    const v = vehicles.find((x) => x.immatriculation && !x.freetrack_device_id && normalizePlate(x.immatriculation) === normalizePlate(d.nom));
    if (!v) continue;
    const { error } = await supabase.from("vehicles").update({ freetrack_device_id: d.deviceId }).eq("id", v.id);
    if (error) return { error: error.message };
    v.freetrack_device_id = d.deviceId;
    n += 1;
  }
  done();
  return { message: n ? `${n} traceur(s) relié(s) par immatriculation.` : "Aucune immatriculation correspondante à relier." };
}

/** Crée dans Seritex le véhicule d'un traceur pas encore connu (fiche à compléter ensuite). */
export async function createVehicleFromDevice(deviceId: number, nom: string): Promise<Result> {
  const { authId } = await requirePermission("vehicules", "create");
  const plate = normalizePlate(nom);
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").insert({
    type: looksLikeMoto(nom) ? "moto" : "voiture",
    libelle: looksLikeMoto(nom) ? `Moto ${plate}` : plate || `Traceur ${deviceId}`,
    immatriculation: plate || null,
    freetrack_device_id: deviceId,
    created_by: authId,
  });
  if (error) return { error: error.code === "23505" ? "Immatriculation ou traceur déjà utilisé." : error.message };
  done();
  return { message: "Véhicule créé : complétez sa fiche (type, usage, documents)." };
}
