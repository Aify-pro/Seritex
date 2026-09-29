import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { Info } from "lucide-react";
import Link from "next/link";

type MirrorTableStatus = {
  label: string;
  href: string;
  rowCount: number;
  lastSyncAt: string | null;
};

// Seuils de fraîcheur alignés sur l'intervalle visé pour le job NAS -> Supabase
// (quelques minutes à quelques dizaines de minutes) — voir scripts/sage-nas-sync.
const FRESH_MINUTES = 30;
const STALE_MINUTES = 120;

function freshnessBadge(lastSyncAt: string | null) {
  if (!lastSyncAt) return <Badge tone="neutral">Jamais synchronisé</Badge>;
  const ageMinutes = (Date.now() - new Date(lastSyncAt).getTime()) / 60000;
  if (ageMinutes <= FRESH_MINUTES) return <Badge tone="success">À jour</Badge>;
  if (ageMinutes <= STALE_MINUTES) return <Badge tone="warning">Un peu ancien</Badge>;
  return <Badge tone="danger">Synchronisation arrêtée ?</Badge>;
}

async function getMirrorStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: "sage_customers_view" | "sage_articles_view" | "stock_item_view",
  label: string,
  href: string
): Promise<MirrorTableStatus> {
  const [{ count }, { data: last }] = await Promise.all([
    supabase.from(table).select("*", { count: "exact", head: true }),
    supabase.from(table).select("last_sync_at").order("last_sync_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return { label, href, rowCount: count ?? 0, lastSyncAt: last?.last_sync_at ?? null };
}

/**
 * Statut réel du pont Sage -> NAS -> Supabase (scripts/sage-nas-sync),
 * remplace l'ancien formulaire de "configuration de connexion" en mode
 * simulation (migration 0005) — la vraie synchronisation existe désormais,
 * pilotée par un job externe (NAS) qui écrit directement dans les 3 tables
 * miroir via la clé service_role. Cette page ne fait plus que lire ces
 * tables : aucune configuration à saisir ni de bouton "simuler" ici.
 */
export default async function SageSettingsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [clients, articles, stock] = await Promise.all([
    getMirrorStatus(supabase, "sage_customers_view", "Clients", "/parametres/clients-sage"),
    getMirrorStatus(supabase, "sage_articles_view", "Articles", "/parametres/articles-sage"),
    getMirrorStatus(supabase, "stock_item_view", "Stock (lignes, tous dépôts)", "/parametres/stock"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Intégration Sage"
        description="Stock, clients et articles proviennent de Sage, via un pont Sage -> NAS -> Supabase alimenté par un job externe (compte technique à droits restreints). Seritex n'écrit jamais dans ces tables."
      />

      <div className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Cette page est en lecture seule : elle reflète ce que le job de synchronisation a écrit en dernier. Pour
        configurer le job lui-même (fréquence, périmètre), voir <code>scripts/sage-nas-sync/README.md</code> dans le
        dépôt.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[clients, articles, stock].map((s) => (
          <Card key={s.label}>
            <CardHeader title={s.label} action={freshnessBadge(s.lastSyncAt)} />
            <CardBody className="space-y-1">
              <p className="text-2xl font-semibold text-foreground">{s.rowCount}</p>
              <p className="text-xs text-foreground-muted">
                Dernière synchro : {s.lastSyncAt ? formatDateTime(s.lastSyncAt) : "—"}
              </p>
              <Link href={s.href} className="text-xs text-brand underline">
                Voir le détail
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
