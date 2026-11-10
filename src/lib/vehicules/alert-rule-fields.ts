/**
 * Champs réglables de chaque règle d'alerte (0174), pour l'écran Paramètres
 * et la validation de l'action. Les clés correspondent à `parametres` (jsonb)
 * et à ce que lit evaluateGpsRules.
 */
export type AlertField =
  | { key: string; label: string; kind: "nombre"; unit?: string; min?: number; max?: number; optional?: boolean; hint?: string }
  | { key: string; label: string; kind: "heure" }
  | { key: string; label: string; kind: "jours" };

export const ALERT_RULE_FIELDS: Record<string, AlertField[]> = {
  exces_vitesse: [
    { key: "seuil_kmh", label: "Vitesse maximale", kind: "nombre", unit: "km/h", min: 20, max: 200 },
    { key: "seuil_moto_kmh", label: "Vitesse maximale (motos)", kind: "nombre", unit: "km/h", min: 20, max: 200 },
  ],
  hors_heures: [
    { key: "debut", label: "Début de journée", kind: "heure" },
    { key: "fin", label: "Fin de journée", kind: "heure" },
    { key: "jours", label: "Jours travaillés", kind: "jours" },
    { key: "km_min", label: "Ignorer les trajets de moins de", kind: "nombre", unit: "km", min: 0, max: 50 },
  ],
  traceur_muet: [{ key: "heures", label: "Silence au-delà de", kind: "nombre", unit: "h", min: 1, max: 720 }],
  arret_prolonge: [
    { key: "minutes", label: "Arrêt de plus de", kind: "nombre", unit: "min", min: 10, max: 1440 },
    { key: "rayon_m", label: "Rayon autour des lieux connus", kind: "nombre", unit: "m", min: 50, max: 5000 },
    { key: "depot_lat", label: "Dépôt : latitude", kind: "nombre", min: -90, max: 90, optional: true, hint: "Ex. 5.2927" },
    { key: "depot_lng", label: "Dépôt : longitude", kind: "nombre", min: -180, max: 180, optional: true, hint: "Ex. -3.9463" },
  ],
  sortie_zone: [
    { key: "centre_lat", label: "Centre : latitude", kind: "nombre", min: -90, max: 90 },
    { key: "centre_lng", label: "Centre : longitude", kind: "nombre", min: -180, max: 180 },
    { key: "rayon_km", label: "Rayon autorisé", kind: "nombre", unit: "km", min: 1, max: 1000 },
  ],
  km_journalier: [
    { key: "seuil_km", label: "Plus de", kind: "nombre", unit: "km par jour", min: 10, max: 2000 },
    { key: "ecart_pct", label: "Ou au-dessus de l'habitude de", kind: "nombre", unit: "%", min: 10, max: 1000 },
  ],
  moteur_ralenti: [{ key: "minutes", label: "Moteur allumé à l'arrêt plus de", kind: "nombre", unit: "min", min: 5, max: 600 }],
};

export const ALERT_GRAVITE_LABELS: Record<string, string> = { info: "Information", attention: "Attention", critique: "Critique" };

export const ALERT_RULE_LABELS: Record<string, string> = {
  exces_vitesse: "Excès de vitesse",
  hors_heures: "Hors heures de travail",
  traceur_muet: "Traceur muet",
  arret_prolonge: "Arrêt prolongé",
  sortie_zone: "Sortie de zone",
  km_journalier: "Kilométrage journalier",
  moteur_ralenti: "Moteur au ralenti",
};
