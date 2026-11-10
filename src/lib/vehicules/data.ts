import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VehicleType } from "@/lib/types/domain";
import { maintenanceDue, type MaintenanceDue, type ServiceType } from "./calculs";
import type { DocumentStatut, VehicleEnergie, VehicleStatut, VehicleUsage } from "./labels";

/**
 * Chargement des données du module Véhicules (lecture sous l'identité de
 * l'utilisateur : la RLS de 0168-0172 fait foi). Le parc est petit (une
 * dizaine de véhicules) : on charge tout, puis on calcule en mémoire.
 */

export interface VehicleRow {
  id: string;
  type: VehicleType;
  libelle: string;
  immatriculation: string | null;
  marque: string | null;
  modele: string | null;
  annee: number | null;
  couleur: string | null;
  numero_chassis: string | null;
  carte_grise_numero: string | null;
  date_mise_circulation: string | null;
  energie: VehicleEnergie | null;
  reservoir_litres: number | null;
  statut: VehicleStatut;
  usage: VehicleUsage | null;
  photo_path: string | null;
  freetrack_device_id: number | null;
  capacite_note: string | null;
  notes: string | null;
  actif: boolean;
}

export interface ComplianceRow {
  vehicle_id: string;
  type_id: string;
  code: string;
  libelle: string;
  bloquant: boolean;
  obligatoire: boolean;
  document_id: string | null;
  date_fin: string | null;
  jours_restants: number | null;
  statut: DocumentStatut;
}

export interface EmployeRef {
  id: string;
  matricule: string;
  nom: string;
  fonction: string | null;
  statut: string;
}

export interface FleetVehicle extends VehicleRow {
  compliance: ComplianceRow[];
  blocage: string | null;
  kmActuel: number | null;
  titulaire: EmployeRef | null;
  remplacant: EmployeRef | null;
  pannesOuvertes: number;
}

const VEHICLE_COLUMNS =
  "id,type,libelle,immatriculation,marque,modele,annee,couleur,numero_chassis,carte_grise_numero,date_mise_circulation,energie,reservoir_litres,statut,usage,photo_path,freetrack_device_id,capacite_note,notes,actif";

export async function loadAnnuaire(): Promise<Map<string, EmployeRef>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("vehicules_annuaire");
  return new Map(((data ?? []) as EmployeRef[]).map((e) => [e.id, e]));
}

/** Tout le parc, avec documents, immobilisation, compteur, chauffeur et pannes ouvertes. */
export async function loadFleet(options: { vehicleId?: string } = {}): Promise<FleetVehicle[]> {
  const supabase = await createClient();
  let vehiclesQuery = supabase.from("vehicles").select(VEHICLE_COLUMNS).order("libelle");
  if (options.vehicleId) vehiclesQuery = vehiclesQuery.eq("id", options.vehicleId);
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: vehicles }, { data: compliance }, { data: blocages }, { data: readings }, { data: assignments }, { data: issues }, annuaire] =
    await Promise.all([
      vehiclesQuery,
      supabase.rpc("vehicles_compliance_all"),
      supabase.rpc("vehicles_blocking_reasons"),
      supabase.from("vehicle_odometer_readings").select("vehicle_id,km,releve_le").order("releve_le", { ascending: false }),
      supabase.from("vehicle_assignments").select("vehicle_id,employe_id,type,debut,fin").lte("debut", today),
      supabase.from("vehicle_issues").select("vehicle_id").eq("statut", "ouverte"),
      loadAnnuaire(),
    ]);

  const kmBy = new Map<string, number>();
  for (const r of (readings ?? []) as { vehicle_id: string; km: number }[]) if (!kmBy.has(r.vehicle_id)) kmBy.set(r.vehicle_id, r.km);
  const blocageBy = new Map(((blocages ?? []) as { vehicle_id: string; raison: string }[]).map((b) => [b.vehicle_id, b.raison]));
  const current = ((assignments ?? []) as { vehicle_id: string; employe_id: string; type: string; debut: string; fin: string | null }[]).filter(
    (a) => !a.fin || a.fin >= today
  );

  return ((vehicles ?? []) as VehicleRow[]).map((v) => {
    const titulaireId = current.find((a) => a.vehicle_id === v.id && a.type === "titulaire")?.employe_id;
    const remplacantId = current
      .filter((a) => a.vehicle_id === v.id && a.type === "remplacement")
      .sort((a, b) => b.debut.localeCompare(a.debut))[0]?.employe_id;
    return {
      ...v,
      reservoir_litres: v.reservoir_litres === null ? null : Number(v.reservoir_litres),
      compliance: ((compliance ?? []) as ComplianceRow[]).filter((c) => c.vehicle_id === v.id),
      blocage: blocageBy.get(v.id) ?? null,
      kmActuel: kmBy.get(v.id) ?? null,
      titulaire: titulaireId ? (annuaire.get(titulaireId) ?? null) : null,
      remplacant: remplacantId ? (annuaire.get(remplacantId) ?? null) : null,
      pannesOuvertes: ((issues ?? []) as { vehicle_id: string }[]).filter((i) => i.vehicle_id === v.id).length,
    };
  });
}

