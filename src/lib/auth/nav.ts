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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

// Les icônes doivent être rendues ici, côté serveur, plutôt que transmises en
// tant que référence de composant : un composant "use client" (SidebarNav)
// ne peut pas recevoir une fonction/composant brut en prop, seulement du
// contenu déjà rendu (React error: "Functions cannot be passed directly to
// Client Components").
function navIcon(Icon: LucideIcon): ReactNode {
  return createElement(Icon, { className: "relative z-10 h-4 w-4 shrink-0" });
}

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
    { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox) },
    { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/commercial/production", label: "Avancement production", icon: navIcon(Factory) },
  ],
  infographiste: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/infographie/demandes", label: "Demandes graphiques", icon: navIcon(ImageIcon) },
  ],
  responsable_production: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory) },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: navIcon(Boxes) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/admin/gammes", label: "Gammes opératoires", icon: navIcon(Route) },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse) },
  ],
  chef_section: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/atelier/section", label: "File de ma section", icon: navIcon(ClipboardList) },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse) },
  ],
  administrateur: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox) },
    { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory) },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: navIcon(Boxes) },
    { href: "/admin/utilisateurs", label: "Utilisateurs & rôles", icon: navIcon(Users) },
    { href: "/admin/sections", label: "Sections", icon: navIcon(Boxes) },
    { href: "/admin/gammes", label: "Gammes opératoires", icon: navIcon(Route) },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse) },
    { href: "/admin/stockage", label: "Stockage médiathèque", icon: navIcon(Database) },
    { href: "/admin/audit", label: "Journal d'audit", icon: navIcon(ScrollText) },
  ],
};
