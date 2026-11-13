"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";

/**
 * Actions du module Confection (lot 1, migration 0186). Les gardes ci-dessous
 * donnent un refus lisible ; la base re-vérifie tout (règles de sécurité et
 * fonctions `livrer_paquet_chaine`, `sortir_chaine`…), y compris que l'agent
 * agit bien pour SA chaîne.
 */
type Result = { error?: string };

const done = (chaineId?: string) => {
  revalidatePath("/confection");
  revalidatePath("/tablette-chaine");
  if (chaineId) revalidatePath(`/confection/chaines/${chaineId}`);
};

const err = (e: { code?: string; message: string }) => {
  if (e.code === "42501" || /row-level security/i.test(e.message)) return "Droit insuffisant.";
  if (e.code === "23505") return "Déjà enregistré.";
  return e.message;
};

// --- Pilotage par le chef de section -------------------------------------------------

export async function attribuerTravail(chaineId: string, workOrderId: string, priorite: number, consigne: string): Promise<Result> {
  await requirePermission("confection", "create");
  const supabase = await createClient();
  const { error } = await supabase.from("chaine_travaux").insert({
    chaine_id: chaineId,
    work_order_id: workOrderId,
    priorite: Number.isInteger(priorite) ? priorite : 0,
    consigne: consigne.trim() || null,
  });
  if (error) return { error: error.code === "23505" ? "Ce travail est déjà attribué à cette chaîne." : err(error) };
  done(chaineId);
  return {};
}

