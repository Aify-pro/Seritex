import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readTraceFile } from "@/lib/storage/patronnage-files";

/**
 * Téléchargement du DXF tel que déposé — sans aucune transformation. Pour le
 * DXF marqué (texte sur les pièces + cartouche QR), voir `dxf-marque/route.ts`.
 *
 * Aucune vérification de permission explicite ici : l'autorisation réelle
 * vit dans la RLS de `traces_placement` (policy `traces_placement_select`,
 * `has_permission('patronnage','view')`) — même convention que les autres
 * téléchargements de fichiers de l'app (ex. `/api/production/[id]/pdf`).
 * Un utilisateur non autorisé obtient donc un « introuvable », jamais le
 * fichier d'un autre dossier.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { data: trace } = await supabase
    .from("traces_placement")
    .select("fichier_path,fichier_nom,reference")
    .eq("id", id)
    .maybeSingle();
  if (!trace?.fichier_path) return NextResponse.json({ error: "Aucun fichier déposé pour ce tracé." }, { status: 404 });

  const buffer = await readTraceFile(trace.fichier_path);
  if (!buffer) return NextResponse.json({ error: "Impossible de relire le fichier déposé." }, { status: 404 });

  const nomFichier = ((trace.fichier_nom as string | null) || `${trace.reference}.dxf`).replace(/"/g, "");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${nomFichier}"`,
    },
  });
}
