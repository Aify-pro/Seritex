"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { removeVehicleFile, uploadVehicleFile } from "@/lib/vehicules/files";

/**
 * Module Véhicules (VEH-0, 1, 2, 4) : fiche, compteur, documents, chauffeur,
 * pannes et entretien. Le droit est contrôlé ici pour un refus lisible ; la
 * base le re-vérifie (RLS 0168-0172).
 */
type Result = { error?: string; id?: string };

const done = (id?: string) => {
  revalidatePath("/vehicules");
  if (id) revalidatePath(`/vehicules/${id}`);
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

function dbError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Cette valeur existe déjà (immatriculation ou traceur déjà utilisé).";
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "Droit insuffisant pour cette action.";
  return error.message;
}

// --- Fiche véhicule ------------------------------------------------------------------

const vehicleSchema = z.object({
  type: z.enum(["camion", "fourgonnette", "voiture", "moto", "tricycle"]),
  libelle: z.string().trim().min(1, "Nom du véhicule manquant").max(80),
  immatriculation: z.string().trim().max(20).optional(),
  usage: z.enum(["livraison", "commercial", "direction", "service"]).optional(),
  marque: z.string().trim().max(60).optional(),
  modele: z.string().trim().max(60).optional(),
  annee: z.number().int().min(1950, "Année invalide").max(2100, "Année invalide").optional(),
  couleur: z.string().trim().max(40).optional(),
  energie: z.enum(["essence", "gasoil", "electrique", "hybride"]).optional(),
  reservoir_litres: z.number().positive("Réservoir invalide").max(2000).optional(),
  numero_chassis: z.string().trim().max(40).optional(),
  carte_grise_numero: z.string().trim().max(40).optional(),
  date_mise_circulation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  capacite_note: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

function readVehicle(fd: FormData) {
  return vehicleSchema.safeParse({
    type: str(fd, "type"),
    libelle: str(fd, "libelle"),
    immatriculation: str(fd, "immatriculation"),
    usage: str(fd, "usage"),
    marque: str(fd, "marque"),
    modele: str(fd, "modele"),
    annee: num(fd, "annee"),
    couleur: str(fd, "couleur"),
    energie: str(fd, "energie"),
    reservoir_litres: num(fd, "reservoir_litres"),
    numero_chassis: str(fd, "numero_chassis"),
    carte_grise_numero: str(fd, "carte_grise_numero"),
    date_mise_circulation: str(fd, "date_mise_circulation"),
    capacite_note: str(fd, "capacite_note"),
    notes: str(fd, "notes"),
  });
}

function vehiclePayload(d: z.infer<typeof vehicleSchema>) {
  return {
    type: d.type,
    libelle: d.libelle,
    immatriculation: d.immatriculation ? d.immatriculation.toUpperCase().replace(/\s+/g, "") : null,
    usage: d.usage ?? null,
    marque: d.marque ?? null,
    modele: d.modele ?? null,
    annee: d.annee ?? null,
    couleur: d.couleur ?? null,
    energie: d.energie ?? null,
    reservoir_litres: d.reservoir_litres ?? null,
    numero_chassis: d.numero_chassis?.toUpperCase() ?? null,
    carte_grise_numero: d.carte_grise_numero ?? null,
    date_mise_circulation: d.date_mise_circulation ?? null,
    capacite_note: d.capacite_note ?? null,
    notes: d.notes ?? null,
  };
}

export async function createVehicle(fd: FormData): Promise<Result> {
  const { authId } = await requirePermission("vehicules", "create");
  const parsed = readVehicle(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const km = num(fd, "km");
  if (km !== undefined && (!Number.isInteger(km) || km < 0)) return { error: "Kilométrage invalide." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ ...vehiclePayload(parsed.data), created_by: authId })
    .select("id")
    .single();
  if (error) return { error: dbError(error) };
  if (km !== undefined) {
    await supabase.from("vehicle_odometer_readings").insert({ vehicle_id: data.id, km, source: "saisie" });
  }
  done();
  return { id: data.id };
}

export async function updateVehicle(id: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const parsed = readVehicle(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update(vehiclePayload(parsed.data)).eq("id", id);
  if (error) return { error: dbError(error) };
  done(id);
  return {};
}

const statutSchema = z.enum(["en_service", "immobilise", "vendu"]);

/** Statut posé à la main ; « en panne » vient des pannes immobilisantes (0172). */
export async function setVehicleStatut(id: string, statut: string, actif: boolean): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const parsed = statutSchema.safeParse(statut);
  if (!parsed.success) return { error: "Statut invalide." };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicles").update({ statut: parsed.data, actif }).eq("id", id);
  if (error) return { error: dbError(error) };
  done(id);
  return {};
}

export async function uploadVehiclePhoto(id: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const up = await uploadVehicleFile(id, "photo", fd.get("fichier"));
  if (!up) return { error: "Aucune photo choisie." };
  if ("error" in up) return { error: up.error };
  const supabase = await createClient();
  const { data: before } = await supabase.from("vehicles").select("photo_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("vehicles").update({ photo_path: up.path }).eq("id", id);
  if (error) {
    await removeVehicleFile(up.path);
    return { error: dbError(error) };
  }
  await removeVehicleFile(before?.photo_path);
  done(id);
  return {};
}

export async function addOdometerReading(id: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const km = num(fd, "km");
  if (km === undefined || !Number.isInteger(km) || km < 0) return { error: "Kilométrage invalide." };
  const date = str(fd, "date");
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_odometer_readings").insert({
    vehicle_id: id,
    km,
    source: "saisie",
    releve_le: date && date !== new Date().toISOString().slice(0, 10) ? `${date}T12:00:00Z` : new Date().toISOString(),
  });
  if (error) return { error: dbError(error) };
  done(id);
  return {};
}

// --- Documents ----------------------------------------------------------------------

const documentSchema = z.object({
  type_id: z.string().uuid("Type de document manquant"),
  numero: z.string().trim().max(60).optional(),
  organisme: z.string().trim().max(120).optional(),
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_fin: z.string({ error: "Date d'expiration manquante" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Date d'expiration manquante"),
  montant: z.number().min(0, "Montant invalide").optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function addVehicleDocument(vehicleId: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const parsed = documentSchema.safeParse({
    type_id: str(fd, "type_id"),
    numero: str(fd, "numero"),
    organisme: str(fd, "organisme"),
    date_debut: str(fd, "date_debut"),
    date_fin: str(fd, "date_fin"),
    montant: num(fd, "montant"),
    notes: str(fd, "notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data.date_debut && parsed.data.date_debut > parsed.data.date_fin) return { error: "La date de fin précède la date de début." };
  const up = await uploadVehicleFile(vehicleId, "document", fd.get("fichier"));
  if (up && "error" in up) return { error: up.error };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_documents").insert({
    vehicle_id: vehicleId,
    ...parsed.data,
    numero: parsed.data.numero ?? null,
    organisme: parsed.data.organisme ?? null,
    date_debut: parsed.data.date_debut ?? null,
    montant: parsed.data.montant ?? null,
    notes: parsed.data.notes ?? null,
    fichier_path: up?.path ?? null,
  });
  if (error) {
    await removeVehicleFile(up?.path);
    return { error: dbError(error) };
  }
  // Un document saisi pour un type « non concerné » le rend à nouveau suivi.
  await supabase.from("vehicle_document_exemptions").delete().eq("vehicle_id", vehicleId).eq("type_id", parsed.data.type_id);
  done(vehicleId);
  return {};
}

export async function deleteVehicleDocument(vehicleId: string, documentId: string): Promise<Result> {
  await requirePermission("vehicules", "delete");
  const supabase = await createClient();
  const { data, error } = await supabase.from("vehicle_documents").delete().eq("id", documentId).select("fichier_path").maybeSingle();
  if (error) return { error: dbError(error) };
  await removeVehicleFile(data?.fichier_path);
  done(vehicleId);
  return {};
}

export async function setDocumentExemption(vehicleId: string, typeId: string, exempt: boolean, motif?: string): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const supabase = await createClient();
  const { error } = exempt
    ? await supabase.from("vehicle_document_exemptions").insert({ vehicle_id: vehicleId, type_id: typeId, motif: motif?.trim() || null })
    : await supabase.from("vehicle_document_exemptions").delete().eq("vehicle_id", vehicleId).eq("type_id", typeId);
  if (error) return { error: dbError(error) };
  done(vehicleId);
  return {};
}

// --- Chauffeur ----------------------------------------------------------------------

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function setTitulaire(vehicleId: string, employeId: string | null, debut: string, motif?: string): Promise<Result> {
  await requirePermission("vehicules", "modify");
  if (!dateRe.test(debut)) return { error: "Date de début invalide." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vehicle_titulaire", {
    p_vehicle_id: vehicleId,
    p_employe_id: employeId,
    p_debut: debut,
    p_motif: motif ?? null,
  });
  if (error) return { error: dbError(error) };
  done(vehicleId);
  return {};
}

export async function addRemplacement(vehicleId: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const employeId = str(fd, "employe_id");
  const debut = str(fd, "debut");
  const fin = str(fd, "fin");
  if (!employeId) return { error: "Choisissez le chauffeur remplaçant." };
  if (!debut || !dateRe.test(debut)) return { error: "Date de début manquante." };
  if (fin && (!dateRe.test(fin) || fin < debut)) return { error: "La date de fin précède la date de début." };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_assignments").insert({
    vehicle_id: vehicleId,
    employe_id: employeId,
    type: "remplacement",
    debut,
    fin: fin ?? null,
    motif: str(fd, "motif") ?? null,
  });
  if (error) return { error: dbError(error) };
  done(vehicleId);
  return {};
}

export async function endRemplacement(vehicleId: string, assignmentId: string, fin: string): Promise<Result> {
  await requirePermission("vehicules", "modify");
  if (!dateRe.test(fin)) return { error: "Date de fin invalide." };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_assignments").update({ fin }).eq("id", assignmentId).eq("type", "remplacement");
  if (error) return { error: error.message.includes("vehicle_assignments_dates") ? "La date de fin précède la date de début." : dbError(error) };
  done(vehicleId);
  return {};
}

// --- Pannes et entretien ------------------------------------------------------------

export async function reportIssue(vehicleId: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "create");
  const description = str(fd, "description");
  if (!description || description.length < 3) return { error: "Décrivez la panne." };
  const gravite = str(fd, "gravite") === "immobilisante" ? "immobilisante" : "mineure";
  const up = await uploadVehicleFile(vehicleId, "panne", fd.get("fichier"));
  if (up && "error" in up) return { error: up.error };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_issues").insert({
    vehicle_id: vehicleId,
    description,
    gravite,
    conducteur_id: str(fd, "conducteur_id") ?? null,
    photo_path: up?.path ?? null,
  });
  if (error) {
    await removeVehicleFile(up?.path);
    return { error: dbError(error) };
  }
  done(vehicleId);
  return {};
}

