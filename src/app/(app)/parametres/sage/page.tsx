import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { SageConnectionConfig } from "@/lib/types/domain";
import { SageConfigForm } from "./config-form";
import { Info } from "lucide-react";
import Link from "next/link";

export default async function SageSettingsPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const { data: config } = await supabase.from("sage_connection_configs").select("*").limit(1).single();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intégration Sage"
        description="Stock, clients et articles proviennent de Sage — la logique et le modèle de données sont intégrés dès maintenant ; la connexion réelle au serveur SQL local de Sage sera assurée plus tard par une application de synchronisation dédiée."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        En mode <strong>Simulation</strong>, les boutons « Simuler une synchronisation » (pages{" "}
        <Link href="/parametres/stock" className="underline">
          Stock
        </Link>
        ,{" "}
        <Link href="/parametres/clients-sage" className="underline">
          Clients
        </Link>{" "}
        et{" "}
        <Link href="/parametres/articles-sage" className="underline">
          Articles
        </Link>
        ) illustrent le mécanisme sans connexion réelle. En mode <strong>Agent local</strong>, ces mêmes tables
        seront alimentées par l&apos;application de synchronisation installée sur le serveur local de Sage — aucun
        changement d&apos;écran ne sera nécessaire côté Seritex.
      </div>

      <Card>
        <CardHeader
          title="Connexion"
          description="Ces paramètres décrivent où et comment se connecter — la synchronisation réelle reste hors périmètre de ce chantier."
          action={
            config && (
              <Badge tone={config.active ? "success" : "neutral"}>{config.active ? "Active" : "Inactive"}</Badge>
            )
          }
        />
        <CardBody>
          {config && <SageConfigForm config={config as SageConnectionConfig} />}
          {config?.last_test_at && (
            <p className="mt-3 text-xs text-foreground-muted">
              Dernier changement d&apos;état : {formatDateTime(config.last_test_at)} ({config.last_test_status})
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
