import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { UploadMediaForm } from "@/components/media/upload-media-form";
import { AddVersionForm } from "@/components/media/add-version-form";
import { DeleteMediaFileForm } from "@/components/media/delete-media-file-form";
import { MediaFileHistory, type HistoryEvent } from "@/components/media/media-file-history";
import { MediaFileRequests, type RequestOption } from "@/components/media/media-file-requests";
import { MediaLibraryFilter } from "@/components/media/media-library-filter";
import { MEDIA_CATEGORY_LABELS } from "@/lib/types/domain";
import { formatDate, formatFileSize } from "@/lib/utils";
import { can } from "@/lib/auth/permissions";
import { FileText } from "lucide-react";

type MediaFileRow = {
  id: string;
  file_name: string;
  category: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  media_file_versions: {
    id: string;
    version_number: number;
    created_at: string;
    media_file_copies: {
      id: string;
      sync_status: "en_attente" | "synchronise" | "erreur";
      error_message: string | null;
      storage_targets: { name: string; type: "supabase_storage" | "google_drive" | "nas" | "local_server" } | null;
    }[];
  }[];
  media_file_events: {
    id: string;
    event_type: "ajout" | "mise_a_jour" | "suppression";
    reason: string;
    occurred_at: string;
    app_users: { full_name: string } | null;
  }[];
  // Demandes auxquelles ce fichier est affilié (migration 0043).
  request_media_files: { requests: RequestOption | null }[];
};

/**
 * Médiathèque d'un client : fichiers triés par date d'ajout (section 3.7 de
 * l'analyse), avec historique documenté (raison de chaque ajout/mise à
 * jour), statut de réplication par cible de stockage, et — depuis la
 * migration 0043 — classée par demande : chaque fichier peut être affilié
 * à plusieurs demandes (réutilisation), `requestId` filtre l'affichage sur
 * le "dossier" d'une demande donnée sans jamais en cacher d'autres.
 */
export async function MediaLibrary({ companyId, requestId = null }: { companyId: string; requestId?: string | null }) {
  const supabase = await createClient();

  // Note : `media_files` porte DEUX relations vers `media_file_versions`
  // (`current_version_id` en plus de la relation inverse portée par
  // `media_file_versions.media_file_id`). PostgREST ne peut pas deviner
  // laquelle utiliser pour l'imbrication ci-dessous — sans le nom explicite
  // de la contrainte, la requête échoue avec une erreur d'ambiguïté
  // (PGRST201), silencieusement ignorée si on ne vérifie pas `error`.
  const [{ data: files, error }, { data: companyRequests }] = await Promise.all([
    supabase
      .from("media_files")
      .select(
        `id, file_name, category, mime_type, size_bytes, created_at,
         media_file_versions!media_file_versions_media_file_id_fkey ( id, version_number, created_at,
           media_file_copies ( id, sync_status, error_message, storage_targets ( name, type ) )
         ),
         media_file_events ( id, event_type, reason, occurred_at, app_users ( full_name ) ),
         request_media_files ( requests ( id, reference ) )`
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("requests").select("id,reference").eq("company_id", companyId).order("created_at", { ascending: false }),
  ]);

  if (error) {
    console.error("MediaLibrary: échec du chargement des fichiers", error);
  }

  const requestOptions = (companyRequests ?? []) as RequestOption[];
  let mediaFiles = (files ?? []) as unknown as MediaFileRow[];
  if (requestId) {
    mediaFiles = mediaFiles.filter((f) => f.request_media_files.some((rl) => rl.requests?.id === requestId));
  }
  const canDelete = await can("mediatheque", "delete");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MediaLibraryFilter requests={requestOptions} currentRequestId={requestId} />
      </div>

      <UploadMediaForm companyId={companyId} requestId={requestId ?? undefined} />

      {error && (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          Impossible de charger la liste des fichiers pour le moment. Réessayez dans un instant ou contactez le
          support si le problème persiste.
        </p>
      )}

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-border">
            {mediaFiles.map((f) => {
              const latestVersion = [...f.media_file_versions].sort((a, b) => b.version_number - a.version_number)[0];
              const copies = (latestVersion?.media_file_copies ?? []).map((c) => ({
                targetName: c.storage_targets?.name ?? "?",
                targetType: c.storage_targets?.type ?? "supabase_storage",
                status: c.sync_status,
                errorMessage: c.error_message,
              }));
              const events: HistoryEvent[] = [...f.media_file_events]
                .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
                .map((e) => ({
                  id: e.id,
                  event_type: e.event_type,
                  reason: e.reason,
                  occurred_at: e.occurred_at,
                  author_name: e.app_users?.full_name ?? null,
                }));
              const affiliatedRequests = f.request_media_files
                .map((rl) => rl.requests)
                .filter((r): r is RequestOption => !!r);

              return (
                <li key={f.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-foreground-muted" />
                      <p className="truncate text-sm font-medium text-foreground">{f.file_name}</p>
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-foreground-muted">
                        {MEDIA_CATEGORY_LABELS[f.category as keyof typeof MEDIA_CATEGORY_LABELS] ?? f.category}
                      </span>
                    </div>
                    <p className="shrink-0 text-xs text-foreground-muted">
                      Ajouté le {formatDate(f.created_at)} · {formatFileSize(f.size_bytes)} · v{latestVersion?.version_number ?? 1}
                    </p>
                  </div>
                  <MediaFileRequests mediaFileId={f.id} attached={affiliatedRequests} available={requestOptions} />
                  <MediaFileHistory events={events} copies={copies} />
                  <div className="flex flex-wrap items-center gap-4">
                    <AddVersionForm mediaFileId={f.id} />
                    {canDelete && <DeleteMediaFileForm mediaFileId={f.id} companyId={companyId} />}
                  </div>
                </li>
              );
            })}
            {mediaFiles.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-foreground-muted">
                {requestId ? "Aucun fichier affilié à cette demande pour l'instant." : "Aucun fichier pour ce client."}
              </li>
            )}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
