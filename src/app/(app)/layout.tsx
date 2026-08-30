import { requireUser } from "@/lib/auth/current-user";
import { NAV_BY_ROLE } from "@/lib/auth/nav";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MobileSidebar } from "@/components/shell/mobile-sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { Shirt } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const items = NAV_BY_ROLE[profile.role];

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
