"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createRole, deleteRole, setRolePermission, setRoleViewBulk, toggleRoleActive } from "./actions";
import {
  PERMISSION_ACTION_LABELS,
  ROLE_LABELS,
  type ModuleRecord,
  type PermissionAction,
  type RolePermissionRecord,
  type RoleRecord,
  type UserRole,
} from "@/lib/types/domain";
import { MODULE_GROUP_LABELS, MODULE_META, getModuleMeta, type ModuleGroup } from "@/lib/auth/modules-catalog";
import { Plus, Trash2, Lock } from "lucide-react";

const ACTIONS: PermissionAction[] = ["view", "create", "modify", "archive", "delete", "validate", "unlock"];
const BASE_ROLES = Object.keys(ROLE_LABELS) as UserRole[];
const GROUPS: ModuleGroup[] = ["modules", "parametres"];

const COLUMN_BY_ACTION = {
  view: "can_view",
  create: "can_create",
  modify: "can_modify",
  archive: "can_archive",
  delete: "can_delete",
  validate: "can_validate",
  unlock: "can_unlock",
} as const satisfies Record<PermissionAction, keyof RolePermissionRecord>;

const META_ORDER = Object.keys(MODULE_META);
const orderOf = (key: string) => {
  const i = META_ORDER.indexOf(key);
  return i === -1 ? META_ORDER.length : i;
};

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

  const [localPerms, setLocalPerms] = useState(() => {
    const map = new Map<string, RolePermissionRecord>();
    for (const p of permissions) map.set(`${p.role_id}:${p.module_id}`, p);
    return map;
  });

  const modulesByGroup = new Map<ModuleGroup, ModuleRecord[]>(GROUPS.map((g) => [g, []]));
  for (const mod of modules) modulesByGroup.get(getModuleMeta(mod.key).group)!.push(mod);
  for (const list of modulesByGroup.values()) list.sort((a, b) => orderOf(a.key) - orderOf(b.key));

  /** Ligne de droits du rôle sélectionné ; une ligne absente vaut « tout à faux » (créée à la première case cochée). */
  function rowFor(roleId: string, moduleId: string): RolePermissionRecord {
    return (
      localPerms.get(`${roleId}:${moduleId}`) ?? {
        id: "",
        role_id: roleId,
        module_id: moduleId,
        can_view: false,
        can_create: false,
        can_modify: false,
        can_archive: false,
        can_delete: false,
        can_validate: false,
        can_unlock: false,
        updated_at: "",
      }
    );
  }

  function setLocal(roleId: string, moduleId: string, patch: Partial<RolePermissionRecord>) {
    setLocalPerms((prev) => new Map(prev).set(`${roleId}:${moduleId}`, { ...rowFor(roleId, moduleId), ...patch }));
  }

  function togglePermission(moduleId: string, action: PermissionAction, next: boolean) {
    if (!selectedRoleId) return;
    const roleId = selectedRoleId;
    const before = rowFor(roleId, moduleId);
    setLocal(roleId, moduleId, { [COLUMN_BY_ACTION[action]]: next });
    startTransition(async () => {
      const res = await setRolePermission(roleId, moduleId, action, next);
      if (res.error) {
        toast.error(res.error);
        setLocal(roleId, moduleId, before); // le serveur a refusé : on remet la case comme elle était
      }
    });
  }

  function setGroupView(group: ModuleGroup, next: boolean) {
    if (!selectedRole) return;
    const roleId = selectedRole.id;
    const targets = (modulesByGroup.get(group) ?? []).filter((m) => !isLocked(selectedRole, m, "view"));
    const before = targets.map((m) => [m.id, rowFor(roleId, m.id)] as const);
    for (const m of targets) setLocal(roleId, m.id, { can_view: next });
    startTransition(async () => {
      const res = await setRoleViewBulk(roleId, targets.map((m) => m.id), next);
      if (res.error) {
        toast.error(res.error);
        for (const [moduleId, row] of before) setLocal(roleId, moduleId, row);
      }
    });
  }

  /**
   * Cases qu'on ne laisse pas décocher : l'administrateur ne peut pas se retirer
   * l'écran Rôles & permissions (il ne pourrait plus le rouvrir pour se le rendre).
   */
  function isLocked(role: RoleRecord, mod: ModuleRecord, action: PermissionAction) {
    return role.key === "administrateur" && mod.key === "roles" && action === "view";
  }

  const visibleCount = (group: ModuleGroup) =>
    selectedRole ? (modulesByGroup.get(group) ?? []).filter((m) => rowFor(selectedRole.id, m.id).can_view).length : 0;

  const systemRoles = localRoles.filter((r) => r.is_system);
  const customRoles = localRoles.filter((r) => !r.is_system);

  function RoleButton({ role }: { role: RoleRecord }) {
    return (
      <button
        onClick={() => setSelectedRoleId(role.id)}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          role.id === selectedRoleId ? "bg-brand-soft text-brand" : "text-foreground-muted hover:bg-surface-muted"
        } ${role.active ? "" : "opacity-60"}`}
      >
        <span className="flex items-center gap-1.5">
          {role.is_system && <Lock className="h-3 w-3 shrink-0 opacity-60" />}
          {role.label}
        </span>
        <Badge tone={role.active ? "success" : "neutral"}>{userCountByRole[role.id] ?? 0}</Badge>
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit">
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Rôles</p>
            <Button size="sm" variant="ghost" onClick={() => setShowNewRole((v) => !v)} aria-label="Nouveau rôle">
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
              className="space-y-2 rounded-md border border-border bg-surface-muted/50 p-3"
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
                    Rôle de base : {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-snug text-foreground-muted">
                Le rôle de base fixe les données auxquelles le rôle accède (entreprise, section…). Les écrans et les
                droits se règlent ensuite dans la matrice.
              </p>
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
            <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-foreground-muted/70">Rôles système</p>
            {systemRoles.map((role) => (
              <RoleButton key={role.id} role={role} />
            ))}
          </div>
          {customRoles.length > 0 && (
            <div className="space-y-1">
              <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-foreground-muted/70">Rôles personnalisés</p>
              {customRoles.map((role) => (
                <RoleButton key={role.id} role={role} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {selectedRole && (
        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{selectedRole.label}</h3>
                    {selectedRole.is_system && <Badge tone="neutral">Rôle système — non supprimable</Badge>}
                    {!selectedRole.active && <Badge tone="neutral">Désactivé</Badge>}
                  </div>
                  {selectedRole.description && (
                    <p className="mt-1 text-xs text-foreground-muted">{selectedRole.description}</p>
                  )}
                  <p className="mt-1 text-xs text-foreground-muted">
                    {userCountByRole[selectedRole.id] ?? 0} utilisateur(s) · rôle de base :{" "}
                    <strong>{ROLE_LABELS[selectedRole.base_role]}</strong>
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

              <div className="rounded-md bg-surface-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground-muted">
                <p>
                  <strong className="text-foreground">Voir</strong> décide de ce qui apparaît dans le menu et s&apos;ouvre
                  pour ce rôle : {visibleCount("modules")} module(s), {visibleCount("parametres")} écran(s) de paramètres.
                </p>
                <p className="mt-1">
                  Les autres colonnes n&apos;existent que là où elles agissent (cases grisées : sans effet). Les
                  modifications de données restent aussi encadrées par le rôle de base ({ROLE_LABELS[selectedRole.base_role]}).
                </p>
              </div>
            </CardBody>
          </Card>

          {GROUPS.map((group) => {
            const list = modulesByGroup.get(group) ?? [];
            if (list.length === 0) return null;
            const { title, description } = MODULE_GROUP_LABELS[group];
            return (
              <Card key={group}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
                      <p className="text-xs text-foreground-muted">{description}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setGroupView(group, true)}>
                        Tout voir
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setGroupView(group, false)}>
                        Aucun
                      </Button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                          <th className="py-2 pr-3 font-medium">Écran</th>
                          {ACTIONS.map((a) => (
                            <th key={a} className="px-2 py-2 text-center font-medium">
                              {PERMISSION_ACTION_LABELS[a]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {list.map((mod) => {
                          const meta = getModuleMeta(mod.key);
                          const row = rowFor(selectedRole.id, mod.id);
                          return (
                            <tr key={mod.id}>
                              <td className="py-2 pr-3">
                                <span className="font-medium text-foreground">{mod.label}</span>
                                {meta.platformAdminOnly && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-foreground-muted">
                                    <Lock className="h-3 w-3" /> Administrateur plateforme uniquement
                                  </span>
                                )}
                                {mod.description && (
                                  <span className="block text-xs text-foreground-muted">{mod.description}</span>
                                )}
                              </td>
                              {ACTIONS.map((action) => {
                                const applicable = meta.actions.includes(action) && !(meta.platformAdminOnly && action === "view");
                                return (
                                  <td key={action} className="px-2 py-2 text-center">
                                    {applicable ? (
                                      <input
                                        type="checkbox"
                                        checked={row[COLUMN_BY_ACTION[action]] as boolean}
                                        disabled={isLocked(selectedRole, mod, action)}
                                        onChange={(e) => togglePermission(mod.id, action, e.target.checked)}
                                        aria-label={`${mod.label} — ${PERMISSION_ACTION_LABELS[action]}`}
                                        className="h-4 w-4 accent-brand"
                                      />
                                    ) : (
                                      <span className="text-foreground-muted/30" aria-hidden>
                                        —
                                      </span>
                                    )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
