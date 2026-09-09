import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/url";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SampleQrCode } from "@/components/samples/sample-qr-code";
import { formatDateTime } from "@/lib/utils";

/**
 * Fiche sac de déchets autonome, à une URL stable — cible du QR imprimé sur
 * l'étiquette finale une fois le sac "chargé" (lot 7, section 17 du document
 * de logique), même principe que /lots/[code] (lot 6) et
 * /echantillons/[sampleNumber] : un scan depuis un téléphone d'atelier ouvre
 * directement cette page, après connexion si besoin. Outil interne à
 * l'atelier — pas de portée client.
 */
export default async function WasteBagPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/dechets/${code}`)}`);
  if (current.profile.role === "client") notFound();

  const supabase = await createClient();
  const { data: bag } = await supabase
    .from("sacs_dechets")
    .select("id,code,statut,poids_total_kg,created_at,closed_at")
    .eq("code", code)
    .maybeSingle();

  if (!bag) notFound();

  const { data: weighings } = await supabase
    .from("sacs_dechets_pesees")
    .select("id,poids_releve_kg,delta_kg,occurred_at,production_orders(reference,companies(name)),traces_placement(reference)")
    .eq("sac_id", bag.id)
    .order("occurred_at", { ascending: false });

  const baseUrl = await getBaseUrl();

  return (
    <div className="space-y-6">
      <PageHeader title="Sac de déchets" description={bag.code} />
      <Card>
        <CardBody className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <div>
              <Badge tone={bag.statut === "charge" ? "success" : "brand"}>
                {bag.statut === "charge" ? "Chargé" : "En cours"}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">Poids total</p>
              <p className="text-sm font-medium text-foreground">
                {bag.statut === "charge" ? `${bag.poids_total_kg} kg` : "En cours de remplissage"}
              </p>
            </div>
            <p className="text-xs text-foreground-muted">Créé le {formatDateTime(bag.created_at)}</p>
            {bag.closed_at && <p className="text-xs text-foreground-muted">Chargé le {formatDateTime(bag.closed_at)}</p>}
          </div>

          <SampleQrCode url={`${baseUrl}/dechets/${bag.code}`} label={bag.code} size={140} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Historique des pesées"
          description="Delta calculé automatiquement entre deux relevés successifs (section 17 du document de logique)."
        />
        <CardBody className="p-0">
          {!weighings || weighings.length === 0 ? (
            <p className="px-5 py-6 text-sm text-foreground-muted">Aucune pesée enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-border">
              {weighings.map((w) => {
                const po = w.production_orders as unknown as { reference: string; companies: { name: string } | null } | null;
                const trace = w.traces_placement as unknown as { reference: string } | null;
                return (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium text-foreground">
                        {po?.reference ?? "—"}
                        {po?.companies?.name ? ` · ${po.companies.name}` : ""}
                        {trace ? ` · ${trace.reference}` : ""}
                      </p>
                      <p className="text-xs text-foreground-muted">{formatDateTime(w.occurred_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-foreground">+{w.delta_kg} kg</p>
                      <p className="text-xs text-foreground-muted">total {w.poids_releve_kg} kg</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
