import { requireUser } from "@/lib/auth/current-user";
import { getPermissionMap } from "@/lib/auth/permissions";
import { NAV_BY_ROLE } from "@/lib/auth/nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MobileSidebar } from "@/components/shell/mobile-sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { Shirt } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const permissions = await getPermissionMap();

  // Une entrée rattachée à un module de droits n'apparaît que si le rôle a
  // `view` dessus : un module sans droit n'est pas grisé ni refusé à
  // l'arrivée, il n'existe simplement pas dans le menu. Les entrées sans
  // module (tableau de bord, portail client, écrans commerciaux, modèles de
  // produits, couleurs) restent commandées par le seul base_role.
  const items = NAV_BY_ROLE[profile.role].filter(
    (item) => !item.module || permissions[item.module]?.view === true
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface py-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-4 text-base font-semibold text-foreground">
          <Shirt className="h-5 w-5 text-brand" />
          Seritex
        </div>
        <SidebarNav items={items} />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <MobileSidebar items={items} />
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Shirt className="h-5 w-5 text-brand" />
              Seritex
            </div>
          </div>
          <div className="hidden md:block" />
          <UserMenu fullName={profile.full_name} role={profile.role} email={profile.email} />
        </header>

        <main className="flex-1 bg-background px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
