"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  STATUTS_EMPLOYE,
  TYPES_CONTRAT,
  TYPES_EMPLOI,
  controlerFiches,
  controlerPresence,
  lireCsv,
  normaliser,
  type ContexteImport,
  type LigneImport,
  type TypeImport,
} from "@/lib/personnel/import";
import {
  comparerLivres,
  controlerLivre,
  decoderLivre,
  type CategorieRubrique,
  type Comparatif,
  type MappingRubriques,
  type PaieEmploye,
} from "@/lib/personnel/livre-paie";
import { lireClasseur } from "@/lib/personnel/xlsx";

/**
 * Paramètres > Personnel (migrations 0157 et 0159) : fiches, imports avec
 * aperçu (liste Excel, livre de paie Sage, présence), correspondance des
 * rubriques et des ateliers, alertes. Droits du module « Personnel » :
 * create/modify/delete pour les fiches, create pour déposer un fichier,
 * validate pour l'appliquer et traiter une alerte. La base re-vérifie les
 * mêmes droits (RLS).
 */

type Result = { error?: string };
type Client = Awaited<ReturnType<typeof createClient>>;

const fin = () => revalidatePath("/parametres/personnel", "layout");

const montant = z.number().min(0, "Montant négatif impossible").max(1e10).nullable();

