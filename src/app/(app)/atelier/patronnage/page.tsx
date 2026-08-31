import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { PatronnageWorkspace } from "@/components/atelier/patronnage/patronnage-workspace";
import type { LibraryArticle } from "@/lib/patronnage/types";

export default async function PatronnagePage() {
  await requireRole(["responsable_production", "administrateur"]);

  const supabase = await createClient();
  const { data: articles } = await supabase
    .from("pattern_articles")
    .select(
      "id,article_code,designation,tolerance_pct,patterns(id,size,pattern_pieces(id,name,expected_count,area,perimeter,points))"
    )
    .order("article_code");

  const library: LibraryArticle[] = (articles ?? []).map((a) => ({
    id: a.id,
    articleCode: a.article_code,
    designation: a.designation,
    tolerancePct: a.tolerance_pct,
    patterns: (a.patterns ?? []).map((p) => ({
      id: p.id,
      size: p.size,
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
        title="Patronnage"
        description="Bibliothèque de patrons de référence et reconnaissance géométrique des tracés de coupe — tolérance zéro avant validation humaine."
      />
      <PatronnageWorkspace initialLibrary={library} />
    </div>
  );
}
