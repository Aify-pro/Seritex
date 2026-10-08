import type { UserRole } from "@/lib/types/domain";
import { getModuleMeta } from "./modules-catalog";
import {
  LayoutDashboard,
  Inbox,
  FolderTree,
  FileText,
  FlaskConical,
  Factory,
  ClipboardList,
  Users,
  Boxes,
  Warehouse,
  ScrollText,
  Image as ImageIcon,
  Eye,
  FolderOpen,
  Database,
  ShieldCheck,
  Building2,
  Landmark,
  Package,
  Plug,
  Contact,
  Ruler,
  SwatchBook,
  ArrowLeftRight,
  Gauge,
  Mail,
  Globe,
  ChartPie,
  Calculator,
  Barcode,
  Tags,
  Truck,
  MapPinned,
  Layers,
  Palette,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
  /**
   * Regroupement visuel dans la barre latérale (ex. "Paramètres"). Deux
   * items consécutifs partageant la même section n'affichent l'en-tête
   * qu'une fois — voir SidebarNav. Omis pour les items hors section (accès
   * quotidien : tableau de bord, demandes, atelier...).
   */
  section?: string;
  /**
   * Clé du module de droits qui commande la VISIBILITÉ de l'entrée : si le
   * rôle n'a pas `view` dessus, l'entrée disparaît du menu au lieu d'être
   * affichée puis refusée à l'arrivée (filtrage dans getNavItems). Omise
   * seulement pour le tableau de bord et les portails client / livreur.
   */
  module?: string;
  /** Autres modules dont le droit `view` ouvre aussi l'entrée (ex. Demandes pour le stock). */
  alsoModules?: string[];
  /**
   * Préfixes d'URL qui rendent l'entrée active en plus de `href` — pour une
   * entrée qui regroupe plusieurs pages (ex. « Intégration Sage » couvre
   * clients, articles, stock et devis).
   */
  matchPrefixes?: string[];
};

/**
 * Entrée repliable de la barre latérale (le volet « Paramètres ») : un titre
 * qui s'ouvre sur ses propres entrées. Construite par buildSidebarEntries()
 * à partir des entrées `section: PARAMETRES` du rôle.
 */
export type NavGroup = {
  label: string;
  icon: ReactNode;
  children: NavItem[];
};

export type SidebarEntry = NavItem | NavGroup;

// Les icônes doivent être rendues ici, côté serveur, plutôt que transmises en
// tant que référence de composant : un composant "use client" (SidebarNav)
// ne peut pas recevoir une fonction/composant brut en prop, seulement du
// contenu déjà rendu (React error: "Functions cannot be passed directly to
// Client Components").
function navIcon(Icon: LucideIcon): ReactNode {
  return createElement(Icon, { className: "relative z-10 h-4 w-4 shrink-0" });
}

export const PARAMETRES = "Paramètres";

/** Portails : entrées fixes, hors matrice (le client et le livreur n'ont pas de menu configurable). */
const PORTAL_NAV: Partial<Record<UserRole, NavItem[]>> = {
  client: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/client/demandes", label: "Mes demandes", icon: navIcon(Inbox) },
    { href: "/client/devis", label: "Mes devis", icon: navIcon(FileText) },
    { href: "/client/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/client/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/client/production", label: "Suivi commande", icon: navIcon(Eye) },
    { href: "/client/livraisons", label: "Mes livraisons", icon: navIcon(Truck) },
  ],
  livreur: [{ href: "/livreur", label: "Mes livraisons", icon: navIcon(Truck) }],
};

/**
 * Catalogue unique des écrans du personnel interne. Ce n'est plus le rôle de
 * base qui décide de ce qui s'affiche, mais le droit `view` du rôle sur le
 * module de chaque entrée (Paramètres > Rôles & permissions). Chaque entrée
 * a donc un module, sauf le tableau de bord.
 */
