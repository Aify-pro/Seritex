import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireArticles } from "@/lib/articles/access";
import { can } from "@/lib/auth/permissions";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { ZoneTemplateEditor } from "../_components/zone-template-editor";
import { PrintableZoneEditor } from "../_components/printable-zone-editor";
import { NomenclatureEditor } from "../_components/nomenclature-editor";
import { AttachPattern } from "../_components/attach-pattern";
import { MockupEditor, type MockupData } from "../_components/mockup-editor";

type PatronRow = { id: string; article_code: string; designation: string; product_model_id: string | null; patterns: { size: string }[] | null };

/** Liste des patrons de la bibliothèque, avec leurs tailles. */
function PatronList({ patterns, empty, semiFiniName }: { patterns: PatronRow[]; empty: string; semiFiniName?: (id: string | null) => string | null }) {
  if (patterns.length === 0) return <p className="text-sm text-foreground-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {patterns.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span>
            {semiFiniName && <span className="mr-1.5 font-medium">{semiFiniName(p.product_model_id) ?? "Ancien patron du modèle"} :</span>}
            <span className="font-mono text-xs">{p.article_code}</span> — {p.designation}
          </span>
          <span className="text-xs text-foreground-muted">Tailles : {(p.patterns ?? []).map((x) => x.size).join(", ") || "—"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Onglet Technique. Produit fini : zones de couleur, zones imprimables,
 * nomenclature (semi-finis et consommables), patrons de ses semi-finis et
 * fiches de placement. Semi-fini (0143) : son patron de la bibliothèque, un
 * par taille, partagé par tous les produits finis qui l'emploient (A5 : le
 * patronnage est forcément lié à un modèle).
 */
export default async function ArticleTechniquePage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const canPatronnage = await can("patronnage", "view");
  const { data: model } = await supabase.from("product_models").select("nature").eq("id", id).maybeSingle();

  const orphansQuery = canModify
    ? supabase.from("pattern_articles").select("id,article_code,designation").is("product_model_id", null).order("article_code")
    : Promise.resolve({ data: [] as { id: string; article_code: string; designation: string }[] });
  const bibliothequeLink = canPatronnage && (
    <Link href="/atelier/patronnage/bibliotheque" className="text-xs font-medium text-brand hover:underline">
      Ouvrir la bibliothèque de patrons →
    </Link>
  );

  if (model?.nature === "semi_fini") {
    const [{ data: patterns }, { data: orphans }] = await Promise.all([
      supabase.from("pattern_articles").select("id,article_code,designation,product_model_id,patterns(size)").eq("product_model_id", id).order("article_code"),
      orphansQuery,
    ]);
    return (
      <Card>
        <CardHeader
          title="Patron"
          description="Patron de référence de la bibliothèque, un par taille : le même pour tous les produits finis dont la nomenclature emploie ce semi-fini. Il se dépose dans la bibliothèque de patronnage."
        />
        <CardBody className="space-y-3">
          <PatronList patterns={(patterns ?? []) as PatronRow[]} empty="Aucun patron pour ce semi-fini." />
          {canModify && (patterns ?? []).length === 0 && (
            <AttachPattern productModelId={id} orphans={(orphans ?? []).map((o) => ({ id: o.id, label: `${o.article_code} — ${o.designation}` }))} />
          )}
          {bibliothequeLink}
        </CardBody>
      </Card>
    );
  }

  const [{ data: zones }, { data: printableZones }, { data: nomenclature }, { data: fiches }, { data: consumables }, { data: mockups }, { data: semiFinis }, { data: couleurs }, { data: matieres }] =
    await Promise.all([
      supabase.from("product_zone_templates").select("*").eq("product_model_id", id).order("display_order"),
      supabase.from("product_printable_zones").select("*").eq("product_model_id", id).order("display_order"),
      supabase.from("nomenclature_lines").select("*").eq("product_model_id", id).order("created_at"),
      supabase
        .from("fiches_placement")
        .select("id,numero_ot,statut,date_emission,quantite_totale")
        .eq("product_model_id", id)
        .order("date_emission", { ascending: false })
        .limit(20),
      supabase.from("consumables").select("id,code,designation,unite").eq("actif", true).order("code"),
      supabase.from("product_model_mockups").select("vue,svg,zones,largeur_cm,cadre,reperes").eq("product_model_id", id),
      supabase.from("product_models").select("id,code,name").eq("nature", "semi_fini").eq("active", true).order("name"),
      supabase.from("colors").select("id,name").eq("active", true).order("name"),
      supabase.from("product_models").select("id,name,unite").eq("nature", "mp").eq("active", true).order("name"),
    ]);
  // Patrons : ceux des semi-finis de la nomenclature (0143), plus l'ancien
  // patron rattaché directement au produit fini s'il en a un (ART-A).
  const semiFiniIds = [...new Set((nomenclature ?? []).map((l) => l.semi_fini_id as string | null).filter((x): x is string => !!x))];
  const { data: patterns } = await supabase
    .from("pattern_articles")
    .select("id,article_code,designation,product_model_id,patterns(size)")
    .in("product_model_id", [id, ...semiFiniIds])
    .order("article_code");
  const semiFiniName = (modelId: string | null) => (semiFinis ?? []).find((s) => s.id === modelId)?.name ?? null;
  const mockup = (vue: string) => ((mockups ?? []).find((m) => m.vue === vue) as MockupData | undefined) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Zones" description="Zones de couleur proposées sur l'ODF, et surfaces où une impression peut être réalisée." />
        <CardBody className="space-y-4">
          {canModify ? (
            <>
              <ZoneTemplateEditor productModelId={id} zones={zones ?? []} />
              <PrintableZoneEditor productModelId={id} zones={printableZones ?? []} />
            </>
          ) : (
            <div className="space-y-1 text-sm">
              <p>Zones de couleur : {(zones ?? []).map((z) => z.zone_label).join(", ") || "aucune"}</p>
              <p>Zones imprimables : {(printableZones ?? []).map((z) => z.zone_label).join(", ") || "aucune"}</p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Mockups SVG (e-shop)"
          description="Un dessin par vue, dont les calques portent le nom des zones de couleur : sur l'e-shop, le client voit son vêtement aux bonnes couleurs, zone par zone, et place ses visuels à l'échelle. Les repères positionnent les zones d'impression ; pour chacune, cochez les zones de couleur où le visuel peut passer (hors de ces zones il est coupé). Le calque « Design » porte le tracé du vêtement."
        />
        <CardBody className="space-y-4">
          {(["avant", "dos"] as const).map((vue) => (
            <MockupEditor
              key={vue}
              modelId={id}
              vue={vue}
              initial={mockup(vue)}
              zonesCouleur={(zones ?? []).map((z) => ({ zone_key: z.zone_key as string, zone_label: z.zone_label as string }))}
              zonesImpression={(printableZones ?? []).map((z) => ({ id: z.id as string, zone_label: z.zone_label as string }))}
              canModify={canModify}
            />
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Nomenclature"
          description="Semi-finis qui composent le vêtement (manches, col, corps…), matières premières autres que le tissu principal (bord-côte du col, en kg théoriques par pièce) et consommables par pièce (boutons, fil, étiquettes, emballage…). Chaque ligne prend la couleur du produit fini — couleur unique ou celle d'une zone — sauf couleur imposée. Le tissu est celui du produit fini, mesuré par les pesées ; la consommation théorique des consommables est calculée à la clôture des ODF."
        />
        <CardBody>
          {canModify ? (
            <NomenclatureEditor
              productModelId={id}
              lines={nomenclature ?? []}
              consumables={(consumables ?? []).map((c) => ({ id: c.id as string, code: c.code as string, designation: c.designation as string, unite: c.unite as string }))}
              semiFinis={(semiFinis ?? []).map((s) => ({ id: s.id as string, code: (s.code as string | null) ?? null, name: s.name as string }))}
              matieres={(matieres ?? []).map((m) => ({ id: m.id as string, name: m.name as string, unite: m.unite as string }))}
              zones={(zones ?? []).map((z) => ({ zone_key: z.zone_key as string, zone_label: z.zone_label as string }))}
              couleurs={(couleurs ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
            />
          ) : (
            <ul className="space-y-1 text-sm">
              {(nomenclature ?? []).map((l) => (
                <li key={l.id}>
                  {l.designation} — {l.quantite_par_piece} {l.unite} / pièce
                </li>
              ))}
              {(nomenclature ?? []).length === 0 && <li className="text-foreground-muted">Aucune ligne.</li>}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Patrons"
          description="Patrons de référence des semi-finis de la nomenclature, un par taille : c'est la nomenclature qui dit quelle manche, quel col… ce produit fini emploie."
        />
        <CardBody className="space-y-3">
          <PatronList patterns={(patterns ?? []) as PatronRow[]} empty="Aucun patron : ajoutez les semi-finis à la nomenclature, puis déposez leur patron dans la bibliothèque." semiFiniName={semiFiniName} />
          {bibliothequeLink}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Fiches de placement" description="Les 20 dernières fiches de patronnage de ce modèle." />
        <CardBody className="p-0">
          {(fiches ?? []).length === 0 ? (
            <p className="px-5 py-4 text-sm text-foreground-muted">Aucune fiche de placement pour ce modèle.</p>
          ) : (
            <ul className="divide-y divide-border">
              {(fiches ?? []).map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  {canPatronnage ? (
                    <Link href={`/atelier/patronnage/${f.id}`} className="font-medium text-brand hover:underline">
                      {f.numero_ot}
                    </Link>
                  ) : (
                    <span className="font-medium">{f.numero_ot}</span>
                  )}
                  <span className="flex items-center gap-2 text-xs text-foreground-muted">
                    {f.quantite_totale ? `${f.quantite_totale} pcs · ` : ""}
                    {formatDate(f.date_emission)}
                    <Badge tone="neutral">{String(f.statut).replace(/_/g, " ")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
