import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShipmentStatus, ReglementMention } from "@/lib/delivery/status";

/**
 * Lecture complète d'une expédition (LIV-1), pour sa fiche et son BL.
 * L'accès est contrôlé par la RLS de l'utilisateur sur `shipments`
 * (personnel, livreur affecté, client) ; une fois l'accès établi, le détail
 * des articles est lu avec le client d'administration — production_order_lines
 * n'est lisible que par la production et le commercial, or le livreur et la
 * comptabilité doivent voir ce qu'ils livrent ou valident.
 */
export interface ShipmentDetail {
  id: string;
  reference: string | null;
  statut: ShipmentStatus;
  mode: "livraison" | "retrait";
  origine: string;
  companyId: string;
  clientNom: string;
  productionOrderId: string | null;
  deliveryPlaceId: string | null;
  lieu: {
    libelle: string | null;
    zone: string | null;
    quartier: string | null;
    repere: string | null;
    latitude: number | null;
    longitude: number | null;
    contactNom: string | null;
    contactTel: string | null;
    horaires: string | null;
    consignes: string | null;
  };
  datePromise: string | null;
  datePlanifiee: string | null;
  carrierId: string | null;
  vehicleId: string | null;
  livreurId: string | null;
  livreurNom: string | null;
  reglement: { mention: ReglementMention | null; montant: number | null; texte: string | null; valideLe: string | null; validePar: string | null };
  livreeAt: string | null;
  receptionnaireNom: string | null;
  motifEchec: string | null;
  notes: string | null;
  preparedAt: string | null;
  preparedBy: string | null;
  createdAt: string;
  lines: {
    lineId: string;
    taille: string;
    tailleLibelle: string;
    ordre: number;
    quantite: number;
    quantiteLivree: number | null;
    designation: string;
    odfId: string;
    odfReference: string;
  }[];
  packages: { id: string; numero: number; poidsKg: number | null; dimensions: string | null; contenu: string | null; codeQr: string | null }[];
  events: { id: string; statut: string; auteur: string | null; occurredAt: string; source: string; commentaire: string | null }[];
}

export async function loadShipment(id: string): Promise<ShipmentDetail | null> {
  const supabase = await createClient();
  const { data: s } = await supabase.from("shipments").select("*").eq("id", id).maybeSingle();
  if (!s) return null;

  const admin = createAdminClient();
  const [{ data: lines }, { data: packages }, { data: events }] = await Promise.all([
    admin
      .from("shipment_lines")
      .select(
        "production_order_line_id,taille,quantite,quantite_livree,production_order_lines(description,production_order_id,product_models(name),production_orders(reference)),sizes!shipment_lines_taille_fkey(libelle,groupe,display_order)"
      )
      .eq("shipment_id", id),
    admin.from("shipment_packages").select("*").eq("shipment_id", id).order("numero"),
    admin.from("shipment_events").select("*").eq("shipment_id", id).order("occurred_at", { ascending: false }),
  ]);
  const userIds = [
    s.livreur_id,
    s.valide_compta_by,
    s.prepared_by,
    ...(events ?? []).map((e) => e.auteur as string | null),
  ].filter((v): v is string => !!v);
  const { data: users } = userIds.length ? await admin.from("app_users").select("id,full_name").in("id", userIds) : { data: [] };
  const nameOf = (uid: string | null) => (uid ? (users ?? []).find((u) => u.id === uid)?.full_name ?? null : null);

  return {
    id: s.id,
    reference: s.reference,
    statut: s.statut,
    mode: s.mode,
    origine: s.origine,
    companyId: s.company_id,
    clientNom: s.client_nom ?? "Client",
    productionOrderId: s.production_order_id,
    deliveryPlaceId: s.delivery_place_id,
    lieu: {
      libelle: s.lieu_libelle,
      zone: s.lieu_zone,
      quartier: s.lieu_quartier,
      repere: s.lieu_repere,
      latitude: s.lieu_latitude != null ? Number(s.lieu_latitude) : null,
      longitude: s.lieu_longitude != null ? Number(s.lieu_longitude) : null,
      contactNom: s.lieu_contact_nom,
      contactTel: s.lieu_contact_tel,
      horaires: s.lieu_horaires,
      consignes: s.lieu_consignes,
    },
    datePromise: s.date_promise,
    datePlanifiee: s.date_planifiee,
    carrierId: s.carrier_id,
    vehicleId: s.vehicle_id,
    livreurId: s.livreur_id,
    livreurNom: nameOf(s.livreur_id),
    reglement: {
      mention: s.reglement_mention,
      montant: s.reglement_montant != null ? Number(s.reglement_montant) : null,
      texte: s.reglement_texte,
      valideLe: s.valide_compta_at,
      validePar: nameOf(s.valide_compta_by),
    },
    livreeAt: s.livree_at,
    receptionnaireNom: s.receptionnaire_nom,
    motifEchec: s.motif_echec,
    notes: s.notes,
    preparedAt: s.prepared_at,
    preparedBy: s.prepared_by,
    createdAt: s.created_at,
    lines: (lines ?? [])
      .map((l) => {
        const pol = l.production_order_lines as unknown as {
          description: string;
          production_order_id: string;
          product_models: { name: string } | null;
          production_orders: { reference: string } | null;
        } | null;
        const size = l.sizes as unknown as { libelle: string; groupe: string; display_order: number } | null;
        return {
          lineId: l.production_order_line_id as string,
          taille: l.taille as string,
          tailleLibelle: size?.libelle ?? (l.taille as string).split("/").pop() ?? (l.taille as string),
          ordre: (size?.display_order ?? 0) + (size?.groupe ? size.groupe.charCodeAt(0) * 1000 : 0),
          quantite: l.quantite as number,
          quantiteLivree: (l.quantite_livree as number | null) ?? null,
          designation: pol?.description ?? pol?.product_models?.name ?? "Article",
          odfId: pol?.production_order_id ?? "",
          odfReference: pol?.production_orders?.reference ?? "",
        };
      })
      .sort((a, b) => a.designation.localeCompare(b.designation, "fr") || a.ordre - b.ordre),
    packages: (packages ?? []).map((p) => ({
      id: p.id,
      numero: p.numero,
      poidsKg: p.poids_kg != null ? Number(p.poids_kg) : null,
      dimensions: p.dimensions,
      contenu: p.contenu,
      codeQr: p.code_qr,
    })),
    events: (events ?? []).map((e) => ({
      id: e.id,
      statut: e.statut,
      auteur: nameOf(e.auteur),
      occurredAt: e.occurred_at,
      source: e.source,
      commentaire: e.commentaire,
    })),
  };
}

/** Lignes du BL : une par article, ses tailles dans l'ordre du référentiel. */
export function groupLinesByArticle(lines: ShipmentDetail["lines"]) {
  const byLine = new Map<string, { designation: string; odfReference: string; tailles: { libelle: string; quantite: number }[] }>();
  for (const l of lines) {
    const g = byLine.get(l.lineId) ?? { designation: l.designation, odfReference: l.odfReference, tailles: [] };
    g.tailles.push({ libelle: l.tailleLibelle, quantite: l.quantite });
    byLine.set(l.lineId, g);
  }
  return [...byLine.values()];
}
