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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const NAV_BY_ROLE: Record<UserRole, NavItem[]> = {
  client: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/client/demandes", label: "Mes demandes", icon: Inbox },
    { href: "/client/devis", label: "Mes devis", icon: FileText },
    { href: "/client/echantillons", label: "Échantillons", icon: FlaskConical },
    { href: "/client/production", label: "Suivi commande", icon: Eye },
  ],
  commercial: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/commercial/demandes", label: "Demandes", icon: Inbox },
    { href: "/commercial/devis", label: "Devis", icon: FileText },
    { href: "/commercial/echantillons", label: "Échantillons", icon: FlaskConical },
    { href: "/commercial/production", label: "Avancement production", icon: Factory },
  ],
  infographiste: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/infographie/demandes", label: "Demandes graphiques", icon: ImageIcon },
  ],
  responsable_production: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: Factory },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: Boxes },
    { href: "/admin/gammes", label: "Gammes opératoires", icon: Route },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: Warehouse },
  ],
  chef_section: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/atelier/section", label: "File de ma section", icon: ClipboardList },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: Warehouse },
  ],
  administrateur: [
    { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
    { href: "/commercial/demandes", label: "Demandes", icon: Inbox },
    { href: "/commercial/devis", label: "Devis", icon: FileText },
    { href: "/commercial/echantillons", label: "Échantillons", icon: FlaskConical },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: Factory },
    { href: "/atelier/transverse", label: "Vue transverse sections", icon: Boxes },
    { href: "/admin/utilisateurs", label: "Utilisateurs & rôles", icon: Users },
    { href: "/admin/sections", label: "Sections", icon: Boxes },
    { href: "/admin/gammes", label: "Gammes opératoires", icon: Route },
    { href: "/admin/stock", label: "Stock Sage (lecture)", icon: Warehouse },
    { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText },
  ],
};
