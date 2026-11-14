import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPiecesUtilisees } from "@/lib/patronnage/bibliotheque";
import { getSizes } from "@/lib/sizes";
import { normaliserRotations, normaliserSymetrie } from "@/lib/patronnage/rotations";
import { taillesDesSemiFinis } from "@/lib/patronnage/tailles-semi-finis";
import { PageHeader } from "@/components/shell/page-header";
import { PatronBibliothequeManager } from "@/components/atelier/patronnage/patronnage-workspace";
import type { LibraryArticle } from "@/lib/patronnage/types";

export default async function PatronnageBibliothequePage({ searchParams }: { searchParams: Promise<{ semi_fini?: string; taille?: string }> }) {
  await requireUser();
  if (!(await can("patronnage", "view"))) redirect("/dashboard?erreur=acces_refuse");

  const supabase = await createClient();
  const { data: articles } = await supabase
    .from("pattern_articles")
    .select(
      "id,article_code,designation,tolerance_pct,product_model_id,patterns(id,size,pattern_pieces(id,name,expected_count,area,perimeter,points,rotations_autorisees,symetrie))"
    )
    .is("migre_le", null)
    .order("article_code");
  const [canModify, canDelete, used] = await Promise.all([
    can("patronnage", "modify"),
    can("patronnage", "delete"),
    loadPiecesUtilisees(createAdminClient()),
  ]);
  // Si les analyses ne peuvent pas être lues, rien n'est présenté comme supprimable.
  const utilisees = used instanceof Set ? used : null;
  // Un nouveau patron se rattache à un semi-fini qui n'en a pas encore (0143).
  const avecPatron = new Set((articles ?? []).map((a) => a.product_model_id as string | null).filter(Boolean));
  const { data: semiFinis } = await supabase.from("product_models").select("id,code,name").eq("active", true).eq("nature", "semi_fini").order("name");
  const sizes = await getSizes();
  const taillesParSf = await taillesDesSemiFinis(
    supabase,
    (semiFinis ?? []).map((sf) => ({
      id: sf.id as string,
      deposees: (articles ?? []).filter((a) => a.product_model_id === sf.id).flatMap((a) => (a.patterns ?? []).map((p) => p.size)),
    })),
    sizes
  );
  const grille = (semiFinis ?? []).map((sf) => ({
    id: sf.id as string,
    code: (sf.code as string | null) ?? null,
    nom: sf.name as string,
    articleId: (articles ?? []).find((a) => a.product_model_id === sf.id)?.id ?? null,
    tailles: taillesParSf.get(sf.id as string) ?? [],
  }));
  const { semi_fini: depotSf, taille: depotTaille } = await searchParams;
  const productModels = (semiFinis ?? [])
    .filter((s) => !avecPatron.has(s.id as string))
    .map((s) => ({ id: s.id as string, name: s.code ? `${s.code} · ${s.name}` : (s.name as string) }));

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
        rotationsAutorisees: normaliserRotations(piece.rotations_autorisees),
        symetrie: normaliserSymetrie(piece.symetrie),
      })),
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bibliothèque de patrons de référence"
        description="Sert de référence à la reconnaissance automatique de tous les tracés déposés dans le module Patronnage."
        action={
          <div className="flex items-center gap-2">
            {canModify && (
              <Link
                href="/atelier/patronnage/bibliotheque/migration"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                Reprendre un ancien patron
              </Link>
            )}
            <Link
              href="/atelier/patronnage"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              <ArrowLeft className="h-4 w-4" /> Retour au patronnage
            </Link>
          </div>
        }
      />
      <PatronBibliothequeManager
        initialLibrary={library}
        productModels={productModels}
        semiFinis={grille}
        sizes={sizes}
        depotInitial={depotSf ? { semiFiniId: depotSf, taille: depotTaille ?? "" } : null}
        canModify={canModify}
        canDelete={canDelete}
      />
    </div>
  );
}
