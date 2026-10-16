import { timingSafeEqual } from "node:crypto";
import { viderTampon } from "@/lib/storage/tampon";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Déplace les fichiers du tampon vers le stockage (NAS) dès qu'il est de nouveau joignable.
 * Appelé par la base (pg_cron + pg_net, voir supabase/ops/planifier-tampon-mediatheque.sql) avec
 * `Authorization: Bearer <CRON_SECRET>`, comme la file des notifications. Route publique pour le
 * proxy d'authentification (pas de session) : le secret fait foi.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, message: "CRON_SECRET non configuré." }, { status: 503 });
  const fourni = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(fourni);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ ok: false }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await viderTampon()) });
  } catch (e) {
    console.error("[tampon] vidage échoué", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
