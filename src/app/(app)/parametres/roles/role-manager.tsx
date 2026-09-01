"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createRole, deleteRole, setRolePermission, toggleRoleActive } from "./actions";
import {
  PERMISSION_ACTION_LABELS,
  ROLE_LABELS,
  type ModuleRecord,
  type PermissionAction,
  type RolePermissionRecord,
  type RoleRecord,
  type UserRole,
} from "@/lib/types/domain";
import { Plus, Trash2, Lock } from "lucide-react";

const ACTIONS: PermissionAction[] = ["view", "create", "modify", "archive", "delete", "validate", "unlock"];
const BASE_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

export function RoleManager({
  roles,
  modules,
  permissions,
  userCountByRole,
}: {
  roles: RoleRecord[];
  modules: ModuleRecord[];
  permissions: RolePermissionRecord[];
  userCountByRole: Record<string, number>;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id);
  const [localRoles, setLocalRoles] = useState(roles);
  const [pending, startTransition] = useTransition();
  const [showNewRole, setShowNewRole] = useState(false);

  const selectedRole = localRoles.find((r) => r.id === selectedRoleId);

  // Index rapide : role_id -> module_id -> ligne de permissions
  const permByRoleModule = new Map<string, RolePermissionRecord>();
  for (const p of permissions) permByRoleModule.set(`${p.role_id}:${p.module_id}`, p);

  const [localPerms, setLocalPerms] = useState(permByRoleModule);

  function togglePermission(moduleId: string, action: PermissionAction, next: boolean) {
    if (!selectedRoleId) return;
    const key = `${selectedRoleId}:${moduleId}`;
    const current = localPerms.get(key);
    if (!current) return;
    const column = { view: "can_view", create: "can_create", modify: "can_modify", archive: "can_archive", delete: "can_delete", validate: "can_validate", unlock: "can_unlock" }[action] as
      | "can_view"
      | "can_create"
      | "can_modify"
      | "can_archive"
      | "can_delete"
      | "can_validate"
      | "can_unlock";
    setLocalPerms(new Map(localPerms).set(key, { ...current, [column]: next }));
    startTransition(async () => {
      const res = await setRolePermission(selectedRoleId, moduleId, action, next);
      if (res.error) toast.error(res.error);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit">
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Rôles</p>
            <Button size="sm" variant="ghost" onClick={() => setShowNewRole((v) => !v)}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showNewRole && (
            <form
              action={(formData) =>
                startTransition(async () => {
                  const res = await createRole(formData);
                  if (res.error) toast.error(res.error);
                  else {
                    toast.success("Rôle créé");
                    setShowNewRole(false);
                    window.location.reload();
                  }
                })
              }
              className="mb-2 space-y-2 rounded-md border border-border bg-surface-muted/50 p-3"
            >
              <input
                name="label"
                required
                placeholder="Libellé (ex. Assistant commercial)"
                className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
              />
              <input
                name="key"
                required
                placeholder="clé (ex. assistant_commercial)"
                pattern="[a-z0-9_]+"
                className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
              />
              <select name="base_role" className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs" defaultValue="commercial">
                {BASE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    Basé sur : {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <textarea
                name="description"
                placeholder="Description (optionnel)"
                className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
                rows={2}
              />
              <Button type="submit" size="sm" loading={pending} className="w-full">
                Créer
              </Button>
            </form>
          )}

          <div className="space-y-1">
            {localRoles.map((role) => (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  role.id === selectedRoleId ? "bg-brand-soft text-brand" : "text-foreground-muted hover:bg-surface-muted"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {role.is_system && <Lock className="h-3 w-3 shrink-0 opacity-60" />}
                  {role.label}
                </span>
                <Badge tone={role.active ? "success" : "neutral"}>
                  {userCountByRole[role.id] ?? 0}
                </Badge>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      {selectedRole && (
        <Card>
          <CardBody className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{selectedRole.label}</h3>
                  {selectedRole.is_system && (
                    <Badge tone="neutral">Rôle système — non supprimable</Badge>
                  )}
                </div>
                {selectedRole.description && (
                  <p className="mt-1 text-xs text-foreground-muted">{selectedRole.description}</p>
                )}
                <p className="mt-1 text-xs text-foreground-muted">
                  Cloisonnement hérité (client/entreprise, section...) : <strong>{ROLE_LABELS[selectedRole.base_role]}</strong> ·{" "}
                  {userCountByRole[selectedRole.id] ?? 0} utilisateur(s)
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await toggleRoleActive(selectedRole.id, !selectedRole.active);
                      if (res.error) toast.error(res.error);
                      else
                        setLocalRoles((rs) =>
                          rs.map((r) => (r.id === selectedRole.id ? { ...r, active: !r.active } : r))
                        );
                    })
                  }
                >
                  {selectedRole.active ? "Désactiver" : "Activer"}
                </Button>
                {!selectedRole.is_system && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await deleteRole(selectedRole.id);
                        if (res.error) toast.error(res.error);
                        else {
                          toast.success("Rôle supprimé");
                          window.location.reload();
                        }
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Supprimer
                  </Button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                    <th className="py-2 pr-3 font-medium">Module</th>
                    {ACTIONS.map((a) => (
                      <th key={a} className="px-2 py-2 text-center font-medium">
                        {PERMISSION_ACTION_LABELS[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {modules.map((mod) => {
                    const row = localPerms.get(`${selectedRole.id}:${mod.id}`);
                    return (
                      <tr key={mod.id}>
                        <td className="py-2 pr-3">
                          <span className="font-medium text-foreground">{mod.label}</span>
                          {mod.description && (
                            <span className="block text-xs text-foreground-muted">{mod.description}</span>
                          )}
                        </td>
                        {ACTIONS.map((action) => {
                          const column = {
                            view: "can_view",
                            create: "can_create",
                            modify: "can_modify",
                            archive: "can_archive",
                            delete: "can_delete",
                            validate: "can_validate",
                            unlock: "can_unlock",
                          }[action] as
                            | "can_view"
                            | "can_create"
                            | "can_modify"
                            | "can_archive"
                            | "can_delete"
                            | "can_validate"
                            | "can_unlock";
                          const checked = row?.[column] ?? false;
                          return (
                            <td key={action} className="px-2 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => togglePermission(mod.id, action, e.target.checked)}
                                className="h-4 w-4 accent-brand"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
