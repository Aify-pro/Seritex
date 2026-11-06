"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  STATUTS_EMPLOYE,
  TYPES_EMPLOI,
  controlerFichier,
  normaliser,
  type ContexteImport,
  type LigneImport,
  type TypeImport,
} from "@/lib/personnel/import";

/**
 * Paramètres > Personnel (migration 0157) : fiches, import mensuel avec
 * aperçu, application après validation. Droits du module « Personnel » :
 * create/modify/delete pour les fiches, create pour déposer un fichier,
 * validate pour l'appliquer. La base re-vérifie les mêmes droits (RLS).
 */

type Result = { error?: string };

const fin = () => revalidatePath("/parametres/personnel");

const montant = z.number().min(0, "Montant négatif impossible").max(1e10).nullable();

const employeSchema = z
  .object({
    matricule: z.string().trim().min(1, "Matricule obligatoire").max(30),
    nom: z.string().trim().min(1, "Nom obligatoire").max(120),
    fonction: z.string().trim().max(120).transform((v) => v || null),
    type_emploi: z.enum(TYPES_EMPLOI),
    statut: z.enum(STATUTS_EMPLOYE),
    confidentiel: z.boolean(),
    salaire_base: montant,
    primes_fixes: montant,
    avantages: montant,
    charges_patronales: montant,
    date_entree: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    date_sortie: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    notes: z.string().trim().max(500).transform((v) => v || null),
    sections: z.array(z.object({ section_id: z.guid(), pourcentage: z.number().gt(0).max(100) })).max(10),
  })
  .refine((e) => !e.date_entree || !e.date_sortie || e.date_sortie >= e.date_entree, "La sortie est antérieure à l'entrée")
  .refine((e) => e.sections.length === 0 || Math.abs(e.sections.reduce((s, x) => s + x.pourcentage, 0) - 100) < 0.01, "La répartition entre sections doit faire 100 %")
  .refine((e) => new Set(e.sections.map((s) => s.section_id)).size === e.sections.length, "Une section est choisie deux fois");

export type EmployeInput = z.input<typeof employeSchema>;

export async function enregistrerEmploye(id: string | null, input: EmployeInput): Promise<Result> {
  await requirePermission("personnel", id ? "modify" : "create");
  const parsed = employeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const { sections, ...fiche } = parsed.data;

  // Un employé confidentiel n'apporte aucun montant (contrainte en base aussi).
  if (fiche.confidentiel) {
    fiche.salaire_base = null;
    fiche.primes_fixes = null;
    fiche.avantages = null;
    fiche.charges_patronales = null;
  }

  const supabase = await createClient();
  let employeId = id;
  if (id) {
    const { error } = await supabase.from("employes").update(fiche).eq("id", id);
    if (error) return { error: messageErreur(error) };
  } else {
    const { data, error } = await supabase.from("employes").insert({ ...fiche, source: "manuel" }).select("id").single();
    if (error || !data) return { error: messageErreur(error) };
    employeId = data.id as string;
  }

  const { error: errSupp } = await supabase.from("employes_sections").delete().eq("employe_id", employeId!);
  if (errSupp) return { error: errSupp.message };
  if (sections.length > 0) {
    const { error } = await supabase.from("employes_sections").insert(sections.map((s) => ({ ...s, employe_id: employeId! })));
    if (error) return { error: error.message };
  }
  fin();
  return {};
}

export async function supprimerEmploye(id: string): Promise<Result> {
  await requirePermission("personnel", "delete");
  const supabase = await createClient();
  const { error } = await supabase.from("employes").delete().eq("id", id);
  if (error) return { error: error.message };
  fin();
  return {};
}

function messageErreur(error: { code?: string; message: string } | null): string {
  if (!error) return "Enregistrement impossible";
  if (error.code === "23505") return "Ce matricule existe déjà.";
  if (error.code === "23514") return "Une valeur est refusée (un employé confidentiel ne peut pas porter de montant).";
  return error.message;
}

/* ------------------------------------------------------------------------ */
/* Import : aperçu, application, abandon                                    */
/* ------------------------------------------------------------------------ */

const TAILLE_MAX = 2 * 1024 * 1024;
const TYPES: TypeImport[] = ["fiches", "paie", "presence"];

