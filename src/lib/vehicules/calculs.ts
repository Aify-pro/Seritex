/**
 * Calculs du module Véhicules, sans accès à la base (testés par
 * scripts/test-vehicules.ts) :
 *   - consommation et contrôles d'un plein (bons de carburant justifiés) ;
 *   - entretien dû (au premier atteint : date ou kilométrage) ;
 *   - coûts par mois (carburant, entretien, documents).
 */

// --- Carburant ------------------------------------------------------------------

export interface FuelFill {
  id: string;
  datePlein: string;
  litres: number;
  montant: number;
  km: number;
}

export interface FuelPrice {
  energie: "essence" | "gasoil";
  prixLitre: number;
  depuis: string;
}

export interface FuelCheckSettings {
  ecartConsommationPct: number;
  ecartPrixPct: number;
}

export interface FuelAnomaly {
  code: "compteur_recule" | "plein_sans_rouler" | "litres_reservoir" | "prix_litre" | "consommation";
  message: string;
}

export interface FuelFillAnalysis {
  id: string;
  kmParcourus: number | null;
  /** Litres aux 100 km, méthode plein à plein : les litres de ce plein couvrent la distance depuis le précédent. */
  consommation: number | null;
  prixLitre: number;
  anomalies: FuelAnomaly[];
}

/** En dessous, un plein est suspect : le véhicule n'a presque pas roulé depuis le précédent. */
export const KM_MINIMUM_ENTRE_PLEINS = 20;

const round1 = (n: number) => Math.round(n * 10) / 10;

function prixDuJour(prices: FuelPrice[], energie: string | null, date: string): number | null {
  if (energie !== "essence" && energie !== "gasoil") return null;
  const jour = date.slice(0, 10);
  const candidats = prices.filter((p) => p.energie === energie && p.depuis <= jour).sort((a, b) => b.depuis.localeCompare(a.depuis));
  return candidats[0]?.prixLitre ?? null;
}

function mediane(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Analyse les pleins justifiés d'UN véhicule (dans n'importe quel ordre) et
 * renvoie, par plein, la distance parcourue, la consommation et les écarts.
 */
export function analyzeFuelFills(
  fills: FuelFill[],
  vehicle: { energie: string | null; reservoirLitres: number | null },
  prices: FuelPrice[],
  settings: FuelCheckSettings
): FuelFillAnalysis[] {
  const ordered = [...fills].sort((a, b) => a.datePlein.localeCompare(b.datePlein));
  const base = ordered.map((f, i) => {
    const prev = i > 0 ? ordered[i - 1] : null;
    const kmParcourus = prev ? f.km - prev.km : null;
    const consommation = kmParcourus !== null && kmParcourus >= KM_MINIMUM_ENTRE_PLEINS ? round1((f.litres / kmParcourus) * 100) : null;
    return { fill: f, kmParcourus, consommation };
  });

  return base.map(({ fill, kmParcourus, consommation }) => {
    const anomalies: FuelAnomaly[] = [];
    const prixLitre = Math.round(fill.montant / fill.litres);

    if (kmParcourus !== null && kmParcourus < 0) {
      anomalies.push({ code: "compteur_recule", message: `Compteur plus bas qu'au plein précédent (${kmParcourus} km).` });
    } else if (kmParcourus !== null && kmParcourus < KM_MINIMUM_ENTRE_PLEINS) {
      anomalies.push({ code: "plein_sans_rouler", message: `Seulement ${kmParcourus} km depuis le plein précédent.` });
    }

    if (vehicle.reservoirLitres && fill.litres > vehicle.reservoirLitres * 1.05) {
      anomalies.push({
        code: "litres_reservoir",
        message: `${fill.litres} L servis pour un réservoir de ${vehicle.reservoirLitres} L.`,
      });
    }

    const reference = prixDuJour(prices, vehicle.energie, fill.datePlein);
    if (reference && Math.abs(prixLitre - reference) / reference > settings.ecartPrixPct / 100) {
      anomalies.push({ code: "prix_litre", message: `Prix au litre de ${prixLitre} FCFA pour un prix officiel de ${reference} FCFA.` });
    }

    if (consommation !== null) {
      // Référence : médiane des AUTRES pleins du véhicule (au moins deux), pour
      // qu'un plein anormal ne fausse pas sa propre comparaison.
      const autres = base.filter((b) => b.fill.id !== fill.id && b.consommation !== null).map((b) => b.consommation as number);
      const ref = autres.length >= 2 ? mediane(autres) : null;
      if (ref && Math.abs(consommation - ref) / ref > settings.ecartConsommationPct / 100) {
        anomalies.push({
          code: "consommation",
          message: `${consommation} L/100 km pour une consommation habituelle de ${round1(ref)} L/100 km.`,
        });
      }
    }

    return { id: fill.id, kmParcourus, consommation, prixLitre, anomalies };
  });
}

