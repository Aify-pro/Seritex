import { timingSafeEqual } from "node:crypto";
import { runFreetrackSync } from "@/lib/vehicules/freetrack-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Synchronisation FreeTrack (VEH-5) : positions, trajets et arrêts, alertes,
 * rapprochement des pleins. Appelée toutes les 5 minutes par la base (pg_cron
 * + pg_net, migration 0173) avec `Authorization: Bearer <CRON_SECRET>` ; la
 * fréquence réelle est celle réglée dans Paramètres. Route publique pour le
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
    const result = await runFreetrackSync();
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    console.error("[freetrack] synchronisation échouée", e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
