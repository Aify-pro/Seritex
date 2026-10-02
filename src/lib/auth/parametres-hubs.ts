import {
  Settings,
  Plug,
  Shirt,
  Factory,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { PARAMETRES, type NavItem, type SidebarEntry } from "@/lib/auth/nav";

/**
 * Regroupement des écrans de Paramètres : un seul menu par thème dans la
 * barre latérale (« Intégration Sage »…), et les écrans du thème en onglets
 * au-dessus de chaque page. Les URL des écrans ne changent pas — seul le
 * regroupement est ici ; qui voit quoi reste décidé par NAV_BY_ROLE (rôle +
 * droits `view`), un onglet absent des entrées du rôle n'apparaît pas.
 */
interface HubDefinition {
  key: string;
  label: string;
  icon: LucideIcon;
  tabs: { href: string; label: string }[];
}

const HUBS: HubDefinition[] = [
  {
    key: "sage",
    label: "Intégration Sage",
    icon: Plug,
    tabs: [
      { href: "/parametres/sage", label: "Vue d'ensemble" },
      { href: "/parametres/clients-sage", label: "Clients" },
      { href: "/parametres/articles-sage", label: "Articles" },
      { href: "/parametres/stock", label: "Stock" },
      { href: "/parametres/devis-sage", label: "Devis" },
    ],
  },
  {
    key: "produits",
    label: "Produits",
    icon: Shirt,
    tabs: [
      { href: "/parametres/produits", label: "Modèles de produits" },
      { href: "/parametres/couleurs", label: "Couleurs et tailles" },
      { href: "/parametres/textiles", label: "Textiles" },
    ],
  },
  {
    key: "atelier",
    label: "Atelier",
    icon: Factory,
    tabs: [
      { href: "/parametres/sections", label: "Sections d'atelier" },
      { href: "/parametres/fabrication", label: "Fabrication" },
      { href: "/parametres/dispatching", label: "Dispatching des tailles" },
    ],
  },
  {
    key: "acces",
    label: "Accès et sécurité",
    icon: ShieldCheck,
    tabs: [
      { href: "/parametres/utilisateurs", label: "Utilisateurs" },
      { href: "/parametres/roles", label: "Rôles & permissions" },
      { href: "/parametres/audit", label: "Journal d'audit" },
    ],
  },
  {
    key: "general",
    label: "Général",
    icon: SlidersHorizontal,
    tabs: [
      { href: "/parametres/societe", label: "Informations société" },
      { href: "/parametres/stockage", label: "Stockage médiathèque" },
      { href: "/parametres/notifications", label: "Notifications" },
    ],
  },
];

/** Thème de Paramètres tel que vu par un rôle : seulement les onglets auxquels il a droit. */
export interface ParametresHub {
  key: string;
  label: string;
  tabs: { href: string; label: string }[];
}

// Même règle que navIcon() de nav.ts : rendu côté serveur, un composant
// "use client" ne peut pas recevoir une icône brute en prop.
function icon(Icon: LucideIcon): ReactNode {
  return createElement(Icon, { className: "relative z-10 h-4 w-4 shrink-0" });
}

const isParametres = (item: NavItem) => item.section === PARAMETRES;

/** Thèmes (et onglets) de Paramètres accessibles avec ces entrées de menu. */
export function getParametresHubs(items: NavItem[]): ParametresHub[] {
  const allowed = new Set(items.filter(isParametres).map((item) => item.href));
  return HUBS.map((hub) => ({
    key: hub.key,
    label: hub.label,
    tabs: hub.tabs.filter((tab) => allowed.has(tab.href)),
  })).filter((hub) => hub.tabs.length > 0);
}

/**
 * Entrées de la barre latérale : les écrans de Paramètres, éparpillés à plat
 * dans les entrées du rôle, deviennent UN volet « Paramètres » placé là où
 * se trouvait le premier, avec un menu par thème à l'intérieur.
 */
export function buildSidebarEntries(items: NavItem[]): SidebarEntry[] {
  const hubs = getParametresHubs(items);
  const entries: SidebarEntry[] = [];
  let groupAdded = false;
  for (const item of items) {
    if (!isParametres(item)) {
      entries.push(item);
      continue;
    }
    if (groupAdded || hubs.length === 0) continue;
    groupAdded = true;
    entries.push({
      label: PARAMETRES,
      icon: icon(Settings),
      children: hubs.map((hub) => ({
        href: hub.tabs[0].href,
        label: hub.label,
        icon: icon(HUBS.find((h) => h.key === hub.key)!.icon),
        matchPrefixes: hub.tabs.map((tab) => tab.href),
      })),
    });
  }
  return entries;
}