export async function loadServiceTypes(): Promise<(ServiceType & { code: string; actif: boolean })[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle_service_types").select("id,code,libelle,intervalle_jours,intervalle_km,actif,ordre").order("ordre");
  return ((data ?? []) as { id: string; code: string; libelle: string; intervalle_jours: number | null; intervalle_km: number | null; actif: boolean }[]).map(
    (t) => ({ id: t.id, code: t.code, libelle: t.libelle, intervalleJours: t.intervalle_jours, intervalleKm: t.intervalle_km, actif: t.actif })
  );
}

/** Entretien dû, véhicule par véhicule. */
export async function loadMaintenanceDue(fleet: FleetVehicle[]): Promise<Map<string, MaintenanceDue[]>> {
  const supabase = await createClient();
  const [types, { data: services }] = await Promise.all([
    loadServiceTypes(),
    supabase.from("vehicle_services").select("vehicle_id,type_id,date_intervention,km"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (services ?? []) as { vehicle_id: string; type_id: string; date_intervention: string; km: number | null }[];
  return new Map(
    fleet.map((v) => [
      v.id,
      maintenanceDue(
        types.filter((t) => t.actif),
        rows.filter((s) => s.vehicle_id === v.id).map((s) => ({ typeId: s.type_id, date: s.date_intervention, km: s.km })),
        v.kmActuel,
        today
      ),
    ])
  );
}

/** Liens de lecture (1 h) pour des fichiers du bucket `vehicules`. */
export async function signedUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  if (list.length === 0) return new Map();
  const { data } = await createAdminClient().storage.from("vehicules").createSignedUrls(list, 3600);
  return new Map((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

// --- Alertes ------------------------------------------------------------------------

export type AlertGravite = "critique" | "attention";

export interface VehicleAlert {
  vehicleId: string;
  vehicule: string;
  nature: "immobilisation" | "document" | "entretien" | "panne" | "bon";
  gravite: AlertGravite;
  titre: string;
  detail: string;
  href: string;
}

/**
 * Alertes du parc, affichées dans Seritex (D3 : WhatsApp viendra plus tard) :
 * immobilisations, documents (préavis 30 j, urgence 7 j, réglables),
 * entretien dû, pannes ouvertes, bons en attente de validation.
 */
export async function loadAlerts(preloaded?: FleetVehicle[]): Promise<VehicleAlert[]> {
  const supabase = await createClient();
  const fleet = (preloaded ?? (await loadFleet())).filter((v) => v.actif && v.statut !== "vendu");
  const [due, { data: pendingVouchers }, { data: issues }] = await Promise.all([
    loadMaintenanceDue(fleet),
    supabase.from("fuel_vouchers").select("id,vehicle_id,montant_demande,demande_le").eq("statut", "demande"),
    supabase.from("vehicle_issues").select("id,vehicle_id,description,gravite,signale_le").eq("statut", "ouverte"),
  ]);
  const name = (v: FleetVehicle) => [v.libelle, v.immatriculation].filter(Boolean).join(" · ");
  const alerts: VehicleAlert[] = [];

  for (const v of fleet) {
    if (v.blocage) {
      alerts.push({
        vehicleId: v.id,
        vehicule: name(v),
        nature: "immobilisation",
        gravite: "critique",
        titre: "Véhicule immobilisé",
        detail: `${v.blocage.charAt(0).toUpperCase()}${v.blocage.slice(1)}. Ni tournée ni bon de carburant.`,
        href: `/vehicules/${v.id}`,
      });
    }
    for (const c of v.compliance) {
      if (!["expire", "urgent", "a_renouveler", "manquant"].includes(c.statut)) continue;
      const echeance = c.date_fin ? new Intl.DateTimeFormat("fr-FR").format(new Date(c.date_fin)) : null;
      const detail =
        c.statut === "manquant"
          ? "Aucun document saisi."
          : c.statut === "expire"
            ? `Expiré le ${echeance}${c.bloquant ? " : document bloquant." : " (non bloquant)."}`
            : `Expire le ${echeance} (dans ${c.jours_restants} j)${c.bloquant ? " : bloquant à l'échéance." : "."}`;
      alerts.push({
        vehicleId: v.id,
        vehicule: name(v),
        nature: "document",
        gravite: c.statut === "expire" || c.statut === "urgent" ? "critique" : "attention",
        titre: c.statut === "manquant" ? `${c.libelle} à saisir` : `${c.libelle} ${c.statut === "expire" ? "expirée" : "à renouveler"}`,
        detail,
        href: `/vehicules/${v.id}?onglet=documents`,
      });
    }
    for (const m of due.get(v.id) ?? []) {
      if (m.statut === "a_jour") continue;
      const parts = [
        m.echeanceDate ? `le ${new Intl.DateTimeFormat("fr-FR").format(new Date(m.echeanceDate))}` : null,
        m.echeanceKm !== null ? `à ${new Intl.NumberFormat("fr-FR").format(m.echeanceKm)} km` : null,
      ].filter(Boolean);
      alerts.push({
        vehicleId: v.id,
        vehicule: name(v),
        nature: "entretien",
        gravite: m.statut === "en_retard" ? "critique" : "attention",
        titre: `${m.libelle} ${m.statut === "en_retard" ? "en retard" : "à prévoir"}`,
        detail: `Prévue ${parts.join(" ou ")} (au premier atteint).`,
        href: `/vehicules/${v.id}?onglet=entretien`,
      });
    }
  }
  for (const i of (issues ?? []) as { id: string; vehicle_id: string; description: string; gravite: string }[]) {
    const v = fleet.find((x) => x.id === i.vehicle_id);
    if (!v) continue;
    alerts.push({
      vehicleId: v.id,
      vehicule: name(v),
      nature: "panne",
      gravite: i.gravite === "immobilisante" ? "critique" : "attention",
      titre: i.gravite === "immobilisante" ? "Panne immobilisante" : "Panne signalée",
      detail: i.description,
      href: `/vehicules/${v.id}?onglet=entretien`,
    });
  }
  for (const b of (pendingVouchers ?? []) as { id: string; vehicle_id: string; montant_demande: number }[]) {
    const v = fleet.find((x) => x.id === b.vehicle_id);
    alerts.push({
      vehicleId: b.vehicle_id,
      vehicule: v ? name(v) : "—",
      nature: "bon",
      gravite: "attention",
      titre: "Bon de carburant à valider",
      detail: `${new Intl.NumberFormat("fr-FR").format(Number(b.montant_demande))} FCFA demandés.`,
      href: `/vehicules/bons/${b.id}`,
    });
  }
  const order = { critique: 0, attention: 1 };
  return alerts.sort((a, b) => order[a.gravite] - order[b.gravite] || a.vehicule.localeCompare(b.vehicule));
}

// --- Bons de carburant -------------------------------------------------------------

export interface VoucherRow {
  id: string;
  numero: string | null;
  vehicle_id: string;
  beneficiaire_id: string | null;
  motif: string | null;
  montant_demande: number;
  km_demande: number | null;
  station_id: string | null;
  statut: import("./labels").FuelVoucherStatut;
  demande_le: string;
  valide_le: string | null;
  refus_motif: string | null;
  date_plein: string | null;
  montant_reel: number | null;
  litres: number | null;
  km_plein: number | null;
  ticket_path: string | null;
  annule_motif: string | null;
  demandeur: string | null;
  validateur: string | null;
}

export interface VoucherWithAnalysis extends VoucherRow {
  beneficiaire: string | null;
  station: string | null;
  analysis: import("./calculs").FuelFillAnalysis | null;
}

const VOUCHER_COLUMNS =
  "id,numero,vehicle_id,beneficiaire_id,motif,montant_demande,km_demande,station_id,statut,demande_le,valide_le,refus_motif,date_plein,montant_reel,litres,km_plein,ticket_path,annule_motif,demandeur:app_users!fuel_vouchers_demande_par_fkey(full_name),validateur:app_users!fuel_vouchers_valide_par_fkey(full_name)";

/**
 * Bons de carburant, avec pour les bons justifiés la distance depuis le plein
 * précédent du même véhicule, la consommation et les contrôles (VEH-3 ; le
 * rapprochement avec le GPS viendra avec FreeTrack, VEH-9).
 */
export async function loadVouchers(options: { vehicleId?: string; id?: string } = {}): Promise<VoucherWithAnalysis[]> {
  const supabase = await createClient();
  let query = supabase.from("fuel_vouchers").select(VOUCHER_COLUMNS).order("demande_le", { ascending: false }).limit(1000);
  if (options.vehicleId) query = query.eq("vehicle_id", options.vehicleId);
  if (options.id) query = query.eq("id", options.id);
  const [{ data: rows }, annuaire, { data: stations }] = await Promise.all([query, loadAnnuaire(), supabase.from("fuel_stations").select("id,nom")]);
  const vouchers = ((rows ?? []) as unknown as (Omit<VoucherRow, "demandeur" | "validateur"> & {
    demandeur: { full_name: string } | null;
    validateur: { full_name: string } | null;
  })[]).map((r) => ({
    ...r,
    montant_demande: Number(r.montant_demande),
    montant_reel: r.montant_reel === null ? null : Number(r.montant_reel),
    litres: r.litres === null ? null : Number(r.litres),
    demandeur: r.demandeur?.full_name ?? null,
    validateur: r.validateur?.full_name ?? null,
  }));

  // L'analyse d'un plein a besoin de TOUS les pleins justifiés du véhicule.
  const vehicleIds = [...new Set(vouchers.filter((v) => v.statut === "justifie").map((v) => v.vehicle_id))];
  const analyses = new Map<string, import("./calculs").FuelFillAnalysis>();
  if (vehicleIds.length > 0) {
    const { analyzeFuelFills } = await import("./calculs");
    const [{ data: fills }, { data: vehicles }, { data: prices }, { data: reglages }] = await Promise.all([
      supabase.from("fuel_vouchers").select("id,vehicle_id,date_plein,litres,montant_reel,km_plein").eq("statut", "justifie").in("vehicle_id", vehicleIds),
      supabase.from("vehicles").select("id,energie,reservoir_litres").in("id", vehicleIds),
      supabase.from("fuel_prices").select("energie,prix_litre,depuis"),
      supabase.from("vehicules_reglages").select("ecart_consommation_pct,ecart_prix_pct").maybeSingle(),
    ]);
    const priceList = ((prices ?? []) as { energie: "essence" | "gasoil"; prix_litre: number; depuis: string }[]).map((p) => ({
      energie: p.energie,
      prixLitre: Number(p.prix_litre),
      depuis: p.depuis,
    }));
    const settings = {
      ecartConsommationPct: reglages?.ecart_consommation_pct ?? 25,
      ecartPrixPct: reglages?.ecart_prix_pct ?? 10,
    };
    for (const vid of vehicleIds) {
      const veh = ((vehicles ?? []) as { id: string; energie: string | null; reservoir_litres: number | null }[]).find((x) => x.id === vid);
      const list = ((fills ?? []) as { id: string; vehicle_id: string; date_plein: string; litres: number; montant_reel: number; km_plein: number }[])
        .filter((f) => f.vehicle_id === vid)
        .map((f) => ({ id: f.id, datePlein: f.date_plein, litres: Number(f.litres), montant: Number(f.montant_reel), km: f.km_plein }));
      for (const a of analyzeFuelFills(
        list,
        { energie: veh?.energie ?? null, reservoirLitres: veh?.reservoir_litres == null ? null : Number(veh.reservoir_litres) },
        priceList,
        settings
      )) {
        analyses.set(a.id, a);
      }
    }
  }
  const stationBy = new Map(((stations ?? []) as { id: string; nom: string }[]).map((s) => [s.id, s.nom]));
  return vouchers.map((v) => ({
    ...v,
    beneficiaire: v.beneficiaire_id ? (annuaire.get(v.beneficiaire_id)?.nom ?? null) : null,
    station: v.station_id ? (stationBy.get(v.station_id) ?? null) : null,
    analysis: analyses.get(v.id) ?? null,
  }));
}

// --- Coûts ---------------------------------------------------------------------------

/** Lignes de coût (carburant justifié, entretien, documents) depuis une date. */
export async function loadCostLines(since: string, vehicleId?: string) {
  const supabase = await createClient();
  let fuelQ = supabase.from("fuel_vouchers").select("vehicle_id,date_plein,montant_reel").eq("statut", "justifie").gte("date_plein", since);
  let servicesQ = supabase.from("vehicle_services").select("vehicle_id,date_intervention,cout").gte("date_intervention", since);
  let documentsQ = supabase.from("vehicle_documents").select("vehicle_id,date_debut,created_at,montant");
  if (vehicleId) {
    fuelQ = fuelQ.eq("vehicle_id", vehicleId);
    servicesQ = servicesQ.eq("vehicle_id", vehicleId);
    documentsQ = documentsQ.eq("vehicle_id", vehicleId);
  }
  const [{ data: fuel }, { data: services }, { data: documents }] = await Promise.all([fuelQ, servicesQ, documentsQ]);
  type Line = import("./calculs").CostLine & { vehicleId: string };
  const lines: Line[] = [];
  for (const r of (fuel ?? []) as { vehicle_id: string; date_plein: string; montant_reel: number }[]) {
    lines.push({ vehicleId: r.vehicle_id, date: r.date_plein.slice(0, 10), montant: Number(r.montant_reel), nature: "carburant" });
  }
  for (const r of (services ?? []) as { vehicle_id: string; date_intervention: string; cout: number | null }[]) {
    if (r.cout) lines.push({ vehicleId: r.vehicle_id, date: r.date_intervention, montant: Number(r.cout), nature: "entretien" });
  }
  for (const r of (documents ?? []) as { vehicle_id: string; date_debut: string | null; created_at: string; montant: number | null }[]) {
    // Un document compte à sa date de début (à défaut, sa date de saisie).
    const date = r.date_debut ?? r.created_at.slice(0, 10);
    if (r.montant && date >= since) lines.push({ vehicleId: r.vehicle_id, date, montant: Number(r.montant), nature: "documents" });
  }
  return lines;
}

/** Kilomètres parcourus par véhicule depuis une date (écart entre relevés de compteur). */
export async function loadKmSince(since: string): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("vehicle_odometer_readings").select("vehicle_id,km,releve_le").order("releve_le");
  const rows = (data ?? []) as { vehicle_id: string; km: number; releve_le: string }[];
  const out = new Map<string, number>();
  for (const vid of new Set(rows.map((r) => r.vehicle_id))) {
    const all = rows.filter((r) => r.vehicle_id === vid);
    const before = all.filter((r) => r.releve_le.slice(0, 10) < since).at(-1);
    const after = all.filter((r) => r.releve_le.slice(0, 10) >= since);
    const start = before?.km ?? after[0]?.km;
    const end = after.at(-1)?.km;
    if (start !== undefined && end !== undefined && end > start) out.set(vid, end - start);
  }
  return out;
}
