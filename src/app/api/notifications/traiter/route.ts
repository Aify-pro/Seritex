import { timingSafeEqual } from "node:crypto";
import { traiterFile } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vide la file des notifications déclenchées par la base (migration 0129).
 * Appelé chaque minute par le cron Vercel (vercel.json), qui présente `Authorization: Bearer <CRON_SECRET>`.
 * Route publique pour le proxy d'authentification (pas de session) : le secret fait foi.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, message: "CRON_SECRET non configuré." }, { status: 503 });
  const fourni = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(fourni);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ ok: false }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await traiterFile()) });
  } catch (e) {
    console.error("[notifications] traitement de la file échoué", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
