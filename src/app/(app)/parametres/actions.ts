"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, requirePlatformAdmin } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const newUserSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  role: z.enum([
    "client",
    "commercial",
    "infographiste",
    "responsable_production",
    "chef_section",
    "administrateur",
    "gestionnaire_stock",
  ]),
  // `nullish()` et pas `optional()` : le formulaire n'affiche l'entreprise et
  // le contact que pour un compte client, et la section que pour un chef de
  // section. Les champs non affichés ne sont pas dans le FormData, et
  // `formData.get()` renvoie alors `null` — que `optional()` (qui n'accepte
  // qu'`undefined`) rejetait. Chaque rôle laissait donc au moins un de ces
  // trois champs à `null`, et aucune création de compte ne pouvait aboutir.
  company_id: z.string().uuid().or(z.literal("")).nullish(),
  section_id: z.string().uuid().or(z.literal("")).nullish(),
  contact_id: z.string().uuid().or(z.literal("")).nullish(),
});

/**
 * Création de compte utilisateur — réservée à l'administrateur de
 * plateforme (l'informatique), pas à un rôle qui hérite seulement de son
 * cloisonnement de données.
 * `requirePlatformAdmin` s'exécute AVANT tout usage du client admin
 * (service_role) :
 * on ne construit jamais ce client privilégié pour un appelant non vérifié.
 */
export async function createUserAccount(formData: FormData) {
  await requirePlatformAdmin();

  const parsed = newUserSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    company_id: formData.get("company_id"),
    section_id: formData.get("section_id"),
    contact_id: formData.get("contact_id"),
  });
  if (!parsed.success) {
    // Le champ fautif dans le message : « Invalid input » seul ne dit pas
    // lequel des six champs a été refusé, et c'est exactement ce qui a rendu
    // cette panne difficile à lire.
    const issue = parsed.error.issues[0];
    return { error: issue ? `${issue.path.join(".") || "Saisie"} : ${issue.message}` : "Saisie invalide" };
  }

  if (parsed.data.role === "client" && !parsed.data.company_id) {
    return { error: "Une entreprise est requise pour un compte client" };
  }
  // (v4) Un compte client représente désormais une vraie fiche contact CRM,
  // pas seulement l'entreprise — cf. addendum v4 de l'analyse fonctionnelle.
  if (parsed.data.role === "client" && !parsed.data.contact_id) {
    return { error: "Un contact (fiche CRM) est requis pour un compte client — créez-le d'abord depuis Clients." };
  }
  if (parsed.data.role === "chef_section" && !parsed.data.section_id) {
    return { error: "Une section est requise pour un chef de section" };
  }

  const admin = createAdminClient();
  const tempPassword = crypto.randomUUID().slice(0, 12) + "Aa1!";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name },
  });
  if (createError) return { error: createError.message };

  // `app_users.role` reste écrit ici directement (compatibilité avec le
  // flux de création existant) ; le trigger `trg_sync_app_user_role`
  // n'intervient que lorsqu'on écrit `role_id` — voir la page Rôles &
  // permissions pour réattribuer un rôle personnalisé après création.
  const { data: roleRow } = await admin.from("roles").select("id").eq("key", parsed.data.role).single();

  const { error: profileError } = await admin.from("app_users").insert({
    id: created.user.id,
    email: parsed.data.email,
    full_name: parsed.data.full_name,
    role: parsed.data.role,
    role_id: roleRow?.id,
    company_id: parsed.data.company_id || null,
    section_id: parsed.data.section_id || null,
    contact_id: parsed.data.contact_id || null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { error: profileError.message };
  }

  revalidatePath("/parametres/utilisateurs");
  return { tempPassword, email: parsed.data.email };
}

export async function toggleUserActive(userId: string, active: boolean) {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ active }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/utilisateurs");
  return {};
}

/**
 * Réattribue le rôle d'un compte existant. Passe par le client service_role :
 * depuis la migration 0026, `app_users.role_id` n'est plus modifiable par un
 * compte authentifié, quel qu'il soit — c'était la porte d'une auto-promotion
 * en administrateur. Le trigger `trg_sync_app_user_role` recopie ensuite le
 * base_role du rôle choisi dans `app_users.role`, dont dépend toute la RLS.
 *
 * Deux garde-fous : les contraintes métier de `app_users` (un compte client
 * a une entreprise, un chef de section a une section) sont vérifiées avant
 * l'écriture pour rendre un message lisible plutôt qu'une erreur Postgres, et
 * le dernier administrateur de plateforme actif ne peut pas se retirer
 * lui-même le rôle — sans quoi plus personne ne pourrait le rendre.
 */