const employeSchema = z
  .object({
    matricule: z.string().trim().min(1, "Matricule obligatoire").max(30),
    nom: z.string().trim().min(1, "Nom obligatoire").max(120),
    prenom: z.string().trim().max(120).transform((v) => v || null),
    fonction: z.string().trim().max(120).transform((v) => v || null),
    type_emploi: z.enum(TYPES_EMPLOI),
    type_contrat: z.enum(TYPES_CONTRAT).nullable(),
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
/* Contexte des imports                                                     */
/* ------------------------------------------------------------------------ */

async function contexteImport(supabase: Client): Promise<ContexteImport> {
  const [{ data: employes }, { data: ateliers }, { data: departements }, { data: liens }] = await Promise.all([
    supabase.from("employes").select("id, matricule, nom, prenom, confidentiel, departement_code").limit(10000),
    supabase.from("ateliers_vers_sections").select("atelier, libelle, section_id, structure"),
    supabase.from("departements").select("code, libelle, section_id, structure"),
    supabase.from("employes_sections").select("employe_id").limit(20000),
  ]);
  const avecSection = new Set((liens ?? []).map((l) => l.employe_id as string));
  const mapDepartements: NonNullable<ContexteImport["departements"]> = new Map();
  for (const d of departements ?? []) {
    const valeur = { code: d.code as string, sectionId: (d.section_id as string | null) ?? null, structure: d.structure as boolean };
    mapDepartements.set(d.code as string, valeur);
    mapDepartements.set(normaliser(d.libelle as string), valeur);
  }
  const mapAteliers: NonNullable<ContexteImport["ateliers"]> = new Map();
  for (const a of ateliers ?? []) {
    const valeur = { atelier: a.atelier as string, sectionId: (a.section_id as string | null) ?? null, structure: a.structure as boolean };
    mapAteliers.set(normaliser(a.atelier as string), valeur);
    if (a.libelle) mapAteliers.set(normaliser(a.libelle as string), valeur);
  }
  return {
    employes: new Map(
      (employes ?? []).map((e) => [
        normaliser(e.matricule as string),
        {
          id: e.id as string,
          confidentiel: e.confidentiel as boolean,
          nomComplet: `${e.nom} ${(e.prenom as string | null) ?? ""}`.trim(),
          departementCode: (e.departement_code as string | null) ?? null,
          aSection: avecSection.has(e.id as string),
        },
      ])
    ),
    ateliers: mapAteliers,
    departements: mapDepartements,
  };
}

async function chargerMapping(supabase: Client): Promise<MappingRubriques> {
  const { data } = await supabase.from("paie_rubriques").select("code, categorie");
  return new Map((data ?? []).map((r) => [r.code as string, (r.categorie as CategorieRubrique | null) ?? null]));
}

/**
 * Une erreur imprévue pendant un import (fichier illisible, base indisponible…)
 * ne doit jamais afficher la page d'erreur générique : on renvoie un message.
 * Les redirections de Next (droit refusé) sont relancées telles quelles.
 */
async function proteger<T extends Result>(travail: () => Promise<T>, libelle: string): Promise<T | Result> {
  try {
    return await travail();
  } catch (e) {
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    console.error(`[personnel] ${libelle}`, e);
    return { error: `${libelle} : ${(e as Error)?.message ?? "erreur inattendue"}` };
  }
}

/* ------------------------------------------------------------------------ */
/* Import : aperçu                                                          */
/* ------------------------------------------------------------------------ */

const TAILLE_MAX = 5 * 1024 * 1024;
const TYPES: TypeImport[] = ["fiches", "paie", "presence"];

/**
 * Lit le fichier déposé et enregistre un APERÇU (rien n'est appliqué). La
 * personne voit ce qui sera créé, sauté ou refusé — et, pour un livre de paie,
 * le comparatif avec le livre précédent — puis valide.
 */
export async function creerApercuImport(formData: FormData): Promise<Result & { id?: string }> {
  return proteger(() => creerApercu(formData), "Lecture du fichier impossible");
}

async function creerApercu(formData: FormData): Promise<Result & { id?: string }> {
  const { profile } = await requirePermission("personnel", "create");
  const type = formData.get("type") as TypeImport;
  const fichier = formData.get("fichier");
  const mois = String(formData.get("mois") ?? "");
  if (!TYPES.includes(type)) return { error: "Type d'import inconnu" };
  if (!(fichier instanceof File) || fichier.size === 0) return { error: "Choisissez un fichier" };
  if (fichier.size > TAILLE_MAX) return { error: "Fichier trop volumineux (5 Mo maximum)" };

  const supabase = await createClient();
  const ctx = await contexteImport(supabase);
  const octets = await fichier.arrayBuffer();
  const estExcel = /\.xlsx$/i.test(fichier.name);

  let lignes: LigneImport[] = [];
  let moisLot: string | null = null;
  let empreinte: string | null = null;
  let comparatif: (Comparatif & { mois_courant: string; mois_deja_importe: boolean }) | null = null;
  let aClasser: string[] = [];
  let nbInactifs = 0;

  if (type === "paie") {
    if (!/^\d{4}-\d{2}$/.test(mois)) return { error: "Choisissez le mois de ce livre de paie" };
    moisLot = `${mois}-01`;
    const mapping = await chargerMapping(supabase);
    const lu = controlerLivre(decoderLivre(new Uint8Array(octets)), moisLot, ctx, mapping);
    if (lu.erreurFichier) return { error: lu.erreurFichier };
    lignes = lu.lignes;
    empreinte = lu.empreinte;
    aClasser = lu.inconnues;
    nbInactifs = lu.nbInactifs;

    // Nouvelles rubriques : enregistrées « à classer », jamais ignorées en silence.
    if (aClasser.length > 0) {
      const libelles = new Map<string, string>();
      for (const e of lu.employes) for (const code of Object.keys(e.detail)) if (aClasser.includes(code)) libelles.set(code, code);
      await supabase.from("paie_rubriques").upsert(aClasser.map((code) => ({ code, libelle: libelles.get(code) ?? code, categorie: null })), { onConflict: "code", ignoreDuplicates: true });
    }

    // Comparatif avec le livre précédent et détection d'un livre identique.
    const [{ data: precedents }, { data: identique }, { data: dejaImporte }] = await Promise.all([
      supabase.from("paies_mensuelles").select("mois").lt("mois", moisLot).order("mois", { ascending: false }).limit(1),
      supabase.from("imports_personnel").select("id, mois").eq("type", "paie").eq("empreinte", lu.empreinte).neq("statut", "abandonne").limit(1),
      supabase.from("paies_mensuelles").select("mois").eq("mois", moisLot).limit(1),
    ]);
    let precedent: { mois: string; lignes: { matricule: string; cout_mois: number }[] } | null = null;
    const moisPrecedent = (precedents?.[0]?.mois as string | undefined) ?? null;
    if (moisPrecedent) {
      const { data: paies } = await supabase.from("paies_mensuelles").select("cout_mois, employes(matricule)").eq("mois", moisPrecedent);
      precedent = {
        mois: moisPrecedent,
        lignes: (paies ?? []).map((p) => ({
          matricule: (p.employes as unknown as { matricule: string } | null)?.matricule ?? "",
          cout_mois: Number(p.cout_mois),
        })),
      };
    }
    const comp = comparerLivres(lu.employes as PaieEmploye[], precedent, identique?.[0] ? { id: identique[0].id as string, mois: (identique[0].mois as string | null) ?? null } : null, moisLot);
    comparatif = { ...comp, mois_courant: moisLot, mois_deja_importe: (dejaImporte?.length ?? 0) > 0 };
  } else if (type === "fiches") {
    const cellules = estExcel ? await lireClasseur(octets) : lireCsv(new TextDecoder("utf-8").decode(octets));
    const lu = controlerFiches(cellules, ctx);
    if (lu.erreurFichier) return { error: lu.erreurFichier };
    lignes = lu.lignes;
  } else {
    const lu = controlerPresence(new TextDecoder("utf-8").decode(octets), ctx);
    if (lu.erreurFichier) return { error: lu.erreurFichier };
    lignes = lu.lignes;
  }

  if (lignes.length === 0) return { error: type === "paie" ? "Aucun employé payé dans ce livre de paie." : "Aucune ligne lisible dans ce fichier." };

  const { data, error } = await supabase
    .from("imports_personnel")
    .insert({
      type,
      nom_fichier: fichier.name.slice(0, 200),
      mois: moisLot,
      apercu: lignes,
      nb_lignes: lignes.length,
      nb_erreurs: lignes.filter((l) => l.erreurs.length > 0).length,
      nb_creations: lignes.filter((l) => l.action === "creer" && l.erreurs.length === 0).length,
      nb_modifications: lignes.filter((l) => l.action === "modifier" && l.erreurs.length === 0).length,
      comparatif: comparatif ? { ...comparatif, nb_inactifs: nbInactifs } : null,
      empreinte,
      rubriques_a_classer: aClasser,
      cree_par: profile.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Aperçu impossible à enregistrer" };

  // Alertes : visibles de la RH et de la direction (droit « Personnel »), dès le dépôt.
  if (comparatif && comparatif.alertes.length > 0) {
    await supabase.from("alertes").insert(
      comparatif.alertes.map((a) => ({
        type: "livre_paie",
        gravite: a.gravite,
        titre: a.titre,
        detail: a.detail,
        lien: "/parametres/personnel",
        module_cible: "personnel",
        reference: { import_id: data.id, mois: moisLot },
        cree_par: profile.id,
      }))
    );
  }
  fin();
  return { id: data.id as string };
}

/* ------------------------------------------------------------------------ */
/* Import : application, abandon                                            */
/* ------------------------------------------------------------------------ */

async function enParalleleParLots<T>(elements: T[], taille: number, travail: (e: T) => Promise<string | null>): Promise<string | null> {
  for (let i = 0; i < elements.length; i += taille) {
    const erreurs = await Promise.all(elements.slice(i, i + taille).map(travail));
    const premiere = erreurs.find((e) => e);
    if (premiere) return premiere;
  }
  return null;
}

/**
 * Applique un aperçu validé. Refusé s'il reste une erreur ou une rubrique à
 * classer. Si le comparatif a levé une alerte forte (livre identique ou quasi
 * identique au précédent), un motif écrit est obligatoire — pas de blocage dur.
 * Les écritures sont idempotentes : en cas d'échec en cours de route, on peut relancer.
 */
export async function appliquerImport(importId: string, motif?: string): Promise<Result> {
  return proteger(() => appliquer(importId, motif), "Application de l'import impossible");
}

async function appliquer(importId: string, motif?: string): Promise<Result> {
  const { profile } = await requirePermission("personnel", "validate");
  const supabase = await createClient();
  const { data: lot, error: errLot } = await supabase
    .from("imports_personnel")
    .select("id, type, statut, apercu, nb_erreurs, comparatif, rubriques_a_classer")
    .eq("id", importId)
    .single();
  if (errLot || !lot) return { error: "Import introuvable" };
  if (lot.statut !== "apercu") return { error: "Cet import a déjà été traité" };
  if ((lot.nb_erreurs as number) > 0) return { error: "Des lignes sont en erreur : corrigez le fichier et déposez-le à nouveau" };
  if (((lot.rubriques_a_classer as string[] | null) ?? []).length > 0) {
    return { error: "Des rubriques de paie sont à classer : classez-les, puis déposez à nouveau le fichier" };
  }

  const comparatif = lot.comparatif as Comparatif | null;
  const alerteForte = (comparatif?.alertes ?? []).some((a) => a.gravite === "critique");
  const motifNettoye = (motif ?? "").trim();
  if (alerteForte && motifNettoye.length < 10) {
    return { error: "Ce livre de paie est identique ou quasi identique au précédent : écrivez le motif de la validation (10 caractères au moins)." };
  }

  const type = lot.type as TypeImport;
  const lignes = (lot.apercu as LigneImport[]).filter((l) => l.action !== "ignorer");
  const ctx = await contexteImport(supabase);
  const idDe = (matricule: string) => ctx.employes.get(normaliser(matricule))?.id;
  let erreur: string | null = null;

  if (type === "fiches") {
    // Ateliers inconnus : ajoutés à la table, « à classer » dans Paramètres.
    const inconnus = new Map<string, string>();
    for (const l of lignes) {
      const d = l.donnees as { atelier_source: string | null; atelier_libelle: string | null };
      if (d.atelier_source && !ctx.ateliers?.has(normaliser(d.atelier_source))) inconnus.set(d.atelier_source, d.atelier_libelle ?? d.atelier_source);
    }
    if (inconnus.size > 0) {
      await supabase.from("ateliers_vers_sections").upsert([...inconnus].map(([atelier, libelle]) => ({ atelier, libelle })), { onConflict: "atelier", ignoreDuplicates: true });
    }
    // Fiches existantes complétées : seul le département est ajouté (rien n'est écrasé),
    // avec la section qui en découle si l'employé n'en a pas encore.
    const complements = lignes.filter((l) => idDe(l.matricule) && (l.donnees as { complement?: boolean }).complement);
    erreur = await enParalleleParLots(complements, 20, async (l) => {
      const d = l.donnees as { departement_code: string; sections: { section_id: string; pourcentage: number }[]; type_emploi: string; a_section: boolean };
      const employeId = idDe(l.matricule)!;
      const { error } = await supabase
        .from("employes")
        .update({ departement_code: d.departement_code, ...(d.type_emploi === "structure" ? { type_emploi: "structure" } : {}) })
        .eq("id", employeId)
        .is("departement_code", null);
      if (error) return `Ligne ${l.ligne} : ${error.message}`;
      if (!d.a_section && d.sections.length > 0) {
        const { error: e2 } = await supabase.from("employes_sections").insert(d.sections.map((x) => ({ ...x, employe_id: employeId })));
        if (e2) return `Ligne ${l.ligne} : ${e2.message}`;
      }
      return null;
    });
    const nouvelles = erreur ? [] : lignes.filter((l) => !idDe(l.matricule));
    for (let i = 0; i < nouvelles.length && !erreur; i += 200) {
      const lot200 = nouvelles.slice(i, i + 200);
      const { data, error } = await supabase
        .from("employes")
        .insert(
          lot200.map((l) => {
            const { sections: _s, atelier_libelle: _a, complement: _c, a_section: _as, ...fiche } = l.donnees as Record<string, unknown>;
            void _s;
            void _a;
            void _c;
            void _as;
            return { ...fiche, source: "import" };
          })
        )
        .select("id, matricule");
      if (error || !data) {
        erreur = error ? messageErreur(error) : "Insertion impossible";
        break;
      }
      const ids = new Map(data.map((e) => [normaliser(e.matricule as string), e.id as string]));
      const liens = lot200.flatMap((l) =>
        ((l.donnees as { sections: { section_id: string; pourcentage: number }[] }).sections ?? []).map((s) => ({ ...s, employe_id: ids.get(normaliser(l.matricule))! }))
      );
      if (liens.length > 0) {
        const { error: errLiens } = await supabase.from("employes_sections").insert(liens);
        if (errLiens) erreur = errLiens.message;
      }
    }
  } else if (type === "paie") {
    const lignesPaie = lignes.flatMap((l) => {
      const employeId = idDe(l.matricule);
      if (!employeId) return [];
      const d = l.donnees as Record<string, unknown>;
      return [
        {
          employe_id: employeId,
          mois: d.mois,
          salaire_base: d.salaire_base,
          primes: d.primes,
          heures_sup: d.heures_sup,
          indemnites: d.indemnites,
          avantages: d.avantages,
          charges_patronales: d.charges_patronales,
          brut_sage: d.brut_sage,
          cout_total_sage: d.cout_total_sage,
          heures_sup_nb: d.heures_sup_nb,
          heures_travaillees: d.heures_travaillees,
          jours_travailles: d.jours_travailles,
          detail: d.detail,
          import_id: importId,
        },
      ];
    });
    for (let i = 0; i < lignesPaie.length && !erreur; i += 200) {
      const { error } = await supabase.from("paies_mensuelles").upsert(lignesPaie.slice(i, i + 200), { onConflict: "employe_id,mois" });
      if (error) erreur = error.message;
    }
    if (!erreur) {
      // Type de salaire (mensuel / horaire), déduit des rubriques du livre.
      const typees = lignes.filter((l) => (l.donnees as { type_salaire: string | null }).type_salaire && idDe(l.matricule));
      erreur = await enParalleleParLots(typees, 20, async (l) => {
        const { error } = await supabase.from("employes").update({ type_salaire: (l.donnees as { type_salaire: string }).type_salaire }).eq("id", idDe(l.matricule)!);
        return error ? error.message : null;
      });
    }
  } else {
    const lignesPresence = lignes.flatMap((l) => {
      const employeId = idDe(l.matricule);
      if (!employeId) return [];
      const { matricule: _m, ...reste } = l.donnees as Record<string, unknown>;
      void _m;
      return [{ ...reste, employe_id: employeId, import_id: importId }];
    });
    for (let i = 0; i < lignesPresence.length && !erreur; i += 500) {
      const { error } = await supabase.from("presences_employes").upsert(lignesPresence.slice(i, i + 500), { onConflict: "employe_id,jour" });
      if (error) erreur = error.message;
    }
  }

  if (erreur) return { error: erreur };
  const { error } = await supabase
    .from("imports_personnel")
    .update({ statut: "applique", applique_par: profile.id, applique_le: new Date().toISOString(), motif_validation: motifNettoye || null })
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

/* ------------------------------------------------------------------------ */
/* Rubriques, ateliers, alertes                                             */
/* ------------------------------------------------------------------------ */

const CATEGORIES = ["salaire_base", "prime", "heures_sup", "indemnite", "avantage", "charges_patronales", "controle", "volume", "retenue", "ignore"] as const;

export async function classerRubrique(code: string, categorie: string): Promise<Result> {
  await requirePermission("personnel", "modify");
  if (!(CATEGORIES as readonly string[]).includes(categorie)) return { error: "Catégorie inconnue" };
  const supabase = await createClient();
  const { error } = await supabase.from("paie_rubriques").update({ categorie }).eq("code", code);
  if (error) return { error: error.message };
  fin();
  return {};
}

/** `cible` : « structure », « aucune » (à classer) ou l'identifiant d'une section. */
export async function classerAtelier(atelier: string, cible: string): Promise<Result> {
  await requirePermission("personnel", "modify");
  const supabase = await createClient();
  const valeurs =
    cible === "structure" ? { structure: true, section_id: null } : cible === "aucune" ? { structure: false, section_id: null } : { structure: false, section_id: cible };
  if (valeurs.section_id !== null && !z.guid().safeParse(valeurs.section_id).success) return { error: "Section inconnue" };
  const { error } = await supabase.from("ateliers_vers_sections").update(valeurs).eq("atelier", atelier);
  if (error) return { error: error.message };
  fin();
  return {};
}

/**
 * Rattache aux sections les employés qui n'en ont pas encore, d'après leur
 * département de paie (prioritaire) ou, à défaut, leur atelier de la Fiche de
 * tâches ; les départements / ateliers « structure » passent leurs employés en
 * type structure. Ne touche jamais une section déjà posée.
 */
export async function rattacherEmployesAuxSections(): Promise<Result & { rattaches?: number }> {
  await requirePermission("personnel", "modify");
  const supabase = await createClient();
  const [{ data: ateliers }, { data: departements }, { data: employes }, { data: liens }] = await Promise.all([
    supabase.from("ateliers_vers_sections").select("atelier, section_id, structure"),
    supabase.from("departements").select("code, section_id, structure"),
    supabase.from("employes").select("id, atelier_source, departement_code, type_emploi").limit(10000),
    supabase.from("employes_sections").select("employe_id").limit(20000),
  ]);
  const avecSection = new Set((liens ?? []).map((l) => l.employe_id as string));
  const parAtelier = new Map((ateliers ?? []).map((a) => [a.atelier as string, a]));
  const parDepartement = new Map((departements ?? []).map((d) => [d.code as string, d]));
  const nouveaux: { employe_id: string; section_id: string; pourcentage: number }[] = [];
  const structure: string[] = [];
  for (const e of employes ?? []) {
    const cible =
      (e.departement_code && (parDepartement.get(e.departement_code as string)?.structure || parDepartement.get(e.departement_code as string)?.section_id)
        ? parDepartement.get(e.departement_code as string)
        : undefined) ?? parAtelier.get((e.atelier_source as string) ?? "");
    if (!cible) continue;
    if (cible.structure && e.type_emploi !== "structure") structure.push(e.id as string);
    else if (cible.section_id && !avecSection.has(e.id as string)) nouveaux.push({ employe_id: e.id as string, section_id: cible.section_id as string, pourcentage: 100 });
  }
  if (nouveaux.length > 0) {
    const { error } = await supabase.from("employes_sections").insert(nouveaux);
    if (error) return { error: error.message };
  }
  if (structure.length > 0) {
    const { error } = await supabase.from("employes").update({ type_emploi: "structure" }).in("id", structure);
    if (error) return { error: error.message };
  }
  fin();
  return { rattaches: nouveaux.length + structure.length };
}

/** `cible` : « structure », « aucune » (à classer) ou l'identifiant d'une section. */
export async function classerDepartement(code: string, cible: string): Promise<Result> {
  await requirePermission("personnel", "modify");
  const supabase = await createClient();
  const valeurs =
    cible === "structure" ? { structure: true, section_id: null } : cible === "aucune" ? { structure: false, section_id: null } : { structure: false, section_id: cible };
  if (valeurs.section_id !== null && !z.guid().safeParse(valeurs.section_id).success) return { error: "Section inconnue" };
  const { error } = await supabase.from("departements").update(valeurs).eq("code", code);
  if (error) return { error: error.message };
  fin();
  return {};
}

const departementSchema = z.object({
  code: z.string().trim().min(1, "Code obligatoire").max(10),
  libelle: z.string().trim().min(1, "Libellé obligatoire").max(80),
});

export async function ajouterDepartement(input: z.input<typeof departementSchema>): Promise<Result> {
  await requirePermission("personnel", "create");
  const parsed = departementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  const supabase = await createClient();
  const { error } = await supabase.from("departements").insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "Ce code de département existe déjà." : error.message };
  fin();
  return {};
}

export async function traiterAlerte(id: string, commentaire: string): Promise<Result> {
  const { profile } = await requirePermission("personnel", "validate");
  const supabase = await createClient();
  const { error } = await supabase
    .from("alertes")
    .update({ statut: "traitee", traitee_par: profile.id, traitee_le: new Date().toISOString(), commentaire_traitement: commentaire.trim().slice(0, 500) || null })
    .eq("id", id)
    .eq("statut", "ouverte");
  if (error) return { error: error.message };
  fin();
  return {};
}
