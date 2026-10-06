import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { ARTICLE_DETAIL_TABS } from "@/lib/articles/tabs";
import { NATURE_LABELS, TYPE_APPRO_LABELS, type ArticleNature, type TypeAppro } from "@/lib/articles/natures";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { TabNav } from "@/components/shell/tab-nav";

/**
 * Fiche article à onglets (ART-A), commune à toutes les natures (migration
 * 0093) : l'en-tête et la barre d'onglets sont communs, chaque onglet charge
 * ses propres données ; les onglets de fabrication n'apparaissent que pour
 * un produit fini.
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
    .select("id,name,category,active,nature,type_appro,fusionne_dans,famille:article_families!product_models_famille_id_fkey(nom),sous_famille:article_families!product_models_sous_famille_id_fkey(nom)")
    .eq("id", id)
    .maybeSingle();
  if (!model) notFound();

  const nature = model.nature as ArticleNature;
  const tabs = ARTICLE_DETAIL_TABS.filter((t) => (!t.costsOnly || canSeeCosts) && (!t.natures || t.natures.includes(nature))).map((t) => ({
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
        description={[
          NATURE_LABELS[nature],
          TYPE_APPRO_LABELS[model.type_appro as TypeAppro],
          [(model.famille as unknown as { nom: string } | null)?.nom, (model.sous_famille as unknown as { nom: string } | null)?.nom].filter(Boolean).join(" › "),
          model.category,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={!model.active ? <Badge tone="neutral">Inactif</Badge> : undefined}
      />
      {model.fusionne_dans && (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          Ce tissu a été regroupé dans un autre article :{" "}
          <Link href={`/articles/${model.fusionne_dans}/declinaisons`} className="font-medium underline">
            ouvrir l&apos;article regroupé
          </Link>
          .
        </p>
      )}
      <TabNav items={tabs} label="Onglets de la fiche article" />
      {children}
    </div>
  );
}
