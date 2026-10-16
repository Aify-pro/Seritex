/** Modules qui proposent des préréglages de filtres (migration 0134) et page de liste de chacun. */
export const PRESET_MODULES = {
  clients: { label: "Clients", path: "/commercial/clients" },
  demandes: { label: "Demandes", path: "/commercial/demandes" },
  demandes_graphiques: { label: "Demandes graphiques", path: "/infographie/demandes" },
  devis: { label: "Devis", path: "/commercial/devis" },
  articles: { label: "Articles", path: "/articles" },
  prospection: { label: "Prospection", path: "/prospection" },
} as const;

export type PresetModule = keyof typeof PRESET_MODULES;

export const PRESET_MODULE_KEYS = Object.keys(PRESET_MODULES) as PresetModule[];

export interface Preset {
  id: string;
  name: string;
  /** Query string de la liste, sans pagination. */
  params: string;
  shared: boolean;
  /** Vrai si le préréglage appartient à l'utilisateur courant (sinon : partagé par un collègue, lecture seule). */
  mine: boolean;
  ownerName: string | null;
}
