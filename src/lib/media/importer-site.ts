import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { replicateWithBuffer } from "@/lib/storage";
import type { StorageTargetRow } from "@/lib/storage/types";

/**
 * Copie dans la médiathèque du client (et sur le NAS, ou à défaut sur le tampon) les fichiers envoyés
 * par le site : logos, maquette PDF, image de la maquette (migration 0136). Déclenché chaque minute par
 * /api/notifications/traiter, pour toute demande qui a une société — à la réception si le client est
 * reconnu, sinon dès qu'on la rattache. Le fichier du bucket « site-personnalisation » est conservé.
 *
 * Reprenable : la fiche de médiathèque est créée une fois (prepare_site_file_import est idempotente) ;
 * seule la copie des octets est retentée. Au premier échec, on s'arrête pour ce passage (NAS
 * probablement injoignable) plutôt que d'attendre le délai d'écriture pour chaque fichier.
 */

const LOT = 25;
const TENTATIVES_MAX = 60;
const BUDGET_MS = 60_000;

export interface ImportSiteResult {
  importes: number;
  echecs: number;
  restants: boolean;
}

export async function importerFichiersSite(): Promise<ImportSiteResult> {
  const admin = createAdminClient();
  const debut = Date.now();
  const resultat: ImportSiteResult = { importes: 0, echecs: 0, restants: false };

  const { data: aImporter } = await admin
    .from("request_site_files")
    .select("id, import_attempts, requests!inner(company_id)")
    .is("imported_at", null)
    .lt("import_attempts", TENTATIVES_MAX)
    .not("requests.company_id", "is", null)
    .order("import_attempts", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(LOT);
  if (!aImporter || aImporter.length === 0) return resultat;

  const { data: cibles } = await admin.from("storage_targets").select("*").eq("active", true);
  if (!cibles || cibles.length === 0) return resultat;

  for (const f of aImporter) {
    if (Date.now() - debut > BUDGET_MS) {
      resultat.restants = true;
      break;
    }
    try {
      const { data: prep, error: prepErreur } = await admin.rpc("prepare_site_file_import", { p_file_id: f.id });
      if (prepErreur) throw new Error(prepErreur.message);
      if (prep?.statut !== "a_envoyer") continue;

      const { data: blob, error: lectureErreur } = await admin.storage.from("site-personnalisation").download(prep.path);
      if (lectureErreur || !blob) throw new Error(`lecture du fichier du site impossible (${lectureErreur?.message ?? "introuvable"})`);

      const { outcomes } = await replicateWithBuffer(cibles as StorageTargetRow[], {
        companyId: prep.company_id,
        companyName: prep.company_name ?? "Client",
        fileName: prep.file_name,
        mimeType: prep.mime_type ?? null,
        buffer: Buffer.from(await blob.arrayBuffer()),
      });
      if (outcomes.length === 0 || outcomes.every((o) => o.status === "erreur")) {
        throw new Error(outcomes[0]?.errorMessage ?? "aucun stockage n'a pu recevoir le fichier");
      }

      // Reprise après un échec partiel : on repart de copies propres pour cette version.
      await admin.from("media_file_copies").delete().eq("media_file_version_id", prep.version_id);
      await admin.from("media_file_copies").insert(
        outcomes.map((o) => ({
          media_file_version_id: prep.version_id,
          storage_target_id: o.targetId,
          remote_path: o.remotePath ?? null,
          sync_status: o.status,
          error_message: o.errorMessage ?? null,
          synced_at: o.status === "synchronise" ? new Date().toISOString() : null,
        }))
      );
      await admin.from("request_site_files").update({ imported_at: new Date().toISOString(), import_error: null }).eq("id", f.id);
      resultat.importes += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : "erreur inconnue";
      console.error("[media] import d'un fichier du site échoué", f.id, message);
      await admin.from("request_site_files").update({ import_attempts: (f.import_attempts ?? 0) + 1, import_error: message.slice(0, 500) }).eq("id", f.id);
      resultat.echecs += 1;
      resultat.restants = true;
      break;
    }
  }
  return resultat;
}
