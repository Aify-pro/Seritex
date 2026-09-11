"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setUserRole } from "../actions";

/**
 * Réattribution du rôle d'un compte existant. Sans cet écran, un rôle créé
 * depuis Rôles & permissions (Direction, PAO...) resterait inattribuable :
 * `app_users.role_id` n'était écrit qu'à la création du compte.
 */
export function UserRoleSelect({
  userId,
  roleId,
  roles,
}: {
  userId: string;
  roleId: string;
  roles: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(roleId);

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        const previous = value;
        setValue(next);
        startTransition(async () => {
          const res = await setUserRole(userId, next);
          if (res?.error) {
            setValue(previous);
            toast.error("Changement refusé", { description: res.error });
          } else {
            toast.success("Rôle mis à jour");
          }
        });
      }}
      className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground disabled:opacity-50"
    >
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
