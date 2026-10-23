import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPiecesUtilisees } from "@/lib/patronnage/bibliotheque";
import { PageHeader } from "@/components/shell/page-header";
import { PatronBibliothequeManager } from "@/components/atelier/patronnage/patronnage-workspace";
import type { LibraryArticle } from "@/lib/patronnage/types";

export default async function PatronnageBibliothequePage() {
  await requireUser();
  if (!(await can("patronnage", "view"))) redirect("/dashboard?erreur=acces_refuse");

  const supabase = await createClient();
  const { data: articles } = await supabase
    .from("pattern_articles")
    .select(
      "id,article_code,designation,tolerance_pct,patterns(id,size,pattern_pieces(id,name,expected_count,area,perimeter,points))"
    )
    .order("article_code");
  const [canModify, canDelete, used] = await Promise.all([
    can("patronnage", "modify"),
    can("patronnage", "delete"),
    loadPiecesUtilisees(createAdminClient()),
  ]);
  // Si les analyses ne peuvent pas être lues, rien n'est présenté comme supprimable.
  const utilisees = used instanceof Set ? used : null;
  const { data: productModels } = await supabase.from("product_models").select("id,name").eq("active", true).eq("nature", "pf").order("name");

  const library: LibraryArticle[] = (articles ?? []).map((a) => ({
    id: a.id,
    articleCode: a.article_code,
    designation: a.designation,
    tolerancePct: a.tolerance_pct,
    patterns: (a.patterns ?? []).map((p) => ({
      id: p.id,
      size: p.size,
      utilise: utilisees === null || (p.pattern_pieces ?? []).some((piece) => utilisees.has(piece.id)),
      pieces: (p.pattern_pieces ?? []).map((piece) => ({
        id: piece.id,
        name: piece.name,
        expectedCount: piece.expected_count,
        area: piece.area,
        perimeter: piece.perimeter,
        points: piece.points,
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bibliothèque de patrons de référence"
        description="Sert de référence à la reconnaissance automatique de tous les tracés déposés dans le module Patronnage."
        action={
          <Link
            href="/atelier/patronnage"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
          >
            <ArrowLeft className="h-4 w-4" /> Retour au patronnage
          </Link>
        }
      />
      <PatronBibliothequeManager
        initialLibrary={library}
        productModels={productModels ?? []}
        canModify={canModify}
        canDelete={canDelete}
      />
    </div>
  );
}
