import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { STORAGE_BACKEND_LABELS } from "@/lib/types/domain";
import type { StorageBackendType, StorageTargetRole } from "@/lib/types/domain";
import { formatDate } from "@/lib/utils";
import { NewStorageTargetForm } from "./new-target-form";
import type { EditableTarget } from "./target-actions";
import { TargetControls } from "./target-controls";
import { ViderTamponButton } from "./vider-tampon";
import { Database } from "lucide-react";

/**
 * Cibles de stockage de la médiathèque (section 3.7/9 de l'analyse) —
 * réservé à l'administrateur : c'est la seule page qui lit la configuration
 * (identifiants) des cibles, jamais exposée ailleurs dans l'application.
 */
export default async function StorageTargetsPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const { data: targets } = await supabase.from("storage_targets").select("*").order("created_at", { ascending: true });

  // Fichiers qui attendent dans un tampon (NAS injoignable lors du dépôt).
  const tamponIds = (targets ?? []).filter((t) => t.role === "tampon").map((t) => t.id);
  let enAttente = 0;
  if (tamponIds.length > 0) {
    const { count } = await supabase
      .from("media_file_copies")
      .select("id", { count: "exact", head: true })
      .in("storage_target_id", tamponIds)
      .eq("sync_status", "en_attente")
      .not("remote_path", "is", null);
    enAttente = count ?? 0;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stockage de la médiathèque"
        description="Les nouveaux fichiers sont enregistrés sur les cibles « stockage » actives. Dès qu'un NAS / serveur local est actif, il devient le stockage exclusif et Supabase n'est plus alimenté. Une cible « tampon » ne sert que si aucun stockage n'est joignable : le fichier y attend, puis est déplacé automatiquement."
      />

      {enAttente > 0 && <ViderTamponButton enAttente={enAttente} />}

      <NewStorageTargetForm />

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {targets?.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-foreground-muted" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t.name} {t.is_default && <span className="text-xs text-foreground-muted">(par défaut)</span>}{" "}
                      {t.role === "tampon" && <Badge tone="warning">Tampon</Badge>}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {STORAGE_BACKEND_LABELS[t.type as StorageBackendType]} · créée le {formatDate(t.created_at)}
                    </p>
                  </div>
                </div>
                <TargetControls target={editable(t)} active={t.active} />
              </li>
            ))}
            {(!targets || targets.length === 0) && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">Aucune cible configurée.</li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

/** Ne transmet au navigateur que la configuration non secrète. */
function editable(t: { id: string; name: string; type: string; role: string; config: unknown }): EditableTarget {
  const c = (t.config ?? {}) as Record<string, string | undefined>;
  return {
    id: t.id,
    name: t.name,
    type: t.type as StorageBackendType,
    role: t.role as StorageTargetRole,
    bucket: c.bucket,
    rootFolderId: c.rootFolderId,
    url: c.url,
    username: c.username,
    basePath: c.basePath,
  };
}
