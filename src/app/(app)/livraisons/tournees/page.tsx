import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { RoundBoard, type Candidate, type RoundView } from "./round-board";

/** Tournées du jour (LIV-2) : composition par le responsable livraison. */
export default async function RoundsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePermission("livraisons", "modify");
  const { date: dateParam } = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam ?? "") ? dateParam! : new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Abidjan" });
  const supabase = await createClient();

  const [{ data: rounds }, { data: candidates }, { data: livreurs }, { data: vehicles }] = await Promise.all([
    supabase
      .from("delivery_rounds")
      .select(
        "id,statut,livreur:app_users!delivery_rounds_livreur_id_fkey(full_name),vehicles(libelle),delivery_round_stops(id,ordre,shipment_id,shipments(reference,client_nom,lieu_libelle,lieu_zone,lieu_latitude,lieu_longitude,shipment_lines(quantite)))"
      )
      .eq("date", date)
      .order("created_at"),
    supabase
      .from("shipments")
      .select("id,reference,client_nom,lieu_zone,shipment_lines(quantite),delivery_round_stops(id)")
      .eq("mode", "livraison")
      .in("statut", ["validee_compta", "planifiee"]),
    supabase.from("app_users").select("id,full_name").eq("role", "livreur").eq("active", true).order("full_name"),
    supabase.from("vehicles").select("id,libelle,immatriculation").eq("actif", true).order("libelle"),
  ]);

  const roundViews: RoundView[] = (rounds ?? []).map((r) => ({
    id: r.id,
    livreur: (r.livreur as unknown as { full_name: string } | null)?.full_name ?? "Livreur",
    vehicule: (r.vehicles as unknown as { libelle: string } | null)?.libelle ?? null,
    statut: r.statut,
    stops: (
      (r.delivery_round_stops ?? []) as unknown as {
        id: string;
        ordre: number;
        shipment_id: string;
        shipments: { reference: string | null; client_nom: string | null; lieu_libelle: string | null; lieu_zone: string | null; lieu_latitude: number | null; lieu_longitude: number | null; shipment_lines: { quantite: number }[] } | null;
      }[]
    )
      .sort((a, b) => a.ordre - b.ordre)
      .map((s) => ({
        id: s.id,
        shipmentId: s.shipment_id,
        reference: s.shipments?.reference ?? null,
        client: s.shipments?.client_nom ?? "Client",
        lieu: s.shipments?.lieu_libelle ?? null,
        zone: s.shipments?.lieu_zone ?? null,
        lat: s.shipments?.lieu_latitude != null ? Number(s.shipments.lieu_latitude) : null,
        lng: s.shipments?.lieu_longitude != null ? Number(s.shipments.lieu_longitude) : null,
        pieces: (s.shipments?.shipment_lines ?? []).reduce((t, l) => t + l.quantite, 0),
      })),
  }));

  const candidateViews: Candidate[] = (candidates ?? [])
    .filter((c) => ((c.delivery_round_stops ?? []) as unknown[]).length === 0)
    .map((c) => ({
      id: c.id,
      reference: c.reference,
      client: c.client_nom ?? "Client",
      zone: c.lieu_zone,
      pieces: ((c.shipment_lines ?? []) as { quantite: number }[]).reduce((t, l) => t + l.quantite, 0),
    }))
    .sort((a, b) => (a.zone ?? "").localeCompare(b.zone ?? "", "fr"));

  return (
    <div className="space-y-6">
      <Link href="/livraisons?onglet=a_planifier" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Livraisons
      </Link>
      <PageHeader
        title="Tournées"
        description="Une tournée par livreur et par jour ; les livraisons validées par la comptabilité s'y ajoutent dans l'ordre de passage."
        action={
          <form method="get">
            <input type="date" name="date" defaultValue={date} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" />
            <button type="submit" className="ml-2 h-9 rounded-md border border-border px-3 text-sm">
              Afficher
            </button>
          </form>
        }
      />
      <RoundBoard
        date={date}
        rounds={roundViews}
        candidates={candidateViews}
        livreurs={(livreurs ?? []).map((l) => ({ id: l.id, label: l.full_name }))}
        vehicles={(vehicles ?? []).map((v) => ({ id: v.id, label: [v.libelle, v.immatriculation].filter(Boolean).join(" · ") }))}
      />
    </div>
  );
}
