import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { BesoinsCoupe } from "@/components/atelier/patronnage/besoins-coupe";
import { besoinsCoupe } from "../fiches-actions";
import { PlanCoupe } from "@/components/atelier/patronnage/plan-coupe";
import { tissusDesBesoins, type LigneBesoin } from "@/lib/imbrication/plan-coupe";

/**
 * Besoins de coupe (étape 3c, migration 0155) : tout ce qu'il reste à couper,
 * par semi-fini, taille, tissu et couleur, pour toutes les ODF ouvertes. La
 * PAO coche ce qu'elle regroupe sur un matelas, puis dessine le tracé dans
 * Modaris/Diamino : Seritex ne place rien.
 */
export default async function BesoinsCoupePage() {
  await requireUser();
  if (!(await can("patronnage", "view"))) redirect("/dashboard?erreur=acces_refuse");
  const [canCreate, createTrace, modifyTrace] = await Promise.all([can("patronnage", "create"), can("patronnage_traces", "create"), can("patronnage", "modify")]);

  const res = await besoinsCoupe();
  const supabase = await createClient();
  const { data: ordres } = await supabase
    .from("fiches_placement")
    .select("id,numero_ot,designation_article")
    .eq("regroupee", true)
    .neq("statut", "archive")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Besoins de coupe"
        description="Ce qu'il reste à couper pour les ordres de fabrication ouverts, par pièce (semi-fini). Composez vos matelas selon l'efficience : un tracé peut porter une ou plusieurs pièces."
        action={
          <Link href="/atelier/patronnage" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Fiches de placement
          </Link>
        }
      />
      <PlanCoupe
        tissus={
          "error" in res
            ? []
            : tissusDesBesoins(
                res.map((g): LigneBesoin => ({
                  semi_fini_id: g.semiFiniId,
                  semi_fini_nom: g.semiFiniNom,
                  taille: g.taille,
                  textile_id: g.textileId,
                  tissu: g.tissu,
                  grammage: g.grammage,
                  couleur: g.couleur,
                  reste: g.reste,
                  formes: g.formes,
                }))
              )
        }
      />
      <BesoinsCoupe
        groupes={"error" in res ? [] : res}
        erreur={"error" in res ? res.error : null}
        ordres={(ordres ?? []).map((o) => ({ id: o.id as string, numeroOt: o.numero_ot as string, designation: (o.designation_article as string | null) ?? null }))}
        peutCreer={canCreate && (createTrace || modifyTrace)}
      />
    </div>
  );
}
