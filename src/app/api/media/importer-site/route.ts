import { timingSafeEqual } from "node:crypto";
import { importerFichiersSite } from "@/lib/media/importer-site";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Copie dans la médiathèque du client (et sur le NAS) les fichiers envoyés par le site : logos, maquette
 * PDF, image de la maquette (migration 0136). Appelé chaque minute par la base (pg_cron + pg_net, voir
 * supabase/ops/planifier-import-fichiers-site.sql) avec `Authorization: Bearer <CRON_SECRET>`, comme la file
 * des notifications. Route publique pour le proxy d'authentification (pas de session) : le secret fait foi.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, message: "CRON_SECRET non configuré." }, { status: 503 });
  const fourni = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(fourni);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ ok: false }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await importerFichiersSite()) });
  } catch (e) {
    console.error("[media] import des fichiers du site échoué", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