export async function setUserRole(userId: string, roleId: string) {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const [{ data: user }, { data: role }] = await Promise.all([
    admin.from("app_users").select("id,role_id,company_id,section_id,active").eq("id", userId).single(),
    admin.from("roles").select("id,key,label,base_role,active").eq("id", roleId).single(),
  ]);
  if (!user) return { error: "Compte introuvable." };
  if (!role) return { error: "Rôle introuvable." };
  if (!role.active) return { error: `Le rôle « ${role.label} » est désactivé.` };
  if (user.role_id === roleId) return {};

  if (role.base_role === "client" && !user.company_id) {
    return { error: "Un compte client doit être rattaché à une entreprise : modifiez d'abord son rattachement." };
  }
  if (role.base_role === "chef_section" && !user.section_id) {
    return { error: "Un chef de section doit être rattaché à une section : modifiez d'abord son rattachement." };
  }

  const { data: previous } = await admin.from("roles").select("key").eq("id", user.role_id).single();
  if (previous?.key === "administrateur" && role.key !== "administrateur") {
    const { count } = await admin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .eq("role_id", user.role_id)
      .eq("active", true);
    if ((count ?? 0) <= 1) {
      return {
        error:
          "C'est le dernier administrateur actif : attribuez d'abord ce rôle à un autre compte, sinon plus personne ne pourra accéder aux réglages.",
      };
    }
  }

  const { error } = await admin.from("app_users").update({ role_id: roleId }).eq("id", userId);
  if (error) return { error: error.message };

  revalidatePath("/parametres/utilisateurs");
  revalidatePath("/parametres/roles");
  return {};
}

const newSectionSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function createSection(formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = newSectionSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: max } = await supabase
    .from("sections")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .single();

  const { error } = await supabase.from("sections").insert({
    name: parsed.data.name,
    description: parsed.data.description || null,
    display_order: (max?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

export async function toggleSectionActive(sectionId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sections").update({ active }).eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/sections");
  return {};
}

// ============================================================================
// Lot 9 — configurateur couleur par zone : palette de couleurs et modèles de
// produit / gabarit de zones (section 8/9 du document de logique).
// ============================================================================

const newColorSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
});

