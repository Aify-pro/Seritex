"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/permissions";
import { CODE_SEGMENTS, CODING_NATURE_RULES, type CodingNature } from "@/lib/articles/codification";

/**
 * Paramètres > Codification (COM-0) : règle de code, codes courts des
 * référentiels, dépôt Sage par nature. La RLS fait foi (réglage : admin ;
 * référentiels : production / droit articles ; dépôts : admin, gestion de stock).
 */
function done() {
  revalidatePath("/parametres/codification");
  revalidatePath("/articles", "layout");
}

const settingsSchema = z.object({
  segments: z.array(z.enum(CODE_SEGMENTS)).min(1),
  longueurMax: z.number().int().min(8).max(40),
  separateur: z.string().max(1),
});

/** Règle de codification d'une nature d'article (migration 0102) : produits finis, tissus ou consommables. */
export async function saveCodingRule(nature: CodingNature, input: z.infer<typeof settingsSchema>) {
  await requirePermission("codification", "modify");
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const rule = CODING_NATURE_RULES[nature];
  if (!rule) return { error: "Nature inconnue." };
  if (new Set(parsed.data.segments).size !== parsed.data.segments.length) return { error: "Un segment apparaît deux fois." };
  if (parsed.data.segments.some((s) => !rule.segments.includes(s))) return { error: "Segment non prévu pour cette nature." };
  const missing = rule.required.find((s) => !parsed.data.segments.includes(s));
  if (missing) return { error: `Le segment « ${missing} » est obligatoire.` };
  const supabase = await createClient();
  const { error, data } = await supabase
    .from("coding_rules")
    .update({
      segments: parsed.data.segments,
      longueur_max: parsed.data.longueurMax,
      separateur: parsed.data.separateur,
      updated_at: new Date().toISOString(),
    })
    .eq("nature", nature)
    .select("nature");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Réglage réservé à l'administration." };
  done();
  return {};
}

const SHORT_CODE_TABLES = {
  product_categories: { column: "code_court", max: 4 },
  matieres: { column: "code_court", max: 4 },
  textiles: { column: "code_court", max: 5 },
  colors: { column: "code_court", max: 4 },
  sizes: { column: "code_court", max: 4 },
  // Préfixe du code consommable (CO + famille + n°, migration 0087) : exactement 2 caractères.
  consumable_families: { column: "code_court", max: 2, min: 2 },
} as const;

/**
 * Code court d'une ligne de référentiel. Changer un code court ne modifie
 * pas les codes déjà attribués (figés) : il ne vaut que pour les prochaines
 * déclinaisons.
 */
export async function updateShortCode(table: keyof typeof SHORT_CODE_TABLES, id: string, value: string) {
  await requirePermission("articles", "modify");
  const spec = SHORT_CODE_TABLES[table];
  if (!spec) return { error: "Référentiel inconnu." };
  const code = value.trim().toUpperCase();
  const min = "min" in spec ? spec.min : 1;
  if (!new RegExp(`^[A-Z0-9]{${min},${spec.max}}$`).test(code)) {
    return { error: min === spec.max ? `Code court : exactement ${spec.max} lettres ou chiffres.` : `Code court : 1 à ${spec.max} lettres ou chiffres, sans espace.` };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from(table).update({ [spec.column]: code }).eq("id", id).select("id");
  if (error) return { error: error.code === "23505" ? `Le code ${code} est déjà utilisé.` : error.message };
  if (!data?.length) return { error: "Modification refusée." };
  done();
  return {};
}

const namedSchema = z.object({
  nom: z.string().trim().min(1, "Nom manquant").max(80),
  code_court: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,4}$/, "Code court : 1 à 4 lettres ou chiffres"),
});

export async function createNamedReferential(table: "product_categories" | "matieres" | "consumable_families", formData: FormData) {
  await requirePermission("articles", "modify");
  const parsed = namedSchema.safeParse({ nom: formData.get("nom"), code_court: formData.get("code_court") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (table === "consumable_families" && parsed.data.code_court.length !== 2) {
    return { error: "Code d'une famille de consommables : exactement 2 lettres ou chiffres." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(parsed.data);
  if (error) {
    if (error.code === "23505") return { error: "Ce nom ou ce code court existe déjà." };
    if (error.code === "42501") return { error: "Ajout réservé à l'administration." };
    return { error: error.message };
  }
  done();
  return {};
}

/** Matière d'un textile (un textile = une matière dans un grammage). */
export async function setTextileMatiere(textileId: string, matiereId: string | null) {
  await requirePermission("articles", "modify");
  const supabase = await createClient();
  const { error } = await supabase.from("textiles").update({ matiere_id: matiereId }).eq("id", textileId);
  if (error) return { error: error.message };
  done();
  return {};
}

/** Dépôt Sage pré-rempli à l'export pour une nature (D5). */
export async function setSageDepot(nature: string, depot: string) {
  await requirePermission("stock_atelier", "modify");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sage_depot_by_nature")
    .update({ depot: depot.trim() || null, updated_at: new Date().toISOString() })
    .eq("nature", nature)
    .select("nature");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Modification refusée." };
  done();
  revalidatePath("/atelier/stock");
  return {};
}
