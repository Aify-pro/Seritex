import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { PageHeader } from "@/components/shell/page-header";
import { NewArticleForm } from "./new-article-form";

/**
 * Création d'un article (fiche unique, migration 0093) : la même fiche que
 * pour la modification, quelle que soit la nature. Une fois créé, l'article
 * s'ouvre sur sa fiche complète (déclinaisons, fabrication, médias…).
 */
export default async function NewArticlePage() {
  const { canModify } = await requireArticles();
  if (!canModify) redirect("/articles");
  const supabase = await createClient();
  const [{ data: familles }, { data: categories }, { data: matieres }, { data: consumableFamilies }] = await Promise.all([
    supabase.from("article_families").select("id,nom,parent_id").eq("actif", true).order("ordre").order("nom"),
    supabase.from("product_categories").select("id,nom").order("nom"),
    supabase.from("matieres").select("id,nom").eq("actif", true).order("nom"),
    supabase.from("consumable_families").select("id,nom,code_court").order("nom"),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/articles" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Articles
      </Link>
      <PageHeader title="Nouvel article" description="Produit fini, matière première ou consommable : tous les articles ont la même fiche et peuvent être vendus." />
      <NewArticleForm
        familles={(familles ?? []).map((f) => ({ id: f.id as string, nom: f.nom as string, parentId: (f.parent_id as string | null) ?? null }))}
        categories={(categories ?? []).map((c) => ({ id: c.id as string, nom: c.nom as string }))}
        matieres={(matieres ?? []).map((m) => ({ id: m.id as string, nom: m.nom as string }))}
        consumableFamilies={(consumableFamilies ?? []).map((f) => ({ id: f.id as string, nom: `${f.nom} (CO${f.code_court})` }))}
      />
    </div>
  );
}