/** Palette de couleurs de référence (section 9) — réservée à responsable_production/administrateur. */
export async function createColor(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newColorSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("colors").insert({
    name: parsed.data.name.trim(),
    code: parsed.data.code.trim(),
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}

export async function toggleColorActive(colorId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("colors").update({ active }).eq("id", colorId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}

// ============================================================================
// Référentiel de tailles (migration 0029)
// ============================================================================

const newSizeSchema = z.object({
  groupe: z.string().trim().min(1, "Indiquez un groupe (Homme, Femme, Enfant…)"),
  libelle: z.string().trim().min(1, "Indiquez un libellé de taille"),
  display_order: z.coerce.number().int().min(0).default(0),
});

/**
 * Ajoute une taille au référentiel. `cle` est générée en base (« Groupe/
 * Libellé ») : c'est elle que stockent les ODF et les répartitions du
 * patronnage, jamais le libellé seul — un « M » homme et un « M » femme sont
 * deux tailles distinctes.
 *
 * `display_order` est demandé explicitement parce qu'une grille de tailles ne
 * s'ordonne ni alphabétiquement ni numériquement : XS < S < M < L < XL.
 */
export async function createSize(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newSizeSchema.safeParse({
    groupe: formData.get("groupe"),
    libelle: formData.get("libelle"),
    display_order: formData.get("display_order") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("sizes").insert({
    groupe: parsed.data.groupe,
    libelle: parsed.data.libelle,
    display_order: parsed.data.display_order,
  });
  if (error) {
    if (error.code === "23505") return { error: `La taille « ${parsed.data.groupe}/${parsed.data.libelle} » existe déjà.` };
    return { error: error.message };
  }

  revalidatePath("/parametres/couleurs");
  return {};
}

export async function toggleSizeActive(sizeId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sizes").update({ active }).eq("id", sizeId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/couleurs");
  return {};
}

/**
 * Disponibilité d'un modèle : remplace intégralement la liste des tailles ou
 * des couleurs proposables. Une liste vide signifie « aucune restriction
 * déclarée » — tout le référentiel actif reste proposable — et non « rien
 * n'est disponible » : sans cette convention, activer le référentiel rendrait
 * d'un coup tous les modèles existants incomplets.
 */
export async function setProductModelSizes(productModelId: string, sizeIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("product_model_sizes")
    .delete()
    .eq("product_model_id", productModelId);
  if (delError) return { error: delError.message };

  if (sizeIds.length > 0) {
    const { error } = await supabase
      .from("product_model_sizes")
      .insert(sizeIds.map((size_id) => ({ product_model_id: productModelId, size_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/parametres/produits");
  return {};
}

export async function setProductModelColors(productModelId: string, colorIds: string[]) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();

  const { error: delError } = await supabase
    .from("product_model_colors")
    .delete()
    .eq("product_model_id", productModelId);
  if (delError) return { error: delError.message };

  if (colorIds.length > 0) {
    const { error } = await supabase
      .from("product_model_colors")
      .insert(colorIds.map((color_id) => ({ product_model_id: productModelId, color_id })));
    if (error) return { error: error.message };
  }

  revalidatePath("/parametres/produits");
  return {};
}

const newProductModelSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
});

/**
 * Modèles de produit — aucune page de gestion n'existait avant ce lot
 * (product_models n'était consommé qu'en lecture, pour les devis et le
 * catalogue Sage). Nécessaire ici pour rattacher un gabarit de zones.
 */
export async function createProductModel(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newProductModelSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("product_models").insert({
    name: parsed.data.name.trim(),
    category: parsed.data.category?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

export async function toggleProductModelActive(productModelId: string, active: boolean) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_models").update({ active }).eq("id", productModelId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

/**
 * Lot 10 : référence Sage d'un modèle de produit — colonne présente depuis
 * la migration 0005 mais jamais éditable depuis l'application jusqu'ici.
 * Nécessaire pour que les mouvements de stock entree_semi_fini/entree_fini
 * (migration 0020) portent une référence exploitable par Sage.
 */
export async function setProductModelSageReference(productModelId: string, sageReference: string) {
  await requireRole(["administrateur", "responsable_production"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_models")
    .update({ sage_reference: sageReference.trim() || null })
    .eq("id", productModelId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

const newZoneSchema = z.object({
  product_model_id: z.string().uuid(),
  zone_key: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9_]+$/, "Clé de zone : minuscules, chiffres et underscores uniquement"),
  zone_label: z.string().trim().min(1),
});

/** Ajoute une zone au gabarit d'un modèle de produit (section 8) — placée après les zones existantes. */
export async function addProductZoneTemplate(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newZoneSchema.safeParse({
    product_model_id: formData.get("product_model_id"),
    zone_key: formData.get("zone_key"),
    zone_label: formData.get("zone_label"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("product_zone_templates")
    .select("display_order")
    .eq("product_model_id", parsed.data.product_model_id)
    .order("display_order", { ascending: false })
    .limit(1);

  const { error } = await supabase.from("product_zone_templates").insert({
    product_model_id: parsed.data.product_model_id,
    zone_key: parsed.data.zone_key,
    zone_label: parsed.data.zone_label,
    display_order: (existing?.[0]?.display_order ?? 0) + 1,
  });
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

/** Retire une zone du gabarit — réservé à l'administrateur (cohérent avec product_zone_templates_delete). */
export async function removeProductZoneTemplate(zoneTemplateId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("product_zone_templates").delete().eq("id", zoneTemplateId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

// Lot 12 — nomenclature (fournitures constantes).

const newNomenclatureLineSchema = z.object({
  product_model_id: z.string().uuid(),
  designation: z.string().trim().min(1),
  quantite_par_piece: z.coerce.number().positive(),
  unite: z.string().trim().min(1),
});

/** Ajoute une ligne de nomenclature (composant constant hors tissu) à un modèle de produit. */
export async function addNomenclatureLine(formData: FormData) {
  await requireRole(["administrateur", "responsable_production"]);
  const parsed = newNomenclatureLineSchema.safeParse({
    product_model_id: formData.get("product_model_id"),
    designation: formData.get("designation"),
    quantite_par_piece: formData.get("quantite_par_piece"),
    unite: formData.get("unite"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.from("nomenclature_lines").insert(parsed.data);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

/** Retire une ligne de nomenclature — réservé à l'administrateur (cohérent avec nomenclature_lines_delete). */
export async function removeNomenclatureLine(lineId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("nomenclature_lines").delete().eq("id", lineId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/produits");
  return {};
}

/**
 * Simule un cycle de synchronisation du miroir de stock Sage (section 7.1b).
 * En production, ce serait un job planifié utilisant un compte technique
 * Sage à droits lecture seule — jamais déclenché depuis une session
 * utilisateur normale. Conservé ici en lecture/démo uniquement, réservé à
 * l'administrateur, pour illustrer le mécanisme sans connecter un vrai Sage.
 */
export async function simulateStockSync() {
  await requireRole(["administrateur"]);
  // stock_item_view n'a volontairement AUCUNE policy d'écriture pour les
  // rôles applicatifs (cf. 0002_rls.sql) : seul un job technique via
  // service_role peut y écrire, jamais une session utilisateur normale même
  // administrateur. On utilise donc le client admin ici, uniquement après
  // vérification du rôle ci-dessus, pour simuler ce job de synchronisation.
  const admin = createAdminClient();
  const { data: items } = await admin.from("stock_item_view").select("sage_reference,quantity_available");

  for (const item of items ?? []) {
    const delta = Math.round((Math.random() - 0.5) * 20 * 10) / 10;
    await admin
      .from("stock_item_view")
      .update({
        quantity_available: Math.max(0, item.quantity_available + delta),
        last_sync_at: new Date().toISOString(),
      })
      .eq("sage_reference", item.sage_reference);
  }
  revalidatePath("/parametres/stock");
  return {};
}
