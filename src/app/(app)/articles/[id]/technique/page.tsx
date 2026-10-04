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

/**
 * Onglet Technique : zones de couleur, zones imprimables, nomenclature,
 * patrons de la bibliothèque et fiches de placement du modèle (A5 : le
 * patronnage est forcément lié à un modèle).
 */
export default async function ArticleTechniquePage({ params }: { params: Promise<{ id: string }> }) {
  const { canModify } = await requireArticles();
  const { id } = await params;
  const supabase = await createClient();
  const canPatronnage = await can("patronnage", "view");

  const [{ data: zones }, { data: printableZones }, { data: nomenclature }, { data: patterns }, { data: orphans }, { data: fiches }, { data: consumables }] =
    await Promise.all([
      supabase.from("product_zone_templates").select("*").eq("product_model_id", id).order("display_order"),
      supabase.from("product_printable_zones").select("*").eq("product_model_id", id).order("display_order"),
      supabase.from("nomenclature_lines").select("*").eq("product_model_id", id).order("created_at"),
      supabase.from("pattern_articles").select("id,article_code,designation,patterns(id,size)").eq("product_model_id", id).order("article_code"),
      canModify
        ? supabase.from("pattern_articles").select("id,article_code,designation").is("product_model_id", null).order("article_code")
        : Promise.resolve({ data: [] }),
      supabase
        .from("fiches_placement")
        .select("id,numero_ot,statut,date_emission,quantite_totale")
        .eq("product_model_id", id)
        .order("date_emission", { ascending: false })
        .limit(20),
      supabase.from("consumables").select("id,code,designation,unite").eq("actif", true).order("code"),
    ]);

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
          title="Nomenclature"
          description="Consommables par pièce (boutons, fil, étiquettes, emballage…) : consommation théorique calculée à la clôture des ODF. Le tissu reste mesuré par les pesées."
        />
        <CardBody>
          {canModify ? (
            <NomenclatureEditor
              productModelId={id}
              lines={nomenclature ?? []}
              consumables={(consumables ?? []).map((c) => ({ id: c.id as string, code: c.code as string, designation: c.designation as string, unite: c.unite as string }))}
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
        <CardHeader title="Patrons" description="Patrons de référence de la bibliothèque rattachés à ce modèle, un par taille." />
        <CardBody className="space-y-3">
          {(patterns ?? []).length === 0 ? (
            <p className="text-sm text-foreground-muted">Aucun patron rattaché à ce modèle.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(patterns ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono text-xs">{p.article_code}</span> — {p.designation}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    Tailles : {((p.patterns ?? []) as { size: string }[]).map((x) => x.size).join(", ") || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canModify && (
            <AttachPattern
              productModelId={id}
              orphans={(orphans ?? []).map((o) => ({ id: o.id, label: `${o.article_code} — ${o.designation}` }))}
            />
          )}
          {canPatronnage && (
            <Link href="/atelier/patronnage/bibliotheque" className="text-xs font-medium text-brand hover:underline">
              Ouvrir la bibliothèque de patrons →
            </Link>
          )}
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
