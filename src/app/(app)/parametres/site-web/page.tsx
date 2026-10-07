import { ExternalLink } from "lucide-react";
import { can, requireModule } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { SiteSettingsForm } from "./site-settings-form";

/**
 * Paramètres > Site web (migration 0110) : activer ou désactiver l'e-shop et
 * l'outil « Personnaliser » du site www.seritex.ci, à tout moment. Couper ne
 * casse rien : le site renvoie vers la demande de devis, les demandes déjà
 * reçues restent dans Demandes.
 */
export default async function SiteWebSettingsPage() {
  await requireModule("site_web");
  const supabase = await createClient();
  const [{ data: s }, canModify, { count: publiables }, { count: recues }] = await Promise.all([
    supabase.from("site_settings").select("eshop_actif,personnaliser_actif,message_fermeture,updated_at").maybeSingle(),
    can("site_web", "modify"),
    supabase.from("product_models").select("id", { count: "exact", head: true }).eq("publiable_eshop", true).eq("active", true).eq("nature", "pf"),
    supabase.from("requests").select("id", { count: "exact", head: true }).not("personnalisation", "is", null),
  ]);
  const eshop = !!s?.eshop_actif;
  const personnaliser = eshop && !!s?.personnaliser_actif;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site web"
        description="Activez ou désactivez l'e-shop et l'outil « Personnaliser » du site www.seritex.ci à tout moment. Désactivé, le site invite à demander un devis ; rien n'est perdu et les demandes déjà reçues restent dans Demandes."
      />

      <Card>
        <CardHeader
          title="État du site"
          description={s?.updated_at ? `Dernière modification le ${formatDate(s.updated_at as string)}.` : undefined}
        />
        <CardBody className="space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            E-shop {eshop ? <Badge tone="success">En ligne</Badge> : <Badge tone="neutral">Désactivé</Badge>}
            · Personnaliser {personnaliser ? <Badge tone="success">En ligne</Badge> : <Badge tone="neutral">Désactivé</Badge>}
          </p>
          <p className="text-foreground-muted">
            {publiables ?? 0} modèle(s) coché(s) « Publiable sur l&apos;e-shop » (fiche article, onglet Médias & e-shop) ·{" "}
            {recues ?? 0} demande(s) reçue(s) depuis « Personnaliser ».
          </p>
          {eshop && (publiables ?? 0) === 0 ? (
            <p className="text-warning">E-shop activé mais aucun modèle publiable : le site affiche « Le catalogue en ligne arrive bientôt ».</p>
          ) : null}
          <a href="https://www.seritex.ci/personnaliser" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
            Voir la page sur le site <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Interrupteurs" description="Appliqués sur le site en moins d'une minute. Chaque changement est inscrit au journal d'audit." />
        <CardBody>
          <SiteSettingsForm
            eshop={eshop}
            personnaliser={!!s?.personnaliser_actif}
            message={(s?.message_fermeture as string | null) ?? null}
            canModify={canModify}
          />
        </CardBody>
      </Card>
    </div>
  );
}