async function contexteImport(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ContexteImport> {
  const [{ data: employes }, { data: sections }] = await Promise.all([
    supabase.from("employes").select("id, matricule, confidentiel"),
    supabase.from("sections").select("id, name"),
  ]);
  return {
    employes: new Map((employes ?? []).map((e) => [normaliser(e.matricule as string), { id: e.id as string, confidentiel: e.confidentiel as boolean }])),
    sections: new Map((sections ?? []).map((s) => [normaliser(s.name as string), { id: s.id as string, nom: s.name as string }])),
  };
}

/**
 * Lit le fichier déposé et enregistre un APERÇU (rien n'est appliqué). La
 * personne voit ce qui sera créé, modifié, ignoré ou refusé, puis valide.
 */
export async function creerApercuImport(formData: FormData): Promise<Result & { id?: string }> {
  const { profile } = await requirePermission("personnel", "create");
  const type = formData.get("type") as TypeImport;
  const fichier = formData.get("fichier");
  if (!TYPES.includes(type)) return { error: "Type d'import inconnu" };
  if (!(fichier instanceof File) || fichier.size === 0) return { error: "Choisissez un fichier CSV" };
  if (fichier.size > TAILLE_MAX) return { error: "Fichier trop volumineux (2 Mo maximum)" };

  const supabase = await createClient();
  const resultat = controlerFichier(type, await fichier.text(), await contexteImport(supabase));
  if (resultat.erreurFichier) return { error: resultat.erreurFichier };

  const lignes = resultat.lignes;
  const { data, error } = await supabase
    .from("imports_personnel")
    .insert({
      type,
      nom_fichier: fichier.name.slice(0, 200),
      mois: resultat.mois ?? null,
      apercu: lignes,
      nb_lignes: lignes.length,
      nb_erreurs: lignes.filter((l) => l.erreurs.length > 0).length,
      nb_creations: lignes.filter((l) => l.action === "creer" && l.erreurs.length === 0).length,
      nb_modifications: lignes.filter((l) => l.action === "modifier" && l.erreurs.length === 0).length,
      cree_par: profile.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Aperçu impossible à enregistrer" };
  fin();
  return { id: data.id as string };
}

async function enParalleleParLots<T>(elements: T[], taille: number, travail: (e: T) => Promise<string | null>): Promise<string | null> {
  for (let i = 0; i < elements.length; i += taille) {
    const erreurs = await Promise.all(elements.slice(i, i + taille).map(travail));
    const premiere = erreurs.find((e) => e);
    if (premiere) return premiere;
  }
  return null;
}

/**
 * Applique un aperçu validé. Refusé s'il reste une erreur : on corrige le
 * fichier et on le redépose. Les écritures sont idempotentes (une ligne par
 * employé / mois / jour) : en cas d'échec en cours de route, on peut relancer.
 */
export async function appliquerImport(importId: string): Promise<Result> {
  const { profile } = await requirePermission("personnel", "validate");
  const supabase = await createClient();
  const { data: lot, error: errLot } = await supabase.from("imports_personnel").select("id, type, statut, apercu, nb_erreurs").eq("id", importId).single();
  if (errLot || !lot) return { error: "Import introuvable" };
  if (lot.statut !== "apercu") return { error: "Cet import a déjà été traité" };
  if ((lot.nb_erreurs as number) > 0) return { error: "Des lignes sont en erreur : corrigez le fichier et déposez-le à nouveau" };

  const type = lot.type as TypeImport;
  const lignes = (lot.apercu as LigneImport[]).filter((l) => l.action !== "ignorer");
  const ctx = await contexteImport(supabase);
  const idDe = (matricule: string) => ctx.employes.get(normaliser(matricule))?.id;
  let erreur: string | null = null;

  if (type === "fiches") {
    erreur = await enParalleleParLots(lignes, 20, async (l) => {
      const d = l.donnees as Record<string, unknown> & { sections: { section_id: string; pourcentage: number }[]; section_renseignee: boolean };
      const { sections, section_renseignee, ...fiche } = d;
      let employeId = idDe(l.matricule);
      if (employeId) {
        const { error } = await supabase.from("employes").update({ ...fiche, source: "import" }).eq("id", employeId);
        if (error) return `Ligne ${l.ligne} : ${messageErreur(error)}`;
      } else {
        const { data, error } = await supabase.from("employes").insert({ ...fiche, source: "import" }).select("id").single();
        if (error || !data) return `Ligne ${l.ligne} : ${messageErreur(error)}`;
        employeId = data.id as string;
      }
      if (section_renseignee) {
        const { error: e1 } = await supabase.from("employes_sections").delete().eq("employe_id", employeId);
        if (e1) return `Ligne ${l.ligne} : ${e1.message}`;
        if (sections.length > 0) {
          const { error: e2 } = await supabase.from("employes_sections").insert(sections.map((s) => ({ ...s, employe_id: employeId })));
          if (e2) return `Ligne ${l.ligne} : ${e2.message}`;
        }
      }
      return null;
    });
  } else {
    const table = type === "paie" ? "paies_mensuelles" : "presences_employes";
    const conflit = type === "paie" ? "employe_id,mois" : "employe_id,jour";
    const lignesBase = lignes.flatMap((l) => {
      const employeId = idDe(l.matricule);
      if (!employeId) return [];
      const { matricule: _matricule, ...reste } = l.donnees as Record<string, unknown>;
      void _matricule;
      return [{ ...reste, employe_id: employeId, import_id: importId }];
    });
    for (let i = 0; i < lignesBase.length && !erreur; i += 500) {
      const { error } = await supabase.from(table).upsert(lignesBase.slice(i, i + 500), { onConflict: conflit });
      if (error) erreur = error.message;
    }
  }

  if (erreur) return { error: erreur };
  const { error } = await supabase
    .from("imports_personnel")
    .update({ statut: "applique", applique_par: profile.id, applique_le: new Date().toISOString() })
    .eq("id", importId)
    .eq("statut", "apercu");
  if (error) return { error: error.message };
  fin();
  return {};
}

export async function abandonnerImport(importId: string): Promise<Result> {
  await requirePermission("personnel", "create");
  const supabase = await createClient();
  const { error } = await supabase.from("imports_personnel").update({ statut: "abandonne", apercu: [] }).eq("id", importId).eq("statut", "apercu");
  if (error) return { error: error.message };
  fin();
  return {};
}
