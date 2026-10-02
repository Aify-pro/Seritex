import { requireUser } from "@/lib/auth/current-user";
import { getPermissionMap } from "@/lib/auth/permissions";
import { NAV_BY_ROLE } from "@/lib/auth/nav";
import { getParametresHubs } from "@/lib/auth/parametres-hubs";
import { ParametresTabs } from "@/components/shell/parametres-tabs";

/**
 * Onglets communs aux écrans de Paramètres : chaque thème (Intégration Sage,
 * Produits, Atelier…) affiche ses écrans en onglets, filtrés comme le menu
 * (rôle + droit `view` du module).
 */
export default async function ParametresLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  const permissions = await getPermissionMap();
  const items = NAV_BY_ROLE[profile.role].filter((item) => !item.module || permissions[item.module]?.view === true);

  return (
    <>
      <ParametresTabs hubs={getParametresHubs(items)} />
      {children}
    </>
  );
}
