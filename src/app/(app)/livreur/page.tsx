import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { LivreurStops, type LivreurStop } from "./livreur-stops";
import type { ShipmentStatus } from "@/lib/delivery/status";

/**
 * Écran du livreur (L4, LIV-2) : uniquement SES livraisons (RLS), du jour ou
 * en retard, dans l'ordre de sa tournée. Pensé pour un téléphone.
 */
export default async function LivreurPage() {
  // Le livreur voit SES livraisons (RLS) ; le pilotage des expéditions peut aussi ouvrir l'écran.
  const { profile } = await requireUser();
  if (profile.role !== "livreur" && !(await can("livraisons", "modify"))) redirect("/dashboard?erreur=acces_refuse");
  const supabase = await createClient();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Abidjan" });

  const [{ data: shipments }, { data: rounds }] = await Promise.all([
    supabase
      .from("shipments")
      .select(
        "id,reference,statut,client_nom,delivery_place_id,lieu_libelle,lieu_zone,lieu_quartier,lieu_repere,lieu_contact_nom,lieu_contact_tel,lieu_horaires,lieu_consignes,lieu_latitude,lieu_longitude,reglement_mention,reglement_montant,date_planifiee,shipment_lines(quantite),shipment_packages(id),shipment_documents(type)"
      )
      .eq("livreur_id", profile.id)
      .in("statut", ["planifiee", "en_route", "echec"])
      .lte("date_planifiee", today),
    supabase
      .from("delivery_rounds")
      .select("id,statut,km_depart,delivery_round_stops(shipment_id,ordre)")
      .eq("livreur_id", profile.id)
      .eq("date", today)
      .limit(1),
  ]);
  const round = rounds?.[0] ?? null;
  const ordre = new Map(((round?.delivery_round_stops ?? []) as { shipment_id: string; ordre: number }[]).map((s) => [s.shipment_id, s.ordre]));

  const stops: LivreurStop[] = (shipments ?? [])
    .map((s) => ({
      id: s.id,
      reference: s.reference,
      statut: s.statut as ShipmentStatus,
      clientNom: s.client_nom ?? "Client",
      placeId: s.delivery_place_id,
      lieu: {
        libelle: s.lieu_libelle,
        zone: s.lieu_zone,
        quartier: s.lieu_quartier,
        repere: s.lieu_repere,
        contactNom: s.lieu_contact_nom,
        contactTel: s.lieu_contact_tel,
        horaires: s.lieu_horaires,
        consignes: s.lieu_consignes,
        latitude: s.lieu_latitude != null ? Number(s.lieu_latitude) : null,
        longitude: s.lieu_longitude != null ? Number(s.lieu_longitude) : null,
      },
      pieces: ((s.shipment_lines ?? []) as { quantite: number }[]).reduce((t, l) => t + l.quantite, 0),
      colis: (s.shipment_packages ?? []).length,
      aEncaisser: s.reglement_mention === "a_encaisser" ? Number(s.reglement_montant) : null,
      hasDecharge: ((s.shipment_documents ?? []) as { type: string }[]).some((d) => d.type === "decharge_bl"),
    }))
    .sort((a, b) => (ordre.get(a.id) ?? 999) - (ordre.get(b.id) ?? 999));

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Mes livraisons" description={new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(new Date())} />
      <LivreurStops
        stops={stops}
        round={round ? { id: round.id, statut: round.statut, kmDepart: round.km_depart } : null}
      />
    </div>
  );
}
