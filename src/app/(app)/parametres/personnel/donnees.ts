import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import type { LigneImport, StatutEmploye, TypeContrat, TypeEmploi, TypeImport } from "@/lib/personnel/import";
import type { CategorieRubrique } from "@/lib/personnel/livre-paie";
import type { EmployeVue } from "./personnel-manager";
import type { ComparatifVue, ImportVue } from "./import-panel";
import type { AlerteVue, AtelierVue, DepartementVue, RubriqueVue } from "./reglages-panels";

/**
 * Chargement des données de l'écran Personnel, partagé par ses onglets
 * (chaque onglet est une page : import, fiches, départements, ateliers,
 * rubriques, alertes). La lecture passe toujours par la RLS de l'utilisateur.
 */

export async function chargerDroits() {
  const [peutCreer, peutModifier, peutSupprimer, peutValider] = await Promise.all([
    can("personnel", "create"),
    can("personnel", "modify"),
    can("personnel", "delete"),
    can("personnel", "validate"),
  ]);
  return { peutCreer, peutModifier, peutSupprimer, peutValider };
}

export async function chargerSections() {
  const supabase = await createClient();
  const { data } = await supabase.from("sections").select("id, name").eq("active", true).order("display_order").order("name");
  return (data ?? []).map((s) => ({ id: s.id as string, nom: s.name as string }));
}

const nombre = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function chargerEmployes(): Promise<{ employes: EmployeVue[]; moisPaie: string | null }> {
  const supabase = await createClient();
  const [{ data: employesBruts }, { data: liens }, { data: dernierMois }] = await Promise.all([
    supabase.from("employes").select("*").order("nom").limit(5000),
    supabase.from("employes_sections").select("employe_id, section_id, pourcentage").limit(10000),
    supabase.from("paies_mensuelles").select("mois").order("mois", { ascending: false }).limit(1),
  ]);
  const moisPaie = (dernierMois?.[0]?.mois as string | undefined) ?? null;
  const coutParEmploye = new Map<string, number>();
  if (moisPaie) {
    const { data: paies } = await supabase.from("paies_mensuelles").select("employe_id, cout_mois").eq("mois", moisPaie).limit(5000);
    for (const p of paies ?? []) coutParEmploye.set(p.employe_id as string, Number(p.cout_mois));
  }
  const sectionsParEmploye = new Map<string, { sectionId: string; pourcentage: number }[]>();
  for (const l of liens ?? []) {
    const liste = sectionsParEmploye.get(l.employe_id as string) ?? [];
    liste.push({ sectionId: l.section_id as string, pourcentage: Number(l.pourcentage) });
    sectionsParEmploye.set(l.employe_id as string, liste);
  }
  const employes: EmployeVue[] = (employesBruts ?? []).map((e) => ({
    id: e.id as string,
    matricule: e.matricule as string,
    nom: e.nom as string,
    prenom: (e.prenom as string | null) ?? null,
    fonction: (e.fonction as string | null) ?? null,
    typeContrat: (e.type_contrat as TypeContrat | null) ?? null,
    atelierSource: (e.atelier_source as string | null) ?? null,
    departementCode: (e.departement_code as string | null) ?? null,
    typeEmploi: e.type_emploi as TypeEmploi,
    statut: e.statut as StatutEmploye,
    confidentiel: e.confidentiel as boolean,
    salaireBase: nombre(e.salaire_base),
    primesFixes: nombre(e.primes_fixes),
    avantages: nombre(e.avantages),
    chargesPatronales: nombre(e.charges_patronales),
    dateEntree: (e.date_entree as string | null) ?? null,
    dateSortie: (e.date_sortie as string | null) ?? null,
    notes: (e.notes as string | null) ?? null,
    sections: sectionsParEmploye.get(e.id as string) ?? [],
    coutMois: coutParEmploye.get(e.id as string) ?? null,
  }));
  return { employes, moisPaie };
}

