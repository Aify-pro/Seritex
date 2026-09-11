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
  Ruler,
  Shirt,
  SwatchBook,
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
   * Clé du module de droits qui commande la VISIBILITÉ de l'entrée : si elle
   * est renseignée et que le rôle n'a pas `view` dessus, l'entrée disparaît
   * du menu au lieu d'être affichée puis refusée à l'arrivée (filtrage dans
   * le layout). Omise pour les entrées sans module dédié (tableau de bord,
   * portail client, écrans commerciaux, modèles de produits, couleurs) :
   * celles-là restent commandées par le seul `base_role`.
   */
  module?: string;
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
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen), module: "mediatheque" },
    { href: "/commercial/production", label: "Avancement production", icon: navIcon(Factory) },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
      module: "clients_sage",
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES, module: "articles_sage" },
  ],
  infographiste: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/infographie/demandes", label: "Demandes graphiques", icon: navIcon(ImageIcon) },
  ],
  responsable_production: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory), module: "ordres_fabrication" },
    { href: "/atelier/patronnage", label: "Patronnage", icon: navIcon(Ruler), module: "patronnage" },
    { href: "/atelier/section", label: "Terminaux de section", icon: navIcon(ClipboardList), module: "ordres_travail" },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen), module: "mediatheque" },
    { href: "/parametres/produits", label: "Modèles de produits", icon: navIcon(Shirt), section: PARAMETRES },
    { href: "/parametres/couleurs", label: "Palette de couleurs", icon: navIcon(SwatchBook), section: PARAMETRES },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES, module: "stock_sage" },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
      module: "clients_sage",
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES, module: "articles_sage" },
  ],
  chef_section: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/atelier/section", label: "File de ma section", icon: navIcon(ClipboardList), module: "ordres_travail" },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES, module: "stock_sage" },
  ],
  gestionnaire_stock: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory), module: "ordres_fabrication" },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES, module: "stock_sage" },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
      module: "clients_sage",
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES, module: "articles_sage" },
  ],
  administrateur: [
    { href: "/dashboard", label: "Tableau de bord", icon: navIcon(LayoutDashboard) },
    { href: "/commercial/clients", label: "Clients", icon: navIcon(Contact) },
    { href: "/commercial/demandes", label: "Demandes", icon: navIcon(Inbox) },
    { href: "/commercial/devis", label: "Devis", icon: navIcon(FileText) },
    { href: "/commercial/echantillons", label: "Échantillons", icon: navIcon(FlaskConical) },
    { href: "/mediatheque", label: "Médiathèque", icon: navIcon(FolderOpen), module: "mediatheque" },
    { href: "/atelier/production", label: "Ordres de fabrication", icon: navIcon(Factory), module: "ordres_fabrication" },
    { href: "/atelier/patronnage", label: "Patronnage", icon: navIcon(Ruler), module: "patronnage" },
    { href: "/atelier/section", label: "Terminaux de section", icon: navIcon(ClipboardList), module: "ordres_travail" },
    { href: "/parametres/utilisateurs", label: "Utilisateurs", icon: navIcon(Users), section: PARAMETRES, module: "utilisateurs" },
    { href: "/parametres/roles", label: "Rôles & permissions", icon: navIcon(ShieldCheck), section: PARAMETRES, module: "roles" },
    { href: "/parametres/sections", label: "Sections d'atelier", icon: navIcon(Boxes), section: PARAMETRES, module: "sections" },
    { href: "/parametres/produits", label: "Modèles de produits", icon: navIcon(Shirt), section: PARAMETRES },
    { href: "/parametres/couleurs", label: "Palette de couleurs", icon: navIcon(SwatchBook), section: PARAMETRES },
    { href: "/parametres/stockage", label: "Stockage médiathèque", icon: navIcon(Database), section: PARAMETRES, module: "stockage_cibles" },
    { href: "/parametres/sage", label: "Intégration Sage", icon: navIcon(Plug), section: PARAMETRES, module: "parametres_sage" },
    { href: "/parametres/stock", label: "Stock Sage (lecture)", icon: navIcon(Warehouse), section: PARAMETRES, module: "stock_sage" },
    {
      href: "/parametres/clients-sage",
      label: "Clients Sage (lecture)",
      icon: navIcon(Building2),
      section: PARAMETRES,
      module: "clients_sage",
    },
    { href: "/parametres/articles-sage", label: "Articles Sage (lecture)", icon: navIcon(Package), section: PARAMETRES, module: "articles_sage" },
    { href: "/parametres/audit", label: "Journal d'audit", icon: navIcon(ScrollText), section: PARAMETRES, module: "audit" },
  ],
};
