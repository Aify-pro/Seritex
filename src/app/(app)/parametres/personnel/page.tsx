import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { LigneImport, StatutEmploye, TypeEmploi, TypeImport } from "@/lib/personnel/import";
import { PersonnelManager, type EmployeVue } from "./personnel-manager";
import { ImportPanel, type ImportVue } from "./import-panel";

/**
 * Paramètres > Personnel (migration 0157) : fiches du personnel, section(s)
 * d'affectation, import mensuel (fiches, paie du mois, présence) avec aperçu
 * avant application. Données de salaires : réservées au droit « Personnel »
 * (matrice Rôles & permissions), aussi côté base.
 */
export default async function PersonnelPage() {
  await requireModule("personnel");
  const [peutCreer, peutModifier, peutSupprimer, peutValider] = await Promise.all([
    can("personnel", "create"),
    can("personnel", "modify"),
    can("personnel", "delete"),
    can("personnel", "validate"),
  ]);
  const supabase = await createClient();
  const [{ data: employesBruts }, { data: liens }, { data: sections }, { data: importsBruts }] = await Promise.all([
    supabase.from("employes").select("*").order("nom"),
    supabase.from("employes_sections").select("employe_id, section_id, pourcentage"),
    supabase.from("sections").select("id, name").eq("active", true).order("display_order").order("name"),
    supabase
      .from("imports_personnel")
      .select("id, type, nom_fichier, mois, statut, apercu, nb_lignes, nb_erreurs, nb_creations, nb_modifications, cree_le, applique_le")
      .order("cree_le", { ascending: false })
      .limit(12),
  ]);

  const sectionsParEmploye = new Map<string, { sectionId: string; pourcentage: number }[]>();
  for (const l of liens ?? []) {
    const liste = sectionsParEmploye.get(l.employe_id as string) ?? [];
    liste.push({ sectionId: l.section_id as string, pourcentage: Number(l.pourcentage) });
    sectionsParEmploye.set(l.employe_id as string, liste);
  }
  const nombre = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const employes: EmployeVue[] = (employesBruts ?? []).map((e) => ({
    id: e.id as string,
    matricule: e.matricule as string,
    nom: e.nom as string,
    fonction: (e.fonction as string | null) ?? null,
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
  }));

  const imports: ImportVue[] = (importsBruts ?? []).map((i) => ({
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
    lignes: i.statut === "apercu" ? (i.apercu as LigneImport[]) : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personnel"
        description="Les fiches du personnel et leur section : base du coût de chaque atelier dans le prix de revient. Les salaires ne sont visibles que des rôles qui ont le droit « Personnel »."
      />

      <Card>
        <CardHeader title="Fiches" description="Saisies une fois, puis tenues à jour par l'import mensuel. Un employé confidentiel n'a aucun montant." />
        <CardBody>
          <PersonnelManager
            employes={employes}
            sections={(sections ?? []).map((s) => ({ id: s.id as string, nom: s.name as string }))}
            peutCreer={peutCreer}
            peutModifier={peutModifier}
            peutSupprimer={peutSupprimer}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Import mensuel"
          description="Fichiers produits par le programme de pointage : fiches, paie du mois, présence jour par jour. Un aperçu s'affiche, puis la RH valide."
        />
        <CardBody>
          <ImportPanel imports={imports} peutDeposer={peutCreer} peutValider={peutValider} />
        </CardBody>
      </Card>
    </div>
  );
}
