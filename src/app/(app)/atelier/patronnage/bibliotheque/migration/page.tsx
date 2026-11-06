import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { MigrationAnciensPatrons, type AncienPatron } from "@/components/atelier/patronnage/migration-anciens-patrons";

/**
 * Reprise des anciens patrons de produit fini (migration 0155) : un patron
 * qui contient toutes les pièces d'un vêtement est réparti pièce par pièce
 * entre les semi-finis. C'est une décision humaine : rien n'est deviné.
 */
export default async function MigrationPatronsPage() {
  await requireUser();
  if (!(await can("patronnage", "modify"))) redirect("/dashboard?erreur=acces_refuse");
  const supabase = await createClient();

  const [{ data: articles }, { data: semiFinis }, { data: avecPatron }] = await Promise.all([
    supabase
      .from("pattern_articles")
      .select("id,article_code,designation,product_model_id,product_models(name,nature),patterns(size,pattern_pieces(name))")
      .is("migre_le", null)
      .order("article_code"),
    supabase.from("product_models").select("id,code,name").eq("nature", "semi_fini").eq("active", true).order("name"),
    supabase.from("pattern_articles").select("product_model_id"),
  ]);

  const dejaPourvus = new Set((avecPatron ?? []).map((a) => a.product_model_id as string));
  const anciens: AncienPatron[] = (articles ?? [])
    .filter((a) => {
      const pm = Array.isArray(a.product_models) ? a.product_models[0] : a.product_models;
      return pm && pm.nature !== "semi_fini";
    })
    .map((a) => {
      const pm = Array.isArray(a.product_models) ? a.product_models[0] : a.product_models;
      const patterns = (a.patterns ?? []) as { size: string; pattern_pieces: { name: string }[] | null }[];
      return {
        id: a.id as string,
        code: a.article_code as string,
        designation: a.designation as string,
        article: (pm?.name as string | undefined) ?? "—",
        tailles: patterns.map((p) => p.size),
        pieces: [...new Set(patterns.flatMap((p) => (p.pattern_pieces ?? []).map((x) => x.name)))].sort(),
      };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reprendre un ancien patron"
        description="Un ancien patron de produit fini contient toutes les pièces du vêtement. Choisissez, pour chaque pièce, le semi-fini qui la porte : un patron est créé pour chaque semi-fini, avec toutes les tailles. L'ancien patron est conservé pour l'historique mais ne sert plus à la reconnaissance."
        action={
          <Link href="/atelier/patronnage/bibliotheque" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Bibliothèque
          </Link>
        }
      />
      <MigrationAnciensPatrons
        anciens={anciens}
        semiFinis={(semiFinis ?? [])
          .filter((s) => !dejaPourvus.has(s.id as string))
          .map((s) => ({ id: s.id as string, nom: s.code ? `${s.code} · ${s.name}` : (s.name as string) }))}
      />
    </div>
  );
}
