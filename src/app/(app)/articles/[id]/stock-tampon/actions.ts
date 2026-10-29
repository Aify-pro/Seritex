"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Réorientation d'un paquet de pièces (étape 4b, migration 0153, S48) : vers
 * une autre ligne d'ODF qui a besoin du même semi-fini, dans la même couleur et
 * le même tissu, avant verrou et dans la limite des pièces pas encore
 * assemblées. Les contrôles sont dans la base (reorienter_paquet).
 */

export interface LigneCompatible {
  lineId: string;
  odf: string;
  article: string;
  couleur: string | null;
  reste: number;
}

export async function lignesCompatibles(code: string): Promise<LigneCompatible[] | { error: string }> {
  await requirePermission("ordres_fabrication", "view");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lignes_compatibles_paquet", { p_code: code });
  if (error) return { error: error.message };
  return ((data ?? []) as { line_id: string; odf: string; article: string; couleur: string | null; reste: number }[]).map((r) => ({
    lineId: r.line_id,
    odf: r.odf,
    article: r.article,
    couleur: r.couleur,
    reste: Number(r.reste),
  }));
}

export async function reorienterPaquet(
  code: string,
  lineCible: string,
  composition: Record<string, number>,
  motif: string,
  semiFiniId: string
): Promise<{ error?: string; code?: string }> {
  await requirePermission("ordres_fabrication", "modify");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reorienter_paquet", {
    p_code: code,
    p_line_cible: lineCible,
    p_composition: composition,
    p_motif: motif.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath(`/articles/${semiFiniId}/stock-tampon`);
  revalidatePath("/atelier/section");
  return { code: (data as { code: string } | null)?.code };
}
