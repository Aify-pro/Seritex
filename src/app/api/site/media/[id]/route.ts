import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMediaFileContent } from "@/lib/media/preview";

/**
 * Téléchargement d'un fichier de la médiathèque par un compte CLIENT, depuis l'espace client du
 * site (www.seritex.ci). Le site ne détient pas les identifiants du NAS : il transmet le jeton du
 * client (Authorization: Bearer) et la plateforme relaie le fichier.
 *
 * Garde-fous :
 *  - le jeton doit être valide ET appartenir à un compte de rôle « client » ;
 *  - l'accès au fichier est prouvé AVEC LA SESSION DU CLIENT (RLS de `media_files` : sa société
 *    seulement) ; ce n'est qu'ensuite que le contenu est lu avec le client d'administration
 *    (un compte client ne lit pas `storage_targets`) ;
 *  - le fichier n'est JAMAIS affiché dans la page : téléchargement forcé, type non deviné, sandbox
 *    (un fichier déposé par un client ne doit pas pouvoir exécuter de script sur l'origine du site).
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refus = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jeton = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!jeton) return refus(401, "Non authentifié");
  if (!UUID.test(id)) return refus(404, "Fichier introuvable");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return refus(503, "Service indisponible");

  const db = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jeton}` } },
  });
  const { data: auth } = await db.auth.getUser(jeton);
  if (!auth.user) return refus(401, "Session invalide");

  const { data: profil } = await db.from("app_users").select("role").eq("id", auth.user.id).maybeSingle();
  if (profil?.role !== "client") return refus(403, "Réservé aux comptes client");

  const { data: media } = await db.from("media_files").select("id,file_name,mime_type").eq("id", id).maybeSingle();
  if (!media) return refus(404, "Fichier introuvable");

  const content = await getMediaFileContent(id, createAdminClient());
  if (!content) return refus(502, "Fichier indisponible pour le moment");

  return new NextResponse(new Uint8Array(content.buffer), {
    headers: {
      "Content-Type": content.mimeType ?? media.mime_type ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(media.file_name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
