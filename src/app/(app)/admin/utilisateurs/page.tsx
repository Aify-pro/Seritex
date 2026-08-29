import { requireRole } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ROLE_LABELS, type UserRole } from "@/lib/types/domain";
import { NewUserForm } from "./new-user-form";
import { UserActiveToggle } from "./user-active-toggle";

export default async function UsersPage() {
  await requireRole(["administrateur"]);
  const supabase = await createClient();

  const [{ data: users }, { data: companies }, { data: sections }] = await Promise.all([
    supabase
      .from("app_users")
      .select("id,full_name,email,role,active,companies(name),sections(name)")
      .order("full_name"),
    supabase.from("companies").select("id,name").order("name"),
    supabase.from("sections").select("id,name").order("display_order"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs & rôles"
        description="RBAC — chaque compte porte un rôle unique qui détermine ses accès, appliqué côté serveur et en base."
        action={<NewUserForm companies={companies ?? []} sections={sections ?? []} />}
      />

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-5 py-3 font-medium">Nom</th>
                <th className="px-5 py-3 font-medium">E-mail</th>
                <th className="px-5 py-3 font-medium">Rôle</th>
                <th className="px-5 py-3 font-medium">Rattachement</th>
                <th className="px-5 py-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="px-5 py-3 font-medium text-foreground">{u.full_name}</td>
                  <td className="px-5 py-3 text-foreground-muted">{u.email}</td>
                  <td className="px-5 py-3 text-foreground-muted">{ROLE_LABELS[u.role as UserRole]}</td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {(u.companies as unknown as { name: string } | null)?.name ??
                      (u.sections as unknown as { name: string } | null)?.name ??
                      "—"}
                  </td>
                  <td className="px-5 py-3">
                    <UserActiveToggle userId={u.id} active={u.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