export async function chargerImports(): Promise<ImportVue[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("imports_personnel")
    .select("id, type, nom_fichier, mois, statut, apercu, nb_lignes, nb_erreurs, nb_creations, nb_modifications, cree_le, applique_le, motif_validation, rubriques_a_classer, comparatif")
    .order("cree_le", { ascending: false })
    .limit(10);
  return (data ?? []).map((i) => ({
    id: i.id as string,
    type: i.type as TypeImport,
    nomFichier: (i.nom_fichier as string | null) ?? null,
    mois: (i.mois as string | null) ?? null,
    statut: i.statut as ImportVue["statut"],
    nbLignes: i.nb_lignes as number,
    nbErreurs: i.nb_erreurs as number,
    nbCreations: i.nb_creations as number,
    nbModifications: i.nb_modifications as number,
    creeLe: i.cree_le as string,
    appliqueLe: (i.applique_le as string | null) ?? null,
    motifValidation: (i.motif_validation as string | null) ?? null,
    rubriquesAClasser: (i.rubriques_a_classer as string[] | null) ?? [],
    comparatif: (i.comparatif as ComparatifVue | null) ?? null,
    lignes: i.statut === "apercu" ? (i.apercu as LigneImport[]) : null,
  }));
}

export async function chargerRubriques(): Promise<RubriqueVue[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("paie_rubriques").select("code, libelle, categorie").order("code");
  return (data ?? []).map((r) => ({
    code: r.code as string,
    libelle: (r.libelle as string | null) ?? null,
    categorie: (r.categorie as CategorieRubrique | null) ?? null,
  }));
}

/** Nombre d'employés par valeur d'une colonne (atelier d'origine, code département). */
async function compterEmployes(colonne: "atelier_source" | "departement_code"): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from(`employes`).select(colonne).not(colonne, "is", null).limit(10000);
  const n = new Map<string, number>();
  for (const e of (data ?? []) as unknown as Record<string, string>[]) n.set(e[colonne], (n.get(e[colonne]) ?? 0) + 1);
  return n;
}

export async function chargerAteliers(): Promise<AtelierVue[]> {
  const supabase = await createClient();
  const [{ data }, parAtelier] = await Promise.all([
    supabase.from("ateliers_vers_sections").select("atelier, libelle, section_id, structure").order("atelier"),
    compterEmployes("atelier_source"),
  ]);
  return (data ?? []).map((a) => ({
    atelier: a.atelier as string,
    libelle: (a.libelle as string | null) ?? null,
    sectionId: (a.section_id as string | null) ?? null,
    structure: a.structure as boolean,
    nbEmployes: parAtelier.get(a.atelier as string) ?? 0,
  }));
}

export async function chargerDepartements(): Promise<DepartementVue[]> {
  const supabase = await createClient();
  const [{ data }, parDepartement] = await Promise.all([
    supabase.from("departements").select("code, libelle, section_id, structure").order("code"),
    compterEmployes("departement_code"),
  ]);
  return (data ?? []).map((d) => ({
    code: d.code as string,
    libelle: d.libelle as string,
    sectionId: (d.section_id as string | null) ?? null,
    structure: d.structure as boolean,
    nbEmployes: parDepartement.get(d.code as string) ?? 0,
  }));
}

export async function chargerAlertes(): Promise<AlerteVue[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("alertes")
    .select("id, gravite, titre, detail, cree_le, statut, commentaire_traitement")
    .eq("module_cible", "personnel")
    .order("cree_le", { ascending: false })
    .limit(50);
  return (data ?? []).map((a) => ({
    id: a.id as string,
    gravite: a.gravite as AlerteVue["gravite"],
    titre: a.titre as string,
    detail: (a.detail as string | null) ?? null,
    creeLe: a.cree_le as string,
    statut: a.statut as AlerteVue["statut"],
    commentaire: (a.commentaire_traitement as string | null) ?? null,
  }));
}

export async function compterAlertesOuvertes(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("alertes").select("id", { count: "exact", head: true }).eq("module_cible", "personnel").eq("statut", "ouverte");
  return count ?? 0;
}
