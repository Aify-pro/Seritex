"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { CODE_SEGMENTS } from "@/lib/articles/codification";

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
  segments: z.array(z.enum(CODE_SEGMENTS)).min(1).refine((s) => s.includes("modele"), "Le segment Modèle est obligatoire"),
  longueurMax: z.number().int().min(8).max(40),
  separateur: z.string().max(1),
});

export async function saveCodingSettings(input: z.infer<typeof settingsSchema>) {
  await requireRole(["administrateur"]);
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (new Set(parsed.data.segments).size !== parsed.data.segments.length) return { error: "Un segment apparaît deux fois." };
  const supabase = await createClient();
  const { error, data } = await supabase
    .from("coding_settings")
    .update({
      segments: parsed.data.segments,
      longueur_max: parsed.data.longueurMax,
      separateur: parsed.data.separateur,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("id");
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
} as const;

/**
 * Code court d'une ligne de référentiel. Changer un code court ne modifie
 * pas les codes déjà attribués (figés) : il ne vaut que pour les prochaines
 * déclinaisons.
 */
export async function updateShortCode(table: keyof typeof SHORT_CODE_TABLES, id: string, value: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const spec = SHORT_CODE_TABLES[table];
  if (!spec) return { error: "Référentiel inconnu." };
  const code = value.trim().toUpperCase();
  if (!new RegExp(`^[A-Z0-9]{1,${spec.max}}$`).test(code)) {
    return { error: `Code court : 1 à ${spec.max} lettres ou chiffres, sans espace.` };
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

export async function createNamedReferential(table: "product_categories" | "matieres", formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = namedSchema.safeParse({ nom: formData.get("nom"), code_court: formData.get("code_court") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert(parsed.data);
  if (error) return { error: error.code === "23505" ? "Ce nom ou ce code court existe déjà." : error.message };
  done();
  return {};
}

/** Matière d'un textile (un textile = une matière dans un grammage). */
export async function setTextileMatiere(textileId: string, matiereId: string | null) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("textiles").update({ matiere_id: matiereId }).eq("id", textileId);
  if (error) return { error: error.message };
  done();
  return {};
}

/** Dépôt Sage pré-rempli à l'export pour une nature (D5). */
export async function setSageDepot(nature: string, depot: string) {
  await requireRole(["administrateur", "gestionnaire_stock"]);
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
