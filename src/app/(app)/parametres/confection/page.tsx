import { requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AgentsPanel,
  ChaineForm,
  PostesCommunsPanel,
  PostesPanel,
  TypeMachineForm,
  type AgentRow,
  type ChaineRow,
  type CompteRow,
  type PosteRow,
  type SectionRow,
  type TypeMachineRow,
} from "./forms";

/**
 * Paramètres > Atelier > Confection : l'atelier décrit ici ses chaînes de
 * couture au fil de l'eau (Bonneterie 1, Polo…), leurs postes, les postes
 * communs à plusieurs chaînes, et le compte de l'agent de chaque chaîne.
 */
export default async function ConfectionSettingsPage() {
  await requireModule("parametres_confection");
  const supabase = await createClient();
  const [{ data: sectionsRaw }, { data: chaines }, { data: postes }, { data: types }, { data: agentsRaw }, { data: comptesRaw }, { data: roles }] = await Promise.all([
    supabase.from("sections").select("id,name,active,display_order,atelier_categories(cle)").eq("active", true).order("display_order"),
    supabase.from("chaines_couture").select("id,section_id,nom,code,type,minutes_jour,active").order("ordre").order("nom"),
    supabase.from("postes_couture").select("id,chaine_id,section_id,numero,libelle,type_machine_id,actif").order("numero"),
    supabase.from("types_machines_couture").select("id,nom,active").order("nom"),
    supabase.from("chaine_agents").select("id,chaine_id,user_id,app_users(full_name)"),
    // Rôles lus à part : app_users et roles sont liés dans les deux sens (role_id, created_by), l'embarquement serait ambigu.
    supabase.from("app_users").select("id,full_name,section_id,role,role_id").eq("active", true).eq("role", "chef_section").order("full_name"),
    supabase.from("roles").select("id,label"),
  ]);

  const sections: SectionRow[] = ((sectionsRaw ?? []) as unknown as { id: string; name: string; atelier_categories: { cle: string } | null }[])
    .filter((s) => s.atelier_categories?.cle === "couture")
    .map((s) => ({ id: s.id, name: s.name }));
  const agents: AgentRow[] = ((agentsRaw ?? []) as unknown as { id: string; chaine_id: string; user_id: string; app_users: { full_name: string } | null }[]).map((a) => ({
    id: a.id,
    chaine_id: a.chaine_id,
    user_id: a.user_id,
    nom: a.app_users?.full_name ?? "Compte supprimé",
  }));
  // Un agent est rattaché à une section (rôle de base chef de section) : on ne propose que ces comptes.
  const roleLabel = new Map(((roles ?? []) as { id: string; label: string }[]).map((r) => [r.id, r.label]));
  const comptes = (comptesRaw ?? []) as { id: string; full_name: string; section_id: string | null; role_id: string | null }[];
  const allChaines = (chaines ?? []) as ChaineRow[];
  const allPostes = (postes ?? []) as PosteRow[];
  const allTypes = (types ?? []) as TypeMachineRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Confection"
        description="Chaînes de couture, postes et agents. Les travaux, l'équipe du jour et le rendement se suivent dans Production > Confection."
      />

      {sections.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-foreground-muted">Aucune section de catégorie « Couture » n&apos;est active. Créez-la d&apos;abord dans Sections d&apos;atelier.</p>
          </CardBody>
        </Card>
      )}

      {sections.map((section) => {
        const duSection = allChaines.filter((c) => c.section_id === section.id);
        const comptesSection: CompteRow[] = comptes
          .filter((c) => c.section_id === section.id)
          .map((c) => ({ id: c.id, nom: c.full_name, role: (c.role_id && roleLabel.get(c.role_id)) || "" }));
        return (
          <Card key={section.id}>
            <CardHeader title={section.name} description={`${duSection.length} chaîne(s). Le code de la chaîne s'imprime sur les étiquettes des paquets livrés.`} />
            <div className="divide-y divide-border">
              {duSection.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center gap-2 px-5 pt-3">
                    <span className="font-mono text-sm font-semibold">{c.code}</span>
                    {c.type === "support" && <Badge tone="info">Support</Badge>}
                    {!c.active && <Badge tone="warning">Désactivée</Badge>}
                  </div>
                  <ChaineForm c={c} sections={sections} />
                  <details className="px-5 pb-3">
                    <summary className="cursor-pointer text-sm font-medium text-brand">
                      Postes ({allPostes.filter((p) => p.chaine_id === c.id).length}) et agent(s) ({agents.filter((a) => a.chaine_id === c.id).length})
                    </summary>
                    <div className="mt-3 grid gap-6 lg:grid-cols-2">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Postes</p>
                        <PostesPanel chaine={c} postes={allPostes.filter((p) => p.chaine_id === c.id)} types={allTypes} />
                      </div>
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Agent de la chaîne</p>
                        <p className="mb-2 text-xs text-foreground-muted">
                          Compte au rôle « Agent de chaîne », rattaché à la section {section.name} (Paramètres &gt; Utilisateurs).
                        </p>
                        <AgentsPanel chaine={c} agents={agents.filter((a) => a.chaine_id === c.id)} comptes={comptesSection} />
                      </div>
                    </div>
                  </details>
                </div>
              ))}
              <div className="bg-surface-muted/40">
                <ChaineForm sections={sections} sectionId={section.id} />
              </div>
            </div>
            <div className="border-t border-border">
              <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Postes communs à plusieurs chaînes</p>
              <PostesCommunsPanel section={section} postes={allPostes.filter((p) => p.chaine_id === null && p.section_id === section.id)} types={allTypes} />
            </div>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="Types de machines" description="Liste tenue par l'atelier (piqueuse, surjeteuse, recouvreuse…). Sert à décrire les postes." />
        <div className="divide-y divide-border">
          {allTypes.map((t) => (
            <TypeMachineForm key={t.id} t={t} />
          ))}
          <div className="bg-surface-muted/40">
            <TypeMachineForm />
          </div>
        </div>
      </Card>
    </div>
  );
}
