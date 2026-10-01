import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMediaFileContent } from "@/lib/media/preview";

/**
 * Relais authentifié d'un fichier de la médiathèque stocké sur le NAS. Le
 * navigateur ne parle jamais au NAS (identifiants WebDAV côté serveur
 * uniquement). L'accès est contrôlé par la RLS de `media_files` : un client
 * ne peut pas obtenir le fichier d'une autre entreprise en devinant un id.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: media } = await supabase.from("media_files").select("id,file_name").eq("id", id).maybeSingle();
  if (!media) return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });

  const content = await getMediaFileContent(id);
  if (!content) return NextResponse.json({ error: "Fichier indisponible sur le stockage" }, { status: 502 });

  return new NextResponse(new Uint8Array(content.buffer), {
    headers: {
      "Content-Type": content.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(media.file_name)}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
