import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { traiterCalculsImbrication } from "@/lib/imbrication/calculs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Traite les calculs d'imbrication en attente (migration 0182), par tranches.
 * Appelée juste après la création d'un calcul, puis chaque minute par la
 * base (pg_cron + pg_net, tâche « imbrication-traiter ») avec
 * `Authorization: Bearer <CRON_SECRET>`. Route publique pour le proxy
 * d'authentification (pas de session) : le secret fait foi.
 *
 * Répond tout de suite (202) et calcule après la réponse, jusqu'à la durée
 * maximale de la fonction : l'appelant n'attend jamais la fin du calcul.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok: false, message: "CRON_SECRET non configuré." }, { status: 503 });
  const fourni = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(fourni);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ ok: false }, { status: 401 });

  after(async () => {
    try {
      const { traites } = await traiterCalculsImbrication(maxDuration);
      if (traites.length > 0) console.log(`[imbrication] ${traites.length} tranche(s) traitée(s)`);
    } catch (e) {
      console.error("[imbrication] traitement des calculs échoué", e);
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}
