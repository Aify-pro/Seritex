import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SampleQrCode } from "@/components/samples/sample-qr-code";
import { formatDateTime } from "@/lib/utils";

const CATEGORIE_LABELS: Record<string, string> = { semi_fini: "Semi-fini", fini: "Fini", dechet: "Déchet" };

/**
 * Fiche lot article autonome, à une URL stable — la cible du QR imprimé sur
 * l'étiquette (lot 6, section 15 du document de logique) : un scan depuis un
 * téléphone d'atelier ouvre directement cette page, après connexion si
 * besoin (même mécanisme que /echantillons/[sampleNumber], voir ce fichier).
 * Outil interne à l'atelier — pas de portée client, contrairement aux
 * échantillons.
 */
export default async function ArticleLotPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/lots/${code}`)}`);
  if (current.profile.role === "client") notFound();

  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("article_lots")
    .select("id,code,categorie,composition_taille,created_at,production_orders(reference,companies(name)),traces_placement(reference)")
    .eq("code", code)
    .maybeSingle();

  if (!lot) notFound();

  const baseUrl = await getBaseUrl();
  const productionOrder = lot.production_orders as unknown as { reference: string; companies: { name: string } | null } | null;
  const trace = lot.traces_placement as unknown as { reference: string } | null;
  const composition = (lot.composition_taille ?? {}) as Record<string, number>;

  return (
    <div className="space-y-6">
      <PageHeader title="Lot article" description={lot.code} />
      <Card>
        <CardBody className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <div>
              <Badge tone="brand">{CATEGORIE_LABELS[lot.categorie] ?? lot.categorie}</Badge>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Ordre de fabrication</p>
              <p className="text-sm font-medium text-foreground">
                {productionOrder?.reference ?? "—"}
                {productionOrder?.companies?.name ? ` · ${productionOrder.companies.name}` : ""}
              </p>
            </div>
            {trace && (
              <div>
                <p className="text-xs text-foreground-muted">Tracé d&apos;origine</p>
                <p className="text-sm font-medium text-foreground">{trace.reference}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-foreground-muted">Composition</p>
              <p className="text-sm text-foreground">
                {Object.entries(composition).length > 0
                  ? Object.entries(composition)
                      .map(([taille, qte]) => `${taille} : ${qte}`)
                      .join(" · ")
                  : "Non renseignée"}
              </p>
            </div>
            <p className="text-xs text-foreground-muted">Généré le {formatDateTime(lot.created_at)}</p>
          </div>

          <SampleQrCode url={`${baseUrl}/lots/${lot.code}`} label={lot.code} size={140} />
        </CardBody>
      </Card>
    </div>
  );
}
