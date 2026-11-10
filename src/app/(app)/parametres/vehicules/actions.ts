"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";

/**
 * Paramètres > Logistique > Véhicules : types de documents (bloquant ou non,
 * préavis, urgence), types d'entretien (intervalles), carburant (plafond,
 * seuils de contrôle, prix du litre, stations). RLS de 0169-0172.
 */
type Result = { error?: string };

const done = () => {
  revalidatePath("/parametres/vehicules");
  revalidatePath("/vehicules");
};

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  if (v === undefined) return null;
  const n = Number(v.replace(/\s/g, ""));
  return Number.isInteger(n) ? n : NaN;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const err = (e: { code?: string; message: string }) => {
  if (e.code === "23505") return "Ce code ou ce nom existe déjà.";
  if (e.message.includes("urgence_avant_preavis")) return "Le délai « urgent » doit être inférieur ou égal au préavis.";
  if (e.code === "42501" || /row-level security/i.test(e.message)) return "Droit insuffisant.";
  return e.message;
};
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

// --- Types de documents --------------------------------------------------------------

export async function saveDocumentType(id: string | null, fd: FormData): Promise<Result> {
  await requirePermission("parametres_vehicules", id ? "modify" : "create");
  const libelle = str(fd, "libelle");
  const preavis = int(fd, "preavis_jours");
  const urgence = int(fd, "urgence_jours");
  if (!libelle) return { error: "Libellé manquant." };
  if (preavis === null || Number.isNaN(preavis) || preavis < 0 || preavis > 365) return { error: "Préavis invalide (0 à 365 jours)." };
  if (urgence === null || Number.isNaN(urgence) || urgence < 0 || urgence > 365) return { error: "Délai urgent invalide (0 à 365 jours)." };
  const payload = {
    libelle,
    bloquant: bool(fd, "bloquant"),
    obligatoire: bool(fd, "obligatoire"),
    preavis_jours: preavis,
    urgence_jours: urgence,
    actif: id ? bool(fd, "actif") : true,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("vehicle_document_types").update(payload).eq("id", id)
    : await supabase.from("vehicle_document_types").insert({ ...payload, code: slug(libelle) || "document", ordre: 100 });
  if (error) return { error: err(error) };
  done();
  return {};
}

// --- Types d'entretien ----------------------------------------------------------------

export async function saveServiceType(id: string | null, fd: FormData): Promise<Result> {
  await requirePermission("parametres_vehicules", id ? "modify" : "create");
  const libelle = str(fd, "libelle");
  const jours = int(fd, "intervalle_jours");
  const km = int(fd, "intervalle_km");
  if (!libelle) return { error: "Libellé manquant." };
  if (Number.isNaN(jours) || (jours !== null && (jours < 1 || jours > 3650))) return { error: "Intervalle en jours invalide (1 à 3 650)." };
  if (Number.isNaN(km) || (km !== null && (km < 100 || km > 1_000_000))) return { error: "Intervalle en km invalide (100 à 1 000 000)." };
  const payload = { libelle, intervalle_jours: jours, intervalle_km: km, actif: id ? bool(fd, "actif") : true };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("vehicle_service_types").update(payload).eq("id", id)
    : await supabase.from("vehicle_service_types").insert({ ...payload, code: slug(libelle) || "entretien", ordre: 100 });
  if (error) return { error: err(error) };
  done();
  return {};
}

// --- Carburant --------------------------------------------------------------------------

export async function saveFuelSettings(fd: FormData): Promise<Result> {
  await requirePermission("parametres_vehicules", "modify");
  const plafond = int(fd, "plafond_bon");
  const conso = int(fd, "ecart_consommation_pct");
  const prix = int(fd, "ecart_prix_pct");
  if (Number.isNaN(plafond) || (plafond !== null && plafond <= 0)) return { error: "Plafond invalide." };
  if (conso === null || Number.isNaN(conso) || conso < 1 || conso > 500) return { error: "Écart de consommation invalide (1 à 500 %)." };
  if (prix === null || Number.isNaN(prix) || prix < 1 || prix > 100) return { error: "Écart de prix invalide (1 à 100 %)." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicules_reglages")
    .update({ plafond_bon: plafond, ecart_consommation_pct: conso, ecart_prix_pct: prix })
    .eq("id", true);
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function addFuelPrice(fd: FormData): Promise<Result> {
  await requirePermission("parametres_vehicules", "modify");
  const energie = str(fd, "energie");
  const prix = int(fd, "prix_litre");
  const depuis = str(fd, "depuis");
  if (energie !== "essence" && energie !== "gasoil") return { error: "Carburant invalide." };
  if (prix === null || Number.isNaN(prix) || prix <= 0) return { error: "Prix au litre invalide." };
  if (!depuis || !/^\d{4}-\d{2}-\d{2}$/.test(depuis)) return { error: "Date d'application manquante." };
  const supabase = await createClient();
  const { error } = await supabase.from("fuel_prices").upsert({ energie, prix_litre: prix, depuis }, { onConflict: "energie,depuis" });
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function saveStation(id: string | null, fd: FormData): Promise<Result> {
  await requirePermission("parametres_vehicules", id ? "modify" : "create");
  const nom = str(fd, "nom");
  if (!nom) return { error: "Nom de la station manquant." };
  const lat = str(fd, "latitude");
  const lng = str(fd, "longitude");
  const latitude = lat ? Number(lat.replace(",", ".")) : null;
  const longitude = lng ? Number(lng.replace(",", ".")) : null;
  if ((latitude !== null && !Number.isFinite(latitude)) || (longitude !== null && !Number.isFinite(longitude))) return { error: "Coordonnées GPS invalides." };
  const payload = { nom, adresse: str(fd, "adresse") ?? null, latitude, longitude, actif: id ? bool(fd, "actif") : true };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("fuel_stations").update(payload).eq("id", id) : await supabase.from("fuel_stations").insert(payload);
  if (error) return { error: err(error) };
  done();
  return {};
}