export async function resolveIssue(vehicleId: string, issueId: string, resolution: string): Promise<Result> {
  await requirePermission("vehicules", "modify");
  if (!resolution.trim()) return { error: "Indiquez comment la panne a été réglée." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_issues")
    .update({ statut: "resolue", resolue_le: new Date().toISOString(), resolution: resolution.trim().slice(0, 500) })
    .eq("id", issueId);
  if (error) return { error: dbError(error) };
  done(vehicleId);
  return {};
}

export async function addService(vehicleId: string, fd: FormData): Promise<Result> {
  await requirePermission("vehicules", "modify");
  const typeId = str(fd, "type_id");
  const date = str(fd, "date_intervention");
  const km = num(fd, "km");
  const cout = num(fd, "cout");
  if (!typeId) return { error: "Choisissez le type d'intervention." };
  if (!date || !dateRe.test(date)) return { error: "Date de l'intervention manquante." };
  if (date > new Date().toISOString().slice(0, 10)) return { error: "La date de l'intervention est dans le futur." };
  if (km !== undefined && (!Number.isInteger(km) || km < 0)) return { error: "Kilométrage invalide." };
  if (cout !== undefined && (Number.isNaN(cout) || cout < 0)) return { error: "Coût invalide." };
  const up = await uploadVehicleFile(vehicleId, "facture", fd.get("fichier"));
  if (up && "error" in up) return { error: up.error };
  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_services").insert({
    vehicle_id: vehicleId,
    type_id: typeId,
    date_intervention: date,
    km: km ?? null,
    cout: cout ?? null,
    garage: str(fd, "garage") ?? null,
    description: str(fd, "description") ?? null,
    issue_id: str(fd, "issue_id") ?? null,
    facture_path: up?.path ?? null,
  });
  if (error) {
    await removeVehicleFile(up?.path);
    return { error: dbError(error) };
  }
  done(vehicleId);
  return {};
}
