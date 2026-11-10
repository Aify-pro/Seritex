import "server-only";
import { createClient } from "@/lib/supabase/server";
import { averageConsumption } from "./calculs";
import { loadAlerts, loadCostLines, loadFleet, loadVouchers } from "./data";
import { DOCUMENT_STATUT_LABELS, FINE_STATUT_LABELS, INCIDENT_STATUT_LABELS, VEHICLE_USAGE_LABELS, vehicleLabel } from "./labels";

/**
 * Export du suivi des véhicules pour une IA (D6) : sur une période, un
 * rapport Markdown (ou texte) complet, ou un CSV par jeu de données. Le
 * fichier est fait pour être confié tel quel à une IA qui en tire un rapport ;
 * plus tard, un agent lira directement ces données.
 */

export type ExportFormat = "md" | "txt" | "csv";
export type ExportJeu = "synthese" | "bons" | "km_jours" | "alertes";

const fr = (n: number, d = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n).replace(/ | /g, " ");
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | null)[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\n") + "\n";
const mdTable = (head: string[], rows: (string | number)[][]) =>
  rows.length === 0
    ? "_Aucune donnée._\n"
    : [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "/")).join(" | ")} |`)].join("\n") + "\n";

export async function buildVehicleExport(opts: { du: string; au: string; format: ExportFormat; jeu: ExportJeu }): Promise<{ body: string; filename: string; contentType: string }> {
  const { du, au } = opts;
  const auFin = `${au}T23:59:59Z`;
  const supabase = await createClient();
  const fleet = (await loadFleet()).filter((v) => v.statut !== "vendu" || v.actif);
  const [vouchersAll, costs, alerts, { data: gpsDays }, { data: events }, { data: incidents }, { data: fines }] = await Promise.all([
    loadVouchers(),
    loadCostLines(du),
    loadAlerts(fleet),
    supabase.from("vehicle_gps_days").select("vehicle_id,jour,km,roulage_s,vitesse_max,trajets").gte("jour", du).lte("jour", au).order("jour"),
    supabase
      .from("vehicle_alert_events")
      .select("vehicle_id,rule_code,survenue_le,message,statut,commentaire,vehicle_alert_rules(libelle,gravite)")
      .gte("survenue_le", `${du}T00:00:00Z`)
      .lte("survenue_le", auFin)
      .order("survenue_le"),
    supabase.from("vehicle_incidents").select("vehicle_id,survenu_le,lieu,description,statut,cout_reel,rembourse").gte("survenu_le", `${du}T00:00:00Z`).lte("survenu_le", auFin),
    supabase.from("vehicle_fines").select("vehicle_id,commise_le,motif,montant,statut,lieu").gte("commise_le", `${du}T00:00:00Z`).lte("commise_le", auFin),
  ]);
  const name = (id: string) => {
    const v = fleet.find((x) => x.id === id);
    return v ? vehicleLabel(v) : id;
  };
  const vouchers = vouchersAll.filter((b) => {
    const d = day(b.date_plein ?? b.demande_le);
    return d >= du && d <= au;
  });
  const days = (gpsDays ?? []) as { vehicle_id: string; jour: string; km: number | null; roulage_s: number; vitesse_max: number | null; trajets: number }[];
  const ev = (events ?? []) as unknown as {
    vehicle_id: string;
    rule_code: string;
    survenue_le: string;
    message: string;
    statut: string;
    commentaire: string | null;
    vehicle_alert_rules: { libelle: string; gravite: string } | null;
  }[];
  const costLines = costs.filter((c) => c.date <= au);

  const synthese = fleet.map((v) => {
    const own = vouchers.filter((b) => b.vehicle_id === v.id && b.statut === "justifie");
    const fills = own.map((b) => ({ id: b.id, datePlein: b.date_plein!, litres: b.litres!, montant: b.montant_reel!, km: b.km_plein! }));
    const conso = averageConsumption(own.map((b) => b.analysis).filter((a): a is NonNullable<typeof a> => !!a), fills);
    const kmGps = days.filter((d) => d.vehicle_id === v.id).reduce((s, d) => s + Number(d.km ?? 0), 0);
    const cout = (nature?: string) => costLines.filter((c) => c.vehicleId === v.id && (!nature || c.nature === nature)).reduce((s, c) => s + c.montant, 0);
    return {
      v,
      kmGps: v.freetrack_device_id ? Math.round(kmGps) : null,
      pleins: own.length,
      litres: own.reduce((s, b) => s + (b.litres ?? 0), 0),
      carburant: cout("carburant"),
      conso,
      ecarts: own.reduce((s, b) => s + (b.analysis?.anomalies.length ?? 0), 0),
      alertesGps: ev.filter((e) => e.vehicle_id === v.id).length,
      total: cout(),
    };
  });

  const stamp = `${du}_${au}`;
  if (opts.format === "csv") {
    let rows: (string | number | null)[][];
    if (opts.jeu === "bons") {
      rows = [
        ["numero", "vehicule", "statut", "demande_le", "date_plein", "beneficiaire", "montant_bon", "montant_ticket", "litres", "km_compteur", "km_depuis_plein_precedent", "km_gps", "l_100km", "prix_litre", "distance_station_m", "ecarts"],
        ...vouchers.map((b) => [
          b.numero,
          name(b.vehicle_id),
          b.statut,
          day(b.demande_le),
          b.date_plein ?? "",
          b.beneficiaire,
          b.montant_demande,
          b.montant_reel,
          b.litres,
          b.km_plein,
          b.analysis?.kmParcourus ?? null,
          b.gps_km,
          b.analysis?.consommation ?? null,
          b.analysis?.prixLitre ?? null,
          b.gps_distance_station_m,
          (b.analysis?.anomalies ?? []).map((a) => a.message).join(" / "),
        ]),
      ];
    } else if (opts.jeu === "km_jours") {
      rows = [["vehicule", "jour", "km_gps", "roulage_minutes", "vitesse_max", "trajets"], ...days.map((d) => [name(d.vehicle_id), d.jour, Number(d.km ?? 0), Math.round(d.roulage_s / 60), d.vitesse_max, d.trajets])];
    } else if (opts.jeu === "alertes") {
      rows = [
        ["vehicule", "date", "regle", "gravite", "message", "statut", "suite_donnee"],
        ...ev.map((e) => [name(e.vehicle_id), e.survenue_le, e.vehicle_alert_rules?.libelle ?? e.rule_code, e.vehicle_alert_rules?.gravite ?? "", e.message, e.statut, e.commentaire]),
      ];
    } else {
      rows = [
        ["vehicule", "usage", "chauffeur", "km_gps", "pleins", "litres", "carburant_fcfa", "l_100km", "ecarts_carburant", "alertes_gps", "cout_total_fcfa"],
        ...synthese.map((s) => [
          vehicleLabel(s.v),
          s.v.usage ? VEHICLE_USAGE_LABELS[s.v.usage] : "",
          s.v.titulaire?.nom ?? "",
          s.kmGps,
          s.pleins,
          Math.round(s.litres * 10) / 10,
          s.carburant,
          s.conso,
          s.ecarts,
          s.alertesGps,
          s.total,
        ]),
      ];
    }
    return { body: csv(rows), filename: `vehicules-${opts.jeu}-${stamp}.csv`, contentType: "text/csv; charset=utf-8" };
  }

  // Rapport complet (Markdown ; le texte en est la version sans balises).
  const parts: string[] = [];
  parts.push(`# Suivi des véhicules Seritex : du ${du} au ${au}\n`);
  parts.push(
    `Données extraites de Seritex le ${new Date().toISOString().slice(0, 16).replace("T", " ")} (heure d'Abidjan). Montants en FCFA. Km GPS : FreeTrack ; km compteur : relevés saisis (pleins, entretien).\n`
  );
  parts.push(`## Synthèse par véhicule\n`);
  parts.push(
    mdTable(
      ["Véhicule", "Usage", "Chauffeur", "Km GPS", "Pleins", "Litres", "Carburant", "L/100 km", "Écarts carburant", "Alertes GPS", "Coût total"],
      synthese.map((s) => [
        vehicleLabel(s.v),
        s.v.usage ? VEHICLE_USAGE_LABELS[s.v.usage] : "—",
        s.v.titulaire?.nom ?? "—",
        s.kmGps === null ? "non relié" : fr(s.kmGps),
        s.pleins,
        fr(s.litres, 1),
        fr(s.carburant),
        s.conso === null ? "—" : fr(s.conso, 1),
        s.ecarts,
        s.alertesGps,
        fr(s.total),
      ])
    )
  );
  parts.push(`\n## Bons de carburant et contrôles\n`);
  parts.push(
    mdTable(
      ["N°", "Véhicule", "Statut", "Plein", "Litres", "Montant", "Km compteur", "Km depuis le plein précédent", "Km GPS", "L/100 km", "Écarts"],
      vouchers.map((b) => [
        b.numero ?? "—",
        name(b.vehicle_id),
        b.statut,
        day(b.date_plein) || "—",
        b.litres ?? "—",
        fr(b.montant_reel ?? b.montant_demande),
        b.km_plein ?? "—",
        b.analysis?.kmParcourus ?? "—",
        b.gps_km ?? "—",
        b.analysis?.consommation ?? "—",
        (b.analysis?.anomalies ?? []).map((a) => a.message).join(" ; ") || "aucun",
      ])
    )
  );
  parts.push(`\n## Alertes GPS de la période\n`);
  parts.push(
    mdTable(
      ["Date", "Véhicule", "Règle", "Gravité", "Détail", "Suite donnée"],
      ev.map((e) => [e.survenue_le.slice(0, 16).replace("T", " "), name(e.vehicle_id), e.vehicle_alert_rules?.libelle ?? e.rule_code, e.vehicle_alert_rules?.gravite ?? "", e.message, e.commentaire ?? e.statut])
    )
  );
  parts.push(`\n## Kilomètres GPS par jour\n`);
  parts.push(mdTable(["Jour", "Véhicule", "Km", "Roulage (min)", "Vitesse max"], days.map((d) => [d.jour, name(d.vehicle_id), fr(Number(d.km ?? 0), 1), Math.round(d.roulage_s / 60), d.vitesse_max ?? "—"])));
  parts.push(`\n## Papiers, entretien, pannes et bons en attente (à ce jour)\n`);
  parts.push(mdTable(["Véhicule", "Point", "Détail"], alerts.map((a) => [a.vehicule, a.titre, a.detail])));
  parts.push(`\n## Documents des véhicules (état à ce jour)\n`);
  parts.push(
    mdTable(
      ["Véhicule", "Document", "Bloquant", "État", "Expire le"],
      fleet.flatMap((v) => v.compliance.map((c) => [vehicleLabel(v), c.libelle, c.bloquant ? "oui" : "non", DOCUMENT_STATUT_LABELS[c.statut], c.date_fin ?? "—"]))
    )
  );
  const inc = (incidents ?? []) as { vehicle_id: string; survenu_le: string; lieu: string | null; description: string; statut: string; cout_reel: number | null; rembourse: number | null }[];
  const fin = (fines ?? []) as { vehicle_id: string; commise_le: string; motif: string; montant: number; statut: string; lieu: string | null }[];
  parts.push(`\n## Sinistres\n`);
  parts.push(
    mdTable(
      ["Date", "Véhicule", "Lieu", "Description", "Étape", "Coût net"],
      inc.map((i) => [day(i.survenu_le), name(i.vehicle_id), i.lieu ?? "—", i.description, INCIDENT_STATUT_LABELS[i.statut], fr(Number(i.cout_reel ?? 0) - Number(i.rembourse ?? 0))])
    )
  );
  parts.push(`\n## Amendes\n`);
  parts.push(mdTable(["Date", "Véhicule", "Motif", "Lieu", "Montant", "Paiement"], fin.map((f) => [f.commise_le.slice(0, 16).replace("T", " "), name(f.vehicle_id), f.motif, f.lieu ?? "—", fr(Number(f.montant)), FINE_STATUT_LABELS[f.statut]])));
  parts.push(
    `\n## Consigne suggérée pour l'IA\n\nAnalyse ces données de flotte : repère les véhicules dont la consommation, les écarts entre compteur et GPS, les pleins loin des stations ou les alertes (vitesse, hors heures, arrêts prolongés) sont anormaux ; classe les risques (fraude au carburant, conduite, papiers, entretien) et propose des actions concrètes pour la logistique.\n`
  );
  const md = parts.join("\n");
  if (opts.format === "txt") {
    const txt = md.replace(/^#+\s*/gm, "").replace(/\|\s*---.*\|\n/g, "").replace(/_/g, "");
    return { body: txt, filename: `vehicules-rapport-${stamp}.txt`, contentType: "text/plain; charset=utf-8" };
  }
  return { body: md, filename: `vehicules-rapport-${stamp}.md`, contentType: "text/markdown; charset=utf-8" };
}