/** Consommation moyenne pondérée (total litres / total km) sur les pleins comparables. */
export function averageConsumption(analyses: FuelFillAnalysis[], fills: FuelFill[]): number | null {
  let litres = 0;
  let km = 0;
  for (const a of analyses) {
    if (a.consommation === null || a.kmParcourus === null) continue;
    const f = fills.find((x) => x.id === a.id);
    if (!f) continue;
    litres += f.litres;
    km += a.kmParcourus;
  }
  return km > 0 ? round1((litres / km) * 100) : null;
}

// --- Entretien ----------------------------------------------------------------------

export interface ServiceType {
  id: string;
  libelle: string;
  intervalleJours: number | null;
  intervalleKm: number | null;
}

export interface ServiceRecord {
  typeId: string;
  date: string;
  km: number | null;
}

export type MaintenanceStatus = "en_retard" | "bientot" | "a_jour";

export interface MaintenanceDue {
  typeId: string;
  libelle: string;
  derniereDate: string;
  dernierKm: number | null;
  echeanceDate: string | null;
  echeanceKm: number | null;
  joursRestants: number | null;
  kmRestants: number | null;
  statut: MaintenanceStatus;
}

/** Seuils du « bientôt » : 15 jours ou 500 km avant l'échéance. */
export const ENTRETIEN_PREAVIS_JOURS = 15;
export const ENTRETIEN_PREAVIS_KM = 500;

const DAY = 86_400_000;
const toDay = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Prochain entretien de chaque type périodique déjà fait au moins une fois :
 * dû au premier atteint de la date ou du kilométrage (règle de LubeLogger).
 * Un type jamais fait n'a pas de point de départ : il n'est pas listé.
 */
export function maintenanceDue(types: ServiceType[], services: ServiceRecord[], currentKm: number | null, today: string): MaintenanceDue[] {
  const out: MaintenanceDue[] = [];
  for (const t of types) {
    if (!t.intervalleJours && !t.intervalleKm) continue;
    const history = services.filter((s) => s.typeId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const last = history[0];
    if (!last) continue;
    const lastKm = history.find((s) => s.km !== null)?.km ?? null;
    const echeanceDate = t.intervalleJours ? fromDay(toDay(last.date) + t.intervalleJours * DAY) : null;
    const echeanceKm = t.intervalleKm && lastKm !== null ? lastKm + t.intervalleKm : null;
    const joursRestants = echeanceDate ? Math.round((toDay(echeanceDate) - toDay(today)) / DAY) : null;
    const kmRestants = echeanceKm !== null && currentKm !== null ? echeanceKm - currentKm : null;
    const enRetard = (joursRestants !== null && joursRestants < 0) || (kmRestants !== null && kmRestants <= 0);
    const bientot =
      (joursRestants !== null && joursRestants <= ENTRETIEN_PREAVIS_JOURS) || (kmRestants !== null && kmRestants <= ENTRETIEN_PREAVIS_KM);
    out.push({
      typeId: t.id,
      libelle: t.libelle,
      derniereDate: last.date,
      dernierKm: lastKm,
      echeanceDate,
      echeanceKm,
      joursRestants,
      kmRestants,
      statut: enRetard ? "en_retard" : bientot ? "bientot" : "a_jour",
    });
  }
  return out.sort((a, b) => ["en_retard", "bientot", "a_jour"].indexOf(a.statut) - ["en_retard", "bientot", "a_jour"].indexOf(b.statut));
}

// --- Coûts ----------------------------------------------------------------------------

export interface CostLine {
  date: string;
  montant: number;
  nature: "carburant" | "entretien" | "documents";
}

export interface MonthlyCost {
  mois: string;
  carburant: number;
  entretien: number;
  documents: number;
  total: number;
}

/** Coûts par mois (« 2026-11 »), du plus récent au plus ancien. */
export function monthlyCosts(lines: CostLine[]): MonthlyCost[] {
  const byMonth = new Map<string, MonthlyCost>();
  for (const l of lines) {
    if (!l.date || !(l.montant > 0)) continue;
    const mois = l.date.slice(0, 7);
    const row = byMonth.get(mois) ?? { mois, carburant: 0, entretien: 0, documents: 0, total: 0 };
    row[l.nature] += l.montant;
    row.total += l.montant;
    byMonth.set(mois, row);
  }
  return [...byMonth.values()].sort((a, b) => b.mois.localeCompare(a.mois));
}

/** Libellé d'un mois : « novembre 2026 ». */
export function formatMois(mois: string): string {
  const d = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)) - 1, 1));
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
