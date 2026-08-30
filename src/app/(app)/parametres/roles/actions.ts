"use server";

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/current-user";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PermissionAction, UserRole } from "@/lib/types/domain";

const BASE_ROLES: UserRole[] = [
  "client",
  "commercial",
  "infographiste",
  "responsable_production",
  "chef_section",
  "administrateur",
];

const newRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Utilisez uniquement des minuscules, chiffres et underscores"),
  label: z.string().min(1),
  description: z.string().optional(),
  base_role: z.enum(BASE_ROLES as [UserRole, ...UserRole[]]),
});

/**
 * Crée un rôle métier dérivé (ex. "Assistant commercial"). `base_role`
 * détermine le cloisonnement RLS hérité (entreprise/section) — les droits
 * d'action fins (Création/Modification/Archivage/Suppression par module)
 * démarrent tous à faux et se règlent ensuite depuis la matrice ci-dessous.
 */
export async function createRole(formData: FormData) {
  await requireRole(["administrateur"]);
  const parsed = newRoleSchema.safeParse({
    key: formData.get("key"),
    label: formData.get("label"),
    description: formData.get("description"),
    base_role: formData.get("base_role"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();

  const { data: role, error } = await supabase
    .from("roles")
    .insert({
      key: parsed.data.key,
      label: parsed.data.label,
      description: parsed.data.description || null,
      base_role: parsed.data.base_role,
      is_system: false,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const { data: modules } = await supabase.from("modules").select("id");
  if (modules?.length) {
    await supabase.from("role_permissions").insert(
      modules.map((m) => ({ role_id: role.id, module_id: m.id }))
    );
  }

  revalidatePath("/parametres/roles");
  return {};
}

export async function toggleRoleActive(roleId: string, active: boolean) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("roles").update({ active }).eq("id", roleId);
  if (error) return { error: error.message };
  revalidatePath("/parametres/roles");
  return {};
}

/**
 * Supprime un rôle personnalisé. Bloqué en base pour les rôles système
 * (policy RLS `is_system = false`) et pour tout rôle encore porté par un
 * compte utilisateur (contrainte de clé étrangère `app_users.role_id`) —
 * l'erreur Postgres est traduite en message compréhensible.
 */
export async function deleteRole(roleId: string) {
  await requireRole(["administrateur"]);
  const supabase = await createClient();
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) {
    if (error.code === "23503") {
      return { error: "Ce rôle est encore attribué à au moins un utilisateur : réattribuez-le d'abord." };
    }
    return { error: error.message };
  }
  revalidatePath("/parametres/roles");
  return {};
}

const COLUMN_BY_ACTION: Record<PermissionAction, string> = {
  view: "can_view",
  create: "can_create",
  modify: "can_modify",
  archive: "can_archive",
  delete: "can_delete",
};

/**
 * Bascule un droit (Voir/Créer/Modifier/Archiver/Supprimer) pour un rôle et
 * un module donnés — c'est l'unique écran qui modifie `role_permissions`,
 * lue ensuite par `has_permission()` côté Postgres pour toutes les actions
 * sensibles (suppression médiathèque, archivage d'un ordre de fabrication,
 * et les futurs modules qui adopteront la même logique).
 */
export async function setRolePermission(
  roleId: string,
  moduleId: string,
  action: PermissionAction,
  value: boolean
) {
  const { profile } = await requireRole(["administrateur"]);
  const supabase = await createClient();
  const column = COLUMN_BY_ACTION[action];

  const { error } = await supabase
    .from("role_permissions")
    .update({ [column]: value, updated_by: profile.id })
    .eq("role_id", roleId)
    .eq("module_id", moduleId);
  if (error) return { error: error.message };

  revalidatePath("/parametres/roles");
  return {};
}
