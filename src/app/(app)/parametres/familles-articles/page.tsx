import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FamiliesManager } from "./families-manager";

/**
 * Familles d'articles (migration 0093) : deux niveaux libres, communs à toutes
 * les natures (produits finis, matières premières, consommables). La
 * codification pourra s'y appuyer plus tard.
 */
export default async function ArticleFamiliesPage() {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const [{ data: families }, { data: models }] = await Promise.all([
    supabase.from("article_families").select("id,nom,parent_id,actif").order("ordre").order("nom"),
    supabase.from("product_models").select("famille_id,sous_famille_id"),
  ]);
  const rows = (families ?? []).map((f) => ({
    id: f.id as string,
    nom: f.nom as string,
    parentId: (f.parent_id as string | null) ?? null,
    actif: !!f.actif,
    articles: (models ?? []).filter((m) => m.famille_id === f.id || m.sous_famille_id === f.id).length,
  }));
  return (
    <div className="space-y-6">
      <PageHeader title="Familles d'articles" description="Famille puis sous-famille, pour classer tous les articles (produits finis, matières premières, consommables)." />
      <Card>
        <CardBody>
          <FamiliesManager rows={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
