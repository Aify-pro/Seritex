import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import type { ModuleRecord, RolePermissionRecord, RoleRecord } from "@/lib/types/domain";
import { RoleManager } from "./role-manager";

export default async function RolesPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [{ data: roles }, { data: modules }, { data: permissions }, { data: usersByRole }] = await Promise.all([
    supabase.from("roles").select("*").order("created_at"),
    supabase.from("modules").select("*").order("display_order"),
    supabase.from("role_permissions").select("*"),
    supabase.from("app_users").select("role_id"),
  ]);

  const userCountByRole = new Map<string, number>();
  for (const u of usersByRole ?? []) {
    userCountByRole.set(u.role_id, (userCountByRole.get(u.role_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rôles & permissions"
        description="Pour chaque rôle, deux groupes : les modules (écrans de travail) et les paramètres. « Voir » ouvre l'écran et l'affiche dans le menu ; les autres colonnes règlent ce que le rôle peut y faire. Appliqué immédiatement."
      />
      <RoleManager
        roles={(roles ?? []) as RoleRecord[]}
        modules={(modules ?? []) as ModuleRecord[]}
        permissions={(permissions ?? []) as RolePermissionRecord[]}
        userCountByRole={Object.fromEntries(userCountByRole)}
      />
    </div>
  );
}