export async function changerStatutTravail(id: string, chaineId: string, statut: "a_faire" | "en_cours" | "termine"): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const { error } = await supabase
    .from("chaine_travaux")
    .update({ statut, termine_le: statut === "termine" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export async function changerPrioriteTravail(id: string, chaineId: string, priorite: number, consigne: string): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("chaine_travaux").update({ priorite, consigne: consigne.trim() || null }).eq("id", id);
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

/** Retire un travail attribué par erreur — seulement s'il n'a pas commencé. */
export async function retirerTravail(id: string, chaineId: string): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("chaine_travaux").delete().eq("id", id).eq("statut", "a_faire");
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

/** Affecte une personne à la chaîne : sa place précédente se ferme, rien n'est écrasé. */
export async function affecterEmploye(chaineId: string, employeId: string, fonction: string, posteId: string | null): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const maintenant = new Date().toISOString();
  const { error: e1 } = await supabase.from("affectations_couture").update({ fin: maintenant }).eq("employe_id", employeId).is("fin", null);
  if (e1) return { error: err(e1) };
  const { error } = await supabase.from("affectations_couture").insert({
    employe_id: employeId,
    chaine_id: chaineId,
    poste_id: posteId,
    fonction: ["couture", "chef_chaine", "agent", "commun", "autre"].includes(fonction) ? fonction : "couture",
    debut: maintenant,
  });
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export async function terminerAffectation(id: string, chaineId: string): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("affectations_couture").update({ fin: new Date().toISOString() }).eq("id", id).is("fin", null);
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export async function regulariserSortie(id: string, chaineId: string, motif: string): Promise<Result> {
  await requirePermission("confection", "modify");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regulariser_sortie_chaine", { p_sortie_id: id, p_motif: motif.trim() || null });
  if (error) return { error: err(error) };
  done(chaineId);
  return typeof data === "string" && data ? { error: data } : {};
}

export async function corrigerSortie(id: string, chaineId: string, ecart: number, motif: string): Promise<Result> {
  await requirePermission("confection_ravitaillement", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("corriger_sortie_chaine", { p_sortie_id: id, p_ecart: ecart, p_motif: motif });
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

// --- Effectif et arrêts (chef ou agent de la chaîne) -----------------------------------

export async function saisirEffectif(chaineId: string, jour: string, presents: number): Promise<Result> {
  await requirePermission("confection_ravitaillement", "view");
  if (!Number.isInteger(presents) || presents < 0 || presents > 500) return { error: "Effectif invalide." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("presences_chaine")
    .upsert({ chaine_id: chaineId, jour, presents, saisi_le: new Date().toISOString() }, { onConflict: "chaine_id,jour" });
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export async function ouvrirArret(chaineId: string, cause: string, commentaire: string): Promise<Result> {
  await requirePermission("confection_ravitaillement", "view");
  const supabase = await createClient();
  const { error } = await supabase.from("arrets_chaine").insert({ chaine_id: chaineId, cause, commentaire: commentaire.trim() || null });
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export async function fermerArret(id: string, chaineId: string): Promise<Result> {
  await requirePermission("confection_ravitaillement", "view");
  const supabase = await createClient();
  const { error } = await supabase.from("arrets_chaine").update({ fin: new Date().toISOString() }).eq("id", id).is("fin", null);
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

// --- Tablette de l'agent -----------------------------------------------------------------

export type ApercuPaquet = {
  code: string;
  odf: string | null;
  article: string | null;
  piece: string | null;
  tailles: Record<string, number>;
  chaineActuelle: string | null;
};

/** Ce que le scan affiche avant de livrer : article, pièce, quantités — jamais le client. */
export async function apercuPaquet(code: string): Promise<{ error?: string; paquet?: ApercuPaquet }> {
  await requirePermission("confection_ravitaillement", "view");
  const clean = code.trim().toUpperCase();
  if (!clean) return { error: "Code de paquet vide" };
  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("article_lots")
    .select("code,statut,composition_taille,chaine_id,product_models(name),production_orders(reference),production_order_lines(description),chaines_couture(nom)")
    .eq("code", clean)
    .maybeSingle();
  if (!lot) return { error: `Paquet inconnu : ${clean}` };
  const l = lot as unknown as {
    code: string;
    statut: string;
    composition_taille: Record<string, number>;
    product_models: { name: string } | null;
    production_orders: { reference: string } | null;
    production_order_lines: { description: string | null } | null;
    chaines_couture: { nom: string } | null;
  };
  if (l.statut === "eclate") return { error: `Le paquet ${clean} a été entièrement divisé : scannez un de ses sous-paquets.` };
  if (l.statut !== "en_cours") return { error: `Le paquet ${clean} n'est plus en cours (${l.statut}).` };
  return {
    paquet: {
      code: l.code,
      odf: l.production_orders?.reference ?? null,
      article: l.production_order_lines?.description ?? null,
      piece: l.product_models?.name ?? null,
      tailles: l.composition_taille ?? {},
      chaineActuelle: l.chaines_couture?.nom ?? null,
    },
  };
}

export type Livraison = {
  code: string;
  origine: string;
  nouveau_paquet: boolean;
  composition: Record<string, number>;
  total: number;
  reste: Record<string, number>;
  chaine: string;
  deja_enregistre?: boolean;
};

/**
 * Livre un paquet à la chaîne, en entier (`composition` null) ou en partie.
 * `cle` : identifiant du geste, créé par la tablette — renvoyé tel quel après
 * une coupure réseau, il ne compte qu'une fois.
 */
export async function livrerPaquet(
  code: string,
  chaineId: string,
  composition: Record<string, number> | null,
  cle: string
): Promise<{ error?: string; livraison?: Livraison }> {
  await requirePermission("confection_ravitaillement", "create");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("livrer_paquet_chaine", {
    p_code: code.trim().toUpperCase(),
    p_chaine_id: chaineId,
    p_composition: composition,
    p_comptage: null,
    p_cle: cle,
  });
  if (error) return { error: err(error) };
  done(chaineId);
  return { livraison: data as Livraison };
}

export async function retournerPaquet(code: string, chaineId: string, motif: string, cle: string): Promise<Result> {
  await requirePermission("confection_ravitaillement", "create");
  const supabase = await createClient();
  const { error } = await supabase.rpc("retourner_paquet_chaine", { p_code: code, p_motif: motif, p_cle: cle });
  if (error) return { error: err(error) };
  done(chaineId);
  return {};
}

export type SortieEnregistree = {
  total: number;
  lot_code: string | null;
  bonnes: Record<string, number>;
  a_regulariser: { taille: string; type: string; message: string }[];
  chaine: string;
  deja_enregistre?: boolean;
};

export async function sortirChaine(
  chaineId: string,
  workOrderId: string,
  lignes: { taille: string; type: "bonne" | "reprise" | "rebut"; quantite: number }[],
  cle: string
): Promise<{ error?: string; sortie?: SortieEnregistree }> {
  await requirePermission("confection_ravitaillement", "create");
  const utiles = lignes.filter((l) => Number.isInteger(l.quantite) && l.quantite > 0);
  if (utiles.length === 0) return { error: "Aucune quantité saisie." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sortir_chaine", { p_chaine_id: chaineId, p_work_order_id: workOrderId, p_lignes: utiles, p_cle: cle });
  if (error) return { error: err(error) };
  done(chaineId);
  return { sortie: data as SortieEnregistree };
}
