import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { getSizes } from "@/lib/sizes";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { stageRowFromDb } from "@/lib/production/flow";
import { RouteEditor, type RouteView } from "../_components/route-editor";

/** Onglet Fabrication (ART-H) : parcours types du modèle et son en-cours, par ODF, étape et taille. */
export default async function ArticleFabricationPage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: routes }, { data: sections }, { data: categories }, { data: lines }] = await Promise.all([
    supabase
      .from("model_routes")
      .select("id,nom,par_defaut,model_route_steps(id,etape,ordre,section_id,atelier_category,mode_parallelisme,partie,sections(name))")
      .eq("product_model_id", id)
      .order("par_defaut", { ascending: false })
      .order("nom"),
    supabase.from("sections").select("id,name,atelier_categories(cle)").eq("active", true).order("display_order"),
    supabase.from("atelier_categories").select("cle,nom").eq("active", true).neq("cle", "finition").order("display_order"),
    supabase
      .from("production_order_lines")
      .select("id,description,production_orders!inner(id,reference,status)")
      .eq("product_model_id", id)
      .in("production_orders.status", ["en_production", "demande_cloture"]),
  ]);
  const catNom = new Map((categories ?? []).map((c) => [c.cle as string, c.nom as string]));

  const routeViews: RouteView[] = (routes ?? []).map((r) => ({
    id: r.id,
    nom: r.nom,
    parDefaut: r.par_defaut,
    steps: (
      (r.model_route_steps ?? []) as unknown as {
        id: string;
        etape: number;
        ordre: number;
        atelier_category: string | null;
        mode_parallelisme: "quantite" | "partie";
        partie: string | null;
        sections: { name: string } | null;
      }[]
    )
      .sort((a, b) => a.etape - b.etape || a.ordre - b.ordre)
      .map((s) => ({
        id: s.id,
        etape: s.etape,
        label: s.sections?.name ?? `${catNom.get(s.atelier_category ?? "") ?? s.atelier_category} (catégorie)`,
        mode: s.mode_parallelisme,
        partie: s.partie,
      })),
  }));

  // En-cours du modèle : pour chaque article en production, pièces en cours par étape et taille.
  const sizes = await getSizes();
  const libelle = (cle: string) => sizes.find((s) => s.cle === cle)?.libelle ?? cle;
  const enCours = await Promise.all(
    (lines ?? []).map(async (l) => {
      const { data } = await supabase.rpc("line_stage_flow", { p_line_id: l.id });
      const stages = ((data ?? []) as Parameters<typeof stageRowFromDb>[0][]).map(stageRowFromDb).filter((s) => s.enCours > 0);
      const po = l.production_orders as unknown as { id: string; reference: string };
      return { lineId: l.id, description: l.description as string, po, stages };
    })
  );
  const avecEnCours = enCours.filter((e) => e.stages.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Parcours types"
          description="Pré-remplissent les étapes d'un article d'ODF (« appliquer un parcours type »), qui restent modifiables. Point d'entrée Coupe ou Stock ; Finition imposée en dernier."
        />
        <CardBody>
          <RouteEditor
            productModelId={id}
            routes={routeViews}
            sections={(sections ?? [])
              .filter((s) => (s.atelier_categories as unknown as { cle: string } | null)?.cle !== "finition")
              .map((s) => ({ id: s.id, name: s.name }))}
            categories={(categories ?? []).map((c) => ({ cle: c.cle, nom: c.nom }))}
            editable={canModify}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="En-cours" description="Pièces de ce modèle encore dans les ateliers, par ODF, étape et taille." />
        <CardBody className="p-0">
          {avecEnCours.length === 0 ? (
            <p className="px-5 py-4 text-sm text-foreground-muted">Aucune pièce de ce modèle en cours de fabrication.</p>
          ) : (
            <ul className="divide-y divide-border">
              {avecEnCours.map((e) => (
                <li key={e.lineId} className="px-5 py-3 text-sm">
                  <Link href={`/atelier/production/${e.po.id}`} className="font-medium text-brand hover:underline">
                    {e.po.reference}
                  </Link>{" "}
                  <span className="text-foreground-muted">· {e.description}</span>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {e.stages.map((s) => `étape ${s.etape} · ${libelle(s.taille)} : ${s.enCours}`).join(" — ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
