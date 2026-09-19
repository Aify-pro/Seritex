import Link from "next/link";
import { Search } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Thead, Th } from "@/components/ui/table";
import { ClickableTr } from "@/components/ui/clickable-row";
import { NewUserForm } from "./new-user-form";
import { UserAvatar } from "./user-avatar";
import { AccountStatusBadge, accountState } from "./account-status";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

const STATUS_FILTERS = [
  { key: "", label: "Tous les statuts" },
  { key: "actif", label: "Actifs" },
  { key: "invitation", label: "Invitation en attente" },
  { key: "desactive", label: "Désactivés" },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; statut?: string }>;
}) {
  await requirePlatformAdmin();
  const { q = "", role = "", statut = "" } = await searchParams;
  const supabase = await createClient();

  const [{ data: users }, { data: companies }, { data: sections }, { data: contacts }, { data: roles }, authList] =
    await Promise.all([
      supabase
        .from("app_users")
        .select("id,full_name,email,role,role_id,active,company_id,job_title,companies(name),sections(name),contacts(first_name,last_name)")
        .order("full_name"),
      supabase.from("companies").select("id,name").order("name"),
      supabase.from("sections").select("id,name").order("display_order"),
      supabase.from("contacts").select("id,company_id,first_name,last_name").eq("status", "actif").order("last_name"),
      supabase.from("roles").select("id,label,base_role").eq("active", true).order("label"),
      // Dernière connexion : n'existe que côté Auth. Réservé à cet écran administrateur.
      createAdminClient().auth.admin.listUsers({ perPage: 1000 }),
    ]);

  const lastSignIn = new Map<string, string | null>(
    (authList.data?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  );
  const roleLabel = new Map((roles ?? []).map((r) => [r.id, r.label]));

  const rows = (users ?? []).map((u) => ({ ...u, lastSignInAt: lastSignIn.get(u.id) ?? null }));
  const withState = rows.map((u) => ({ ...u, state: accountState(u.active, u.lastSignInAt) }));

  const needle = q.trim().toLowerCase();
  const filtered = withState.filter(
    (u) =>
      (!needle || u.full_name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)) &&
      (!role || u.role_id === role) &&
      (!statut || u.state === statut)
  );
  const counts = {
    actif: withState.filter((u) => u.state === "actif").length,
    invitation: withState.filter((u) => u.state === "invitation").length,
    desactive: withState.filter((u) => u.state === "desactive").length,
  };
  const hasFilter = !!(needle || role || statut);
  const selectClass = "h-9 rounded-md border border-border bg-surface px-2 text-sm";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Chaque compte porte un rôle qui détermine ses accès (réglés dans Rôles & permissions). Ouvrez une fiche pour modifier le compte, renvoyer une invitation ou réinitialiser un mot de passe."
        action={<NewUserForm roles={roles ?? []} companies={companies ?? []} sections={sections ?? []} contacts={contacts ?? []} />}
      />

      <div className="flex flex-wrap gap-2 text-xs text-foreground-muted">
        <Badge tone="success" dot>{counts.actif} actif{counts.actif > 1 ? "s" : ""}</Badge>
        {counts.invitation > 0 && <Badge tone="warning" dot>{counts.invitation} invitation{counts.invitation > 1 ? "s" : ""} en attente</Badge>}
        {counts.desactive > 0 && <Badge tone="danger" dot>{counts.desactive} désactivé{counts.desactive > 1 ? "s" : ""}</Badge>}
      </div>

      <Card>
        <form className="flex flex-wrap items-center gap-2 border-b border-border p-3" role="search">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Rechercher un nom ou une adresse e-mail"
              aria-label="Rechercher un utilisateur"
              className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm outline-none ring-brand/30 focus:ring-2"
            />
          </div>
          <select name="role" defaultValue={role} aria-label="Filtrer par rôle" className={selectClass}>
            <option value="">Tous les rôles</option>
            {(roles ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <select name="statut" defaultValue={statut} aria-label="Filtrer par statut" className={selectClass}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="md">
            Filtrer
          </Button>
          {hasFilter && (
            <Link href="/parametres/utilisateurs" className="text-sm text-foreground-muted hover:text-foreground">
              Réinitialiser
            </Link>
          )}
        </form>

        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-foreground-muted">
            {hasFilter ? "Aucun compte ne correspond à ces critères." : "Aucun compte pour le moment."}
          </p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Utilisateur</Th>
                <Th>Rôle</Th>
                <Th>Rattachement</Th>
                <Th>Statut</Th>
                <Th>Dernière connexion</Th>
              </tr>
            </Thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => {
                const company = u.companies as unknown as { name: string } | null;
                const section = u.sections as unknown as { name: string } | null;
                const contact = u.contacts as unknown as { first_name: string; last_name: string } | null;
                return (
                  <ClickableTr key={u.id} href={`/parametres/utilisateurs/${u.id}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={u.full_name} muted={u.state === "desactive"} />
                        <div className="min-w-0">
                          <Link
                            href={`/parametres/utilisateurs/${u.id}`}
                            className="block font-medium text-foreground hover:text-brand"
                          >
                            {u.full_name}
                          </Link>
                          <span className="block truncate text-xs text-foreground-muted">{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="brand">{roleLabel.get(u.role_id) ?? u.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">
                      {company?.name ?? section?.name ?? "—"}
                      {contact && (
                        <span className="block text-xs">
                          {contact.first_name} {contact.last_name}
                        </span>
                      )}
                      {u.role === "client" && !contact && <span className="block text-xs text-warning">Aucun contact CRM lié</span>}
                    </td>
                    <td className="px-4 py-3">
                      <AccountStatusBadge state={u.state} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-foreground-muted">
                      {u.lastSignInAt ? dateFmt.format(new Date(u.lastSignInAt)) : "Jamais"}
                    </td>
                  </ClickableTr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
