import { redirect } from "next/navigation";
import { signOutAction } from "@/app/login/actions";
import Image from "next/image";
import { isPlatformAdmin, requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPermissionMap } from "@/lib/auth/permissions";
import { getNavItems } from "@/lib/auth/nav";
import { buildSidebarEntries } from "@/lib/auth/parametres-hubs";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MobileSidebar } from "@/components/shell/mobile-sidebar";
import { UserMenu } from "@/components/shell/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  // Compte créé avec un mot de passe provisoire (ou réinitialisation exigée) :
  // rien d'autre n'est accessible tant que l'utilisateur n'a pas choisi le sien.
  if (profile.must_change_password) redirect("/reinitialiser-mot-de-passe");
  // Compte créé sur le site et pas encore rattaché à un client (migration 0125) : rien à montrer.
  if (profile.role === "client" && !profile.company_id) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Image src="/logo-seritex-wide.png" alt="Seritex" width={447} height={265} className="h-12 w-auto object-contain" priority />
        <h1 className="text-lg font-semibold text-foreground">Votre compte est en cours de rattachement</h1>
        <p className="text-sm text-foreground-muted">
          Votre inscription est bien enregistrée. Notre équipe la rattache à votre fiche client ; l&apos;espace client s&apos;ouvrira ensuite.
          Pour toute question : info@seritex.ci.
        </p>
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-brand underline">Se déconnecter</button>
        </form>
      </main>
    );
  }
  const [permissions, platformAdmin] = await Promise.all([getPermissionMap(), isPlatformAdmin()]);
  // Libellé du rôle métier (« Direction »…) plutôt que celui du rôle de base.
  const supabase = await createClient();
  const { data: roleRow } = await supabase.from("roles").select("label").eq("id", profile.role_id).maybeSingle();

  // Une entrée n'apparaît que si le rôle a `view` sur son module : un module
  // sans droit n'est pas grisé ni refusé à l'arrivée, il n'existe simplement
  // pas dans le menu (le client et le livreur gardent leur portail fixe).
  // Les écrans de Paramètres sont regroupés en un volet repliable, un menu
  // par thème (voir parametres-hubs.ts).
  const items = buildSidebarEntries(getNavItems(profile.role, permissions, platformAdmin));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface py-4 md:flex">
        <div className="mb-6 flex items-center px-4">
          <Image src="/logo-seritex-wide.png" alt="Seritex" width={447} height={265} className="h-9 w-auto object-contain" priority />
        </div>
        <SidebarNav items={items} />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <MobileSidebar items={items} />
            <Image src="/logo-seritex-wide.png" alt="Seritex" width={447} height={265} className="h-7 w-auto object-contain" />
          </div>
          <div className="hidden md:block" />
          <UserMenu fullName={profile.full_name} role={profile.role} roleLabel={roleRow?.label} email={profile.email} />
        </header>

        <main className="flex-1 bg-background px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
