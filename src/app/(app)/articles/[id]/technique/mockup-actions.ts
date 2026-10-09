"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/permissions";
import { nettoyerSvg } from "@/lib/articles/mockup-svg";
import { createClient } from "@/lib/supabase/server";

/**
 * Mockups SVG de la fiche article (migration 0121). Le SVG est nettoyé sur le
 * serveur à l'analyse ET à l'enregistrement : rien de ce que renvoie le
 * navigateur n'est stocké sans être repassé dans la liste blanche.
 */

/** Analyse un SVG déposé : version nettoyée, cadre, éléments nommés (candidats aux zones). */
export async function analyserMockup(texte: string) {
  await requirePermission("articles", "modify");
  const r = nettoyerSvg(texte);
  if (!r.ok) return { error: r.erreur };
  return { svg: r.resultat.svg, viewBox: r.resultat.viewBox, elements: r.resultat.elements };
}

const point = z.object({ x: z.number().finite(), y: z.number().finite() });
const schema = z.object({
  modelId: z.guid(),
  vue: z.enum(["avant", "dos"]),
  svg: z.string().min(1),
  zones: z.record(z.string().min(1).max(200), z.string().min(1).max(100)),
  largeurCm: z.number().positive("Indiquez la largeur réelle du vêtement").max(200),
  cadre: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() }),
  reperes: z.record(z.guid(), point),
});

export async function enregistrerMockup(input: z.infer<typeof schema>) {
  await requirePermission("articles", "modify");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Mockup invalide" };
  const m = parsed.data;
  if (!Object.values(m.zones).some((v) => v !== "__contour")) {
    return { error: "Associez au moins un élément du SVG à une zone de couleur." };
  }
  const propre = nettoyerSvg(m.svg);
  if (!propre.ok) return { error: propre.erreur };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_product_model_mockup", {
    p_model_id: m.modelId,
    p_vue: m.vue,
    p_svg: propre.resultat.svg,
    p_zones: m.zones,
    p_largeur_cm: m.largeurCm,
    p_cadre: m.cadre,
    p_reperes: m.reperes,
  });
  if (error) return { error: error.message };
  revalidatePath(`/articles/${m.modelId}/technique`);
  return {};
}

export async function supprimerMockup(modelId: string, vue: "avant" | "dos") {
  await requirePermission("articles", "modify");
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_product_model_mockup", { p_model_id: modelId, p_vue: vue });
  if (error) return { error: error.message };
  revalidatePath(`/articles/${modelId}/technique`);
  return {};
}