const STAFF_NAV: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
  { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact), module: "clients" },
  { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox), module: "demandes", alsoModules: ["demandes_stock"] },
  { href: "/infographie/demandes", label: "Demandes graphiques", icon: navIcon(ImageIcon), module: "demandes_graphiques" },
  { href: "/infographie/separation", label: "Séparation des couleurs", icon: navIcon(Layers), module: "demandes_graphiques" },
  { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText), module: "devis" },
  { href: "/articles", label: "Articles", icon: navIcon(Tags), module: "articles" },
  { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical), module: "echantillons" },
  { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen), module: "mediatheque" },
  { href: "/commercial/production", label: "Avancement production", icon: navIcon(Factory), module: "avancement_production" },
  { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory), module: "ordres_fabrication" },
  { href: "/atelier/patronnage", label: "Patronnage", icon: navIcon(Ruler), module: "patronnage" },
  { href: "/atelier/section", label: "Terminaux de section", icon: navIcon(ClipboardList), module: "ordres_travail" },
  { href: "/atelier/stock", label: "Gestion de stock", icon: navIcon(ArrowLeftRight), module: "stock_atelier" },
  { href: "/livraisons", label: "Livraisons", icon: navIcon(Truck), module: "livraisons" },

  // --- Paramètres (regroupés en thèmes par parametres-hubs.ts) ------------
  { href: "/parametres/couleurs", label: "Couleurs et tailles", icon: navIcon(SwatchBook), section: PARAMETRES, module: "couleurs_tailles" },
  { href: "/parametres/familles-articles", label: "Familles d'articles", icon: navIcon(FolderTree), section: PARAMETRES, module: "articles" },
  { href: "/parametres/codification", label: "Codification", icon: navIcon(Barcode), section: PARAMETRES, module: "codification" },
  { href: "/parametres/tarification", label: "Tarification", icon: navIcon(Calculator), section: PARAMETRES, module: "tarification" },
  { href: "/parametres/sections", label: "Sections d'atelier", icon: navIcon(Boxes), section: PARAMETRES, module: "sections" },
  { href: "/parametres/fabrication", label: "Fabrication", icon: navIcon(Gauge), section: PARAMETRES, module: "fabrication" },
  { href: "/parametres/dispatching", label: "Dispatching des tailles", icon: navIcon(ChartPie), section: PARAMETRES, module: "dispatching" },
  { href: "/parametres/encres", label: "Nuancier d'encres", icon: navIcon(Palette), section: PARAMETRES, module: "encres" },
  { href: "/parametres/livraison", label: "Livraison", icon: navIcon(MapPinned), section: PARAMETRES, module: "parametres_livraison" },
  { href: "/parametres/sage", label: "Intégration Sage", icon: navIcon(Plug), section: PARAMETRES, module: "parametres_sage" },
  { href: "/parametres/clients-sage", label: "Clients Sage (lecture)", icon: navIcon(Building2), section: PARAMETRES, module: "clients_sage" },
  { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES, module: "articles_sage" },
  { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES, module: "stock_sage" },
  { href: "/parametres/devis-sage", label: "Devis Sage (lecture)", icon: navIcon(FileText), section: PARAMETRES, module: "devis_sage" },
  { href: "/parametres/utilisateurs", label: "Utilisateurs", icon: navIcon(Users), section: PARAMETRES, module: "utilisateurs" },
  { href: "/parametres/roles", label: "Rôles & permissions", icon: navIcon(ShieldCheck), section: PARAMETRES, module: "roles" },
  { href: "/parametres/audit", label: "Journal d'audit", icon: navIcon(ScrollText), section: PARAMETRES, module: "audit" },
  { href: "/parametres/societe", label: "Informations société", icon: navIcon(Landmark), section: PARAMETRES, module: "societe" },
  { href: "/parametres/stockage", label: "Stockage médiathèque", icon: navIcon(Database), section: PARAMETRES, module: "stockage_cibles" },
  { href: "/parametres/notifications", label: "Notifications", icon: navIcon(Mail), section: PARAMETRES, module: "notifications" },
  { href: "/parametres/site-web", label: "Site web", icon: navIcon(Globe), section: PARAMETRES, module: "site_web" },
];

/**
 * Entrées de menu d'un utilisateur : portail fixe pour le client et le
 * livreur, sinon le catalogue du personnel filtré par le droit `view` de son
 * rôle. Un module sans droit n'est pas grisé : il n'existe pas dans le menu.
 */
export function getNavItems(
  role: UserRole,
  permissions: Record<string, { view: boolean }>,
  platformAdmin: boolean
): NavItem[] {
  const portal = PORTAL_NAV[role];
  if (portal) return portal;

  const opens = (key: string) =>
    permissions[key]?.view === true && (platformAdmin || !getModuleMeta(key).platformAdminOnly);
  const visible = (item: NavItem) => !item.module || opens(item.module) || (item.alsoModules ?? []).some(opens);

  return STAFF_NAV.filter(visible).map((item) =>
    // La comptabilité n'utilise les livraisons que pour la validation : son menu ouvre directement l'onglet.
    role === "comptabilite" && item.href === "/livraisons"
      ? { ...item, href: "/livraisons?onglet=a_valider", label: "Livraisons à valider", matchPrefixes: ["/livraisons"] }
      : item
  );
}
