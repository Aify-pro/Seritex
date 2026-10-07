import type { PermissionAction } from "@/lib/types/domain";

/**
 * Les deux groupes de l'écran « Rôles & permissions » : les modules métier,
 * et les écrans de Paramètres.
 */
export type ModuleGroup = "modules" | "parametres";

export const MODULE_GROUP_LABELS: Record<ModuleGroup, { title: string; description: string }> = {
  modules: {
    title: "Modules",
    description: "Écrans de travail au quotidien : ce que le rôle voit dans le menu, et ce qu'il peut y faire.",
  },
  parametres: {
    title: "Paramètres",
    description: "Écrans de réglage et de consultation de référentiels, regroupés sous « Paramètres » dans le menu.",
  },
};

export interface ModuleMeta {
  group: ModuleGroup;
  /**
   * Actions qui ont réellement un effet pour ce module. Les autres cases sont
   * grisées dans la matrice : cocher « Supprimer » sur un module qui n'a rien
   * à supprimer ne fait rien, autant ne pas le laisser croire.
   */
  actions: PermissionAction[];
  /**
   * Écran de réglage réservé à l'administrateur de la plateforme (garde
   * `requirePlatformAdmin`, aussi côté base) : le droit `view` n'ouvre pas
   * l'écran à un autre rôle.
   */
  platformAdminOnly?: boolean;
}

const VIEW: PermissionAction[] = ["view"];

export const MODULE_META: Record<string, ModuleMeta> = {
  // --- Modules -----------------------------------------------------------
  clients: { group: "modules", actions: ["view", "create", "modify", "delete"] },
  demandes: { group: "modules", actions: ["view", "create", "modify"] },
  demandes_stock: { group: "modules", actions: ["create", "modify"] },
  demandes_graphiques: { group: "modules", actions: VIEW },
  devis: { group: "modules", actions: ["view", "create", "modify", "validate"] },
  echantillons: { group: "modules", actions: ["view", "create", "modify", "delete"] },
  validation_echantillon: { group: "modules", actions: ["validate"] },
  mediatheque: { group: "modules", actions: ["view", "create", "modify", "delete"] },
  articles: { group: "modules", actions: ["view", "modify"] },
  avancement_production: { group: "modules", actions: VIEW },
  ordres_fabrication: { group: "modules", actions: ["view", "modify", "validate", "archive"] },
  validation_comptable: { group: "modules", actions: ["validate"] },
  validation_visuels: { group: "modules", actions: ["validate"] },
  ordres_travail: { group: "modules", actions: VIEW },
  gammes_operatoires: { group: "modules", actions: VIEW },
  patronnage: { group: "modules", actions: ["view", "create", "modify", "archive", "delete", "validate", "unlock"] },
  patronnage_traces: { group: "modules", actions: ["create", "modify"] },
  stock_atelier: { group: "modules", actions: VIEW },
  livraisons: { group: "modules", actions: ["view", "modify", "validate"] },

  // --- Paramètres --------------------------------------------------------
  couleurs_tailles: { group: "parametres", actions: VIEW },
  codification: { group: "parametres", actions: VIEW },
  tarification: { group: "parametres", actions: VIEW },
  sections: { group: "parametres", actions: VIEW },
  fabrication: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  dispatching: { group: "parametres", actions: VIEW },
  parametres_livraison: { group: "parametres", actions: VIEW },
  stock_sage: { group: "parametres", actions: VIEW },
  clients_sage: { group: "parametres", actions: VIEW },
  articles_sage: { group: "parametres", actions: VIEW },
  devis_sage: { group: "parametres", actions: VIEW },
  parametres_sage: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  utilisateurs: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  roles: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  audit: { group: "parametres", actions: VIEW },
  societe: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  stockage_cibles: { group: "parametres", actions: VIEW, platformAdminOnly: true },
  notifications: { group: "parametres", actions: VIEW, platformAdminOnly: true },
};

const FALLBACK_META: ModuleMeta = { group: "modules", actions: VIEW };

export function getModuleMeta(key: string): ModuleMeta {
  return MODULE_META[key] ?? FALLBACK_META;
}
