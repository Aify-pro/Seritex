import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "./current-user";
import type { PermissionAction } from "@/lib/types/domain";

export type PermissionRow = Record<PermissionAction, boolean>;
export type PermissionMap = Record<string, PermissionRow>;

const EMPTY_PERMISSIONS: PermissionRow = {
  view: false,
  create: false,
  modify: false,
  archive: false,
  delete: false,
};

/**
 * Charge, une seule fois par requête serveur (mise en cache via `cache()` de
 * React — pas de traversée réseau répétée d'une page à l'autre du même
 * rendu), la matrice de permissions du RÔLE de l'utilisateur courant :
 * `{ [module_key]: { view, create, modify, archive, delete } }`.
 *
 * Source pour l'affichage uniquement (montrer/masquer un bouton, un onglet
 * de menu) — jamais la seule porte d'une action sensible : la suppression
 * d'un fichier médiathèque et l'archivage d'un ordre de fabrication
 * re-vérifient `has_permission()` côté Postgres (fonctions SECURITY
 * DEFINER, 0005_rbac_crm_parametres_sage.sql) avant d'agir, exactement comme
 * le reste de l'application ne fait jamais confiance à l'UI seule pour les
 * autorisations (cf. current-user.ts).
 */
export const getPermissionMap = cache(async (): Promise<PermissionMap> => {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("role_permissions")
    .select("can_view,can_create,can_modify,can_archive,can_delete,modules(key)");

  if (error || !data) return {};

  const map: PermissionMap = {};
  for (const row of data as unknown as {
    can_view: boolean;
    can_create: boolean;
    can_modify: boolean;
    can_archive: boolean;
    can_delete: boolean;
    modules: { key: string } | null;
  }[]) {
    const key = row.modules?.key;
    if (!key) continue;
    map[key] = {
      view: row.can_view,
      create: row.can_create,
      modify: row.can_modify,
      archive: row.can_archive,
      delete: row.can_delete,
    };
  }
  return map;
});

/** Raccourci pratique : `await can("mediatheque", "delete")`. */
export async function can(moduleKey: string, action: PermissionAction): Promise<boolean> {
  const map = await getPermissionMap();
  return map[moduleKey]?.[action] ?? EMPTY_PERMISSIONS[action];
}
