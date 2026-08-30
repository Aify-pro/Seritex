import type { UserRole } from "@/lib/types/domain";
import {
  LayoutDashboard,
  Inbox,
  FileText,
  FlaskConical,
  Factory,
  ClipboardList,
  Users,
  Boxes,
  Route,
  Warehouse,
  ScrollText,
  Image as ImageIcon,
  Eye,
  FolderOpen,
  Database,
  ShieldCheck,
  Building2,
  Package,
  Plug,
  Contact,
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
};

// Les icônes doivent être rendues ici, côté serveur, plutôt que transmises en
// tant que référence de composant : un composant "use client" (SidebarNav)
// ne peut pas recevoir une fonction/composant brut en prop, seulement du
// contenu déjà rendu (React error: "Functions cannot be passed directly to
// Client Components").
function navIcon(Icon: LucideIcon): ReactNode {
  return createElement(Icon, { className: "relative z-10 h-4 w-4 shrink-0" });
}

const PARAMETRES = "Paramètres";

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  client: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/client/demandes", label: "Mes demandes", icon: navIcon(Inbox) },
    { href: "/client/devis", label: "Mes devis", icon: navIcon(FileText) },
    { href: "/client/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/client/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/client/production", label: "Suivi commande", icon: navIcon(Eye) },
  ],
  commercial: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact) },
    { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox) },
    { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/commercial/production", label: "Avancement production", icon: navIcon(Factory) },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES },
  ],
  infographiste: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/infographie/demandes", label: "Demandes graphiques", icon: navIcon(ImageIcon) },
  ],
  responsable_production: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory) },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: navIcon(Boxes) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/parametres/gammes", label: "Gammes opératoires", icon: navIcon(Route), section: PARAMETRES },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES },
  ],
  chef_section: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/atelier/section", label: "File de ma section", icon: navIcon(ClipboardList) },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES },
  ],
  administrateur: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact) },
    { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox) },
    { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory) },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: navIcon(Boxes) },
    { href: "/parametres/utilisateurs", label: "Utilisateurs", icon: navIcon(Users), section: PARAMETRES },
    { href: "/parametres/roles", label: "Rôles & permissions", icon: navIcon(ShieldCheck), section: PARAMETRES },
    { href: "/parametres/sections", label: "Sections d'atelier", icon: navIcon(Boxes), section: PARAMETRES },
    { href: "/parametres/gammes", label: "Gammes opératoires", icon: navIcon(Route), section: PARAMETRES },
    { href: "/parametres/stockage", label: "Stockage médiathèque", icon: navIcon(Database), section: PARAMETRES },
    { href: "/parametres/sage", label: "Intégration Sage", icon: navIcon(Plug), section: PARAMETRES },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES },
    { href: "/parametres/audit", label: "Journal d'audit", icon: navIcon(ScrollText), section: PARAMETRES },
  ],
};
