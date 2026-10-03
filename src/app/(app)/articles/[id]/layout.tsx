import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { ARTICLE_DETAIL_TABS } from "@/lib/articles/tabs";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { TabNav } from "@/components/shell/tab-nav";

/**
 * Fiche article à onglets (ART-A) : l'en-tête et la barre d'onglets sont
 * communs, chaque onglet charge ses propres données.
 */
export default async function ArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { canSeeCosts } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const { data: model } = await supabase
    .from("product_models")
    .select("id,name,category,active")
    .eq("id", id)
    .maybeSingle();
  if (!model) notFound();

  const tabs = ARTICLE_DETAIL_TABS.filter((t) => !t.costsOnly || canSeeCosts).map((t) => ({
    href: `/articles/${id}/${t.slug}`,
    label: t.label,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/articles"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Articles
      </Link>
      <PageHeader
        title={model.name}
        description={model.category ?? "Produit fini"}
        action={!model.active ? <Badge tone="neutral">Inactif</Badge> : undefined}
      />
      <TabNav items={tabs} label="Onglets de la fiche article" />
      {children}
    </div>
  );
}
