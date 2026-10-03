import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { TextileActiveToggle } from "../textile-active-toggle";
import { TextileArticles } from "../textile-articles";
import { TextileForm } from "../textile-form";

/**
 * Fiche d'une matière première (textile) : caractéristiques, coloris Sage
 * rattachés, modèles qui la portent. Un tissu est référencé par coloris dans
 * Sage — huit couleurs, huit codes articles — et un seul textile ici.
 */
export default async function TextilePage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: textile }, { data: liens }, { data: articles }, { data: colors }, { data: models }] = await Promise.all([
    supabase.from("textiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("textile_sage_articles").select("textile_id,sage_reference,color_id,colors(name)"),
    supabase.from("stock_item_view").select("sage_reference,designation").eq("category", "tissu").order("designation"),
    supabase.from("colors").select("id,name").eq("active", true).order("name"),
    supabase.from("product_models").select("id,name").eq("textile_id", id).order("name"),
  ]);
  if (!textile) notFound();

  const rattachees = new Set((liens ?? []).map((l) => l.sage_reference as string));
  const designationDe = new Map((articles ?? []).map((a) => [a.sage_reference, a.designation]));
  const attached = (liens ?? [])
    .filter((l) => l.textile_id === id)
    .map((l) => ({
      sage_reference: l.sage_reference as string,
      designation: designationDe.get(l.sage_reference as string) ?? "Article absent du miroir Sage",
      colorName: (l.colors as unknown as { name: string } | null)?.name ?? null,
    }));
  // Dédoublonnage : le miroir a une ligne par dépôt (migration 0058).
  const orphelins = [...new Map((articles ?? []).filter((a) => !rattachees.has(a.sage_reference)).map((a) => [a.sage_reference, a])).values()];

  return (
    <div className="space-y-6">
      <Link
        href="/articles?onglet=matieres"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Matières premières
      </Link>
      <PageHeader
        title={textile.nom}
        description="Matière première (MP)"
        action={canModify ? <TextileActiveToggle textileId={textile.id} active={textile.active} /> : undefined}
      />
      <Card>
        <CardHeader title="Caractéristiques" />
        <CardBody>
          <TextileForm textile={textile} editable={canModify} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Coloris Sage" description="Les articles Sage (un par coloris) qui sont ce textile." />
        <CardBody>
          {canModify ? (
            <TextileArticles textileId={textile.id} attached={attached} candidates={orphelins} colors={colors ?? []} />
          ) : (
            <ul className="space-y-1 text-sm">
              {attached.map((a) => (
                <li key={a.sage_reference}>
                  <span className="font-mono text-xs">{a.sage_reference}</span> — {a.designation}
                  {a.colorName ? ` (${a.colorName})` : ""}
                </li>
              ))}
              {attached.length === 0 && <li className="text-foreground-muted">Aucun article Sage rattaché.</li>}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Modèles" />
        <CardBody>
          {(models ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun modèle ne porte ce textile.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {(models ?? []).map((m) => (
                <li key={m.id}>
                  <Link href={`/articles/${m.id}/general`} className="rounded-md border border-border px-2 py-1 hover:bg-surface-muted">
                    {m.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
