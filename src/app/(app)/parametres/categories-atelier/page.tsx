import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { NewCategorieForm } from "./new-categorie-form";
import { CategorieActiveToggle } from "./categorie-active-toggle";

export default async function CategoriesAtelierPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const { data: categories } = await supabase.from("atelier_categories").select("*").order("display_order");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catégories d'atelier"
        description="Coupe, Impression, Montage... Rattachez-y vos sections (Paramètres > Sections d'atelier) pour leur donner le comportement associé : une section liée à une catégorie qui exige une fiche de tracé ou un visuel bloquera la validation de l'ODF tant que le document n'est pas fourni."
      />

      <NewCategorieForm />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {categories?.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {c.nom} <span className="font-normal text-foreground-muted">({c.cle})</span>
                  </p>
                  <p className="text-xs text-foreground-muted">
                    {[c.requiert_fiche_trace && "Fiche de tracé obligatoire", c.requiert_visuel && "Visuel obligatoire"]
                      .filter(Boolean)
                      .join(" · ") || "Aucune condition de validation"}
                  </p>
                </div>
                <CategorieActiveToggle categorieId={c.id} active={c.active} />
              </li>
            ))}
            {(!categories || categories.length === 0) && (
              <li className="px-5 py-3 text-sm text-foreground-muted">Aucune catégorie pour le moment.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
