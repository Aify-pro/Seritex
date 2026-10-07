import { isPlatformAdmin, requireUser } from "@/lib/auth/current-user";
import { getPermissionMap } from "@/lib/auth/permissions";
import { getNavItems } from "@/lib/auth/nav";
import { getParametresHubs } from "@/lib/auth/parametres-hubs";
import { ParametresTabs } from "@/components/shell/parametres-tabs";

/**
 * Onglets communs aux écrans de Paramètres : chaque thème (Intégration Sage,
 * Produits, Atelier…) affiche ses écrans en onglets, filtrés comme le menu
 * (rôle + droit `view` du module).
 */
export default async function ParametresLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const [permissions, platformAdmin] = await Promise.all([getPermissionMap(), isPlatformAdmin()]);
  const items = getNavItems(profile.role, permissions, platformAdmin);

  return (
    <>
      <ParametresTabs hubs={getParametresHubs(items)} />
      {children}
    </>
  );
}
