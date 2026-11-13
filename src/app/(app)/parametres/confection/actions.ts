"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";

/**
 * Paramètres > Atelier > Confection : chaînes de couture, postes, types de
 * machines, agents de chaîne. Les règles de sécurité de la migration 0186
 * re-vérifient le droit « Paramètres confection » en base.
 */
type Result = { error?: string };

const done = () => {
  revalidatePath("/parametres/confection");
  revalidatePath("/confection");
};

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const err = (e: { code?: string; message: string }) => {
  if (e.code === "23505") return "Ce code, ce nom ou ce numéro existe déjà.";
  if (e.code === "23503") return "Impossible : cet élément est encore utilisé (désactivez-le plutôt).";
  if (e.code === "23514") return "Valeur refusée : vérifiez le code (lettres, chiffres, tiret) et les nombres.";
  if (e.code === "42501" || /row-level security/i.test(e.message)) return "Droit insuffisant.";
  return e.message;
};

export async function saveChaine(fd: FormData): Promise<Result> {
  const id = str(fd, "id");
  await requirePermission("parametres_confection", id ? "modify" : "create");
  const nom = str(fd, "nom");
  const code = str(fd, "code");
  const sectionId = str(fd, "section_id");
  const minutes = Number(str(fd, "minutes_jour") ?? "480");
  if (!nom || !code || !sectionId) return { error: "Nom, code et section sont obligatoires." };
  if (!Number.isInteger(minutes) || minutes < 60 || minutes > 1440) return { error: "Minutes par jour : entre 60 et 1440." };
  const row = {
    nom,
    code: code.toUpperCase(),
    section_id: sectionId,
    type: str(fd, "type") === "support" ? "support" : "permanente",
    minutes_jour: minutes,
    active: id ? bool(fd, "active") : true,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("chaines_couture").update(row).eq("id", id)
    : await supabase.from("chaines_couture").insert(row);
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function savePoste(fd: FormData): Promise<Result> {
  const id = str(fd, "id");
  await requirePermission("parametres_confection", id ? "modify" : "create");
  const sectionId = str(fd, "section_id");
  const numero = Number(str(fd, "numero"));
  if (!sectionId || !Number.isInteger(numero) || numero < 1) return { error: "Numéro de poste invalide." };
  const row = {
    chaine_id: str(fd, "chaine_id") ?? null,
    section_id: sectionId,
    numero,
    libelle: str(fd, "libelle") ?? null,
    type_machine_id: str(fd, "type_machine_id") ?? null,
    actif: id ? bool(fd, "actif") : true,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("postes_couture").update(row).eq("id", id)
    : await supabase.from("postes_couture").insert(row);
  if (error) return { error: err(error) };
  done();
  return {};
}

/** Crée d'un coup les postes 1 à N qui manquent à une chaîne. */
export async function creerPostes(fd: FormData): Promise<Result> {
  await requirePermission("parametres_confection", "create");
  const chaineId = str(fd, "chaine_id");
  const sectionId = str(fd, "section_id");
  const n = Number(str(fd, "nombre"));
  if (!chaineId || !sectionId || !Number.isInteger(n) || n < 1 || n > 200) return { error: "Nombre de postes : entre 1 et 200." };
  const supabase = await createClient();
  const { data: existants } = await supabase.from("postes_couture").select("numero").eq("chaine_id", chaineId);
  const pris = new Set((existants ?? []).map((p) => p.numero as number));
  const rows = [];
  for (let i = 1; i <= n; i += 1) if (!pris.has(i)) rows.push({ chaine_id: chaineId, section_id: sectionId, numero: i });
  if (rows.length === 0) return { error: "Ces postes existent déjà." };
  const { error } = await supabase.from("postes_couture").insert(rows);
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function deletePoste(fd: FormData): Promise<Result> {
  await requirePermission("parametres_confection", "modify");
  const id = str(fd, "id");
  if (!id) return { error: "Poste introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.from("postes_couture").delete().eq("id", id);
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function saveTypeMachine(fd: FormData): Promise<Result> {
  const id = str(fd, "id");
  await requirePermission("parametres_confection", id ? "modify" : "create");
  const nom = str(fd, "nom");
  if (!nom) return { error: "Le nom est obligatoire." };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("types_machines_couture").update({ nom, active: bool(fd, "active") }).eq("id", id)
    : await supabase.from("types_machines_couture").insert({ nom });
  if (error) return { error: err(error) };
  done();
  return {};
}

export async function addAgent(fd: FormData): Promise<Result> {
  await requirePermission("parametres_confection", "modify");
  const chaineId = str(fd, "chaine_id");
  const userId = str(fd, "user_id");
  if (!chaineId || !userId) return { error: "Choisissez un compte." };
  const supabase = await createClient();
  const { error } = await supabase.from("chaine_agents").insert({ chaine_id: chaineId, user_id: userId });
  if (error) return { error: error.code === "23505" ? "Ce compte est déjà agent de cette chaîne." : err(error) };
  done();
  return {};
}

export async function removeAgent(fd: FormData): Promise<Result> {
  await requirePermission("parametres_confection", "modify");
  const id = str(fd, "id");
  if (!id) return { error: "Agent introuvable." };
  const supabase = await createClient();
  const { error } = await supabase.from("chaine_agents").delete().eq("id", id);
  if (error) return { error: err(error) };
  done();
  return {};
}
