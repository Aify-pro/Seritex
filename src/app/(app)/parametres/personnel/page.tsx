import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import type { LigneImport, StatutEmploye, TypeContrat, TypeEmploi, TypeImport } from "@/lib/personnel/import";
import type { CategorieRubrique } from "@/lib/personnel/livre-paie";
import { PersonnelManager, type EmployeVue } from "./personnel-manager";
import { ImportPanel, type ComparatifVue, type ImportVue } from "./import-panel";
import { AlertesPanel, AteliersPanel, RubriquesPanel, type AlerteVue, type AtelierVue, type RubriqueVue } from "./reglages-panels";

/**
 * Paramètres > Personnel (migrations 0157 et 0159) : fiches du personnel,
 * import de la liste (Excel), du livre de paie (Sage) et de la présence, avec
 * aperçu avant application et comparaison au livre précédent ; correspondance
 * des rubriques de paie et des ateliers ; alertes. Données de salaires :
 * réservées au droit « Personnel » (matrice Rôles & permissions), aussi côté base.
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
  const [{ data: employesBruts }, { data: liens }, { data: sections }, { data: importsBruts }, { data: rubriquesBrutes }, { data: ateliersBruts }, { data: alertesBrutes }] = await Promise.all([
    supabase.from("employes").select("*").order("nom").limit(5000),
    supabase.from("employes_sections").select("employe_id, section_id, pourcentage").limit(10000),
    supabase.from("sections").select("id, name").eq("active", true).order("display_order").order("name"),
    supabase
      .from("imports_personnel")
      .select("id, type, nom_fichier, mois, statut, apercu, nb_lignes, nb_erreurs, nb_creations, nb_modifications, cree_le, applique_le, motif_validation, rubriques_a_classer, comparatif")
      .order("cree_le", { ascending: false })
      .limit(10),
    supabase.from("paie_rubriques").select("code, libelle, categorie").order("code"),
    supabase.from("ateliers_vers_sections").select("atelier, libelle, section_id, structure").order("atelier"),
    supabase
      .from("alertes")
      .select("id, gravite, titre, detail, cree_le, statut, commentaire_traitement")
      .eq("module_cible", "personnel")
      .order("cree_le", { ascending: false })
      .limit(30),
  ]);

  // Coût du dernier mois de paie appliqué, par employé (livre de paie importé).
  const { data: dernierMois } = await supabase.from("paies_mensuelles").select("mois").order("mois", { ascending: false }).limit(1);
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
  const nombre = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const employes: EmployeVue[] = (employesBruts ?? []).map((e) => ({
    id: e.id as string,
    matricule: e.matricule as string,
    nom: e.nom as string,
    prenom: (e.prenom as string | null) ?? null,
    fonction: (e.fonction as string | null) ?? null,
    typeContrat: (e.type_contrat as TypeContrat | null) ?? null,
    atelierSource: (e.atelier_source as string | null) ?? null,
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
    motifValidation: (i.motif_validation as string | null) ?? null,
    rubriquesAClasser: (i.rubriques_a_classer as string[] | null) ?? [],
    comparatif: (i.comparatif as ComparatifVue | null) ?? null,
    lignes: i.statut === "apercu" ? (i.apercu as LigneImport[]) : null,
  }));

  const rubriques: RubriqueVue[] = (rubriquesBrutes ?? []).map((r) => ({
    code: r.code as string,
    libelle: (r.libelle as string | null) ?? null,
    categorie: (r.categorie as CategorieRubrique | null) ?? null,
  }));

  const parAtelier = new Map<string, number>();
  for (const e of employes) if (e.atelierSource) parAtelier.set(e.atelierSource, (parAtelier.get(e.atelierSource) ?? 0) + 1);
  const ateliers: AtelierVue[] = (ateliersBruts ?? []).map((a) => ({
    atelier: a.atelier as string,
    libelle: (a.libelle as string | null) ?? null,
    sectionId: (a.section_id as string | null) ?? null,
    structure: a.structure as boolean,
    nbEmployes: parAtelier.get(a.atelier as string) ?? 0,
  }));

  const alertes: AlerteVue[] = (alertesBrutes ?? []).map((a) => ({
    id: a.id as string,
    gravite: a.gravite as AlerteVue["gravite"],
    titre: a.titre as string,
    detail: (a.detail as string | null) ?? null,
    creeLe: a.cree_le as string,
    statut: a.statut as AlerteVue["statut"],
    commentaire: (a.commentaire_traitement as string | null) ?? null,
  }));
  const sectionsOptions = (sections ?? []).map((s) => ({ id: s.id as string, nom: s.name as string }));
  const nbAlertesOuvertes = alertes.filter((a) => a.statut === "ouverte").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personnel"
        description="Les fiches du personnel et le livre de paie importé chaque fin de mois : base du coût de chaque atelier dans le prix de revient. Les salaires ne sont visibles que des rôles qui ont le droit « Personnel »."
      />

      {nbAlertesOuvertes > 0 && (
        <Card>
          <CardHeader title={`Alertes (${nbAlertesOuvertes} ouverte${nbAlertesOuvertes > 1 ? "s" : ""})`} description="Livre de paie identique au précédent, écart anormal… Vues de la RH et de la direction." />
          <CardBody>
            <AlertesPanel alertes={alertes} peutTraiter={peutValider} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Import mensuel" description="Le livre de paie exporté de Sage, la liste du personnel (Excel) ou la présence. Un aperçu s'affiche, puis la RH valide." />
        <CardBody>
          <ImportPanel imports={imports} peutDeposer={peutCreer} peutValider={peutValider} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fiches" description="Créées par l'import de la liste du personnel. Un employé confidentiel n'a aucun montant." />
        <CardBody>
          <PersonnelManager employes={employes} sections={sectionsOptions} moisPaie={moisPaie} peutCreer={peutCreer} peutModifier={peutModifier} peutSupprimer={peutSupprimer} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Ateliers et sections" description="L'atelier de chaque employé vient de l'application Fiche de tâches. Bureau, direction et commercial sont de la structure." />
        <CardBody>
          <AteliersPanel ateliers={ateliers} sections={sectionsOptions} peutModifier={peutModifier} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rubriques de paie" description="Comment chaque rubrique du livre de paie Sage compte dans le coût. Une rubrique nouvelle arrive « à classer » : elle n'est jamais ignorée en silence." />
        <CardBody>
          <RubriquesPanel rubriques={rubriques} peutModifier={peutModifier} />
        </CardBody>
      </Card>

      {nbAlertesOuvertes === 0 && alertes.length > 0 && (
        <Card>
          <CardHeader title="Alertes traitées" />
          <CardBody>
            <AlertesPanel alertes={alertes} peutTraiter={false} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
