import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { getFichePlacementById, getPatternReferenceOptions } from "@/lib/patronnage/fiches-query";
import { FicheDetailContent } from "@/components/atelier/patronnage/fiches-placement-client";

/**
 * Page dédiée d'une fiche de placement — remplace l'ancienne ouverture en
 * fenêtre (Dialog) depuis la liste `/atelier/patronnage` : une vraie URL par
 * fiche, partageable et bookmarkable, et cible directe du lien "OT lié"
 * depuis la fiche ODF (cf. fiche-patronnage-link.tsx côté production) au
 * lieu de renvoyer vers le module sans plus de précision.
 *
 * `?trace=<id>` reprend le même usage qu'avant (carte "Rendement matière"
 * de l'ODF, lot 8) : amène directement au tracé concerné dans la fiche.
 */
export default async function FichePlacementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trace?: string }>;
}) {
  await requireUser();
  const [canView, canCreate, canModify, canValidate, canUnlock, canArchive, canDelete, createTrace, modifyTrace] =
    await Promise.all([
      can("patronnage", "view"),
      can("patronnage", "create"),
      can("patronnage", "modify"),
      can("patronnage", "validate"),
      can("patronnage", "unlock"),
      can("patronnage", "archive"),
      can("patronnage", "delete"),
      can("patronnage_traces", "create"),
      can("patronnage_traces", "modify"),
    ]);

  // Le droit sur les tracés est un module à part (« Patronnage — tracés ») :
  // la PAO en dispose sans avoir le moindre droit sur la fiche. `canModify`
  // reste inclus pour qu'un rôle ayant la main sur la fiche garde la main sur
  // ses tracés — même règle que la RLS (migration 0027).
  const canAddTrace = createTrace || canModify;
  const canModifyTrace = modifyTrace || canModify;
  if (!canView) redirect("/dashboard?erreur=acces_refuse");

  const { id } = await params;
  const { trace } = await searchParams;

  const [fiche, referenceOptions] = await Promise.all([getFichePlacementById(id), getPatternReferenceOptions()]);
  if (!fiche) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Fiche ${fiche.numeroOt}`}
        description={fiche.clientLibelle ?? undefined}
        action={
          <Link href="/atelier/patronnage">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="h-3.5 w-3.5" /> Retour à la liste
            </Button>
          </Link>
        }
      />

      <FicheDetailContent
        fiche={fiche}
        referenceOptions={referenceOptions}
        permissions={{ canCreate, canModify, canAddTrace, canModifyTrace, canValidate, canUnlock, canArchive, canDelete }}
        highlightTraceId={trace ?? null}
      />
    </div>
  );
}
