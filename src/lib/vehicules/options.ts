import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface VehicleOption {
  id: string;
  label: string;
  /** Véhicule immobilisé (document bloquant expiré, panne, immobilisation) : non sélectionnable. */
  disabled?: boolean;
}

/**
 * Véhicules proposés dans Livraisons (tournées, planification d'une
 * expédition) : ceux affectés à la livraison d'abord, puis les autres ; un
 * véhicule immobilisé reste visible, grisé, avec sa raison (la base refuse de
 * toute façon de l'affecter, 0169).
 */
export async function loadDeliveryVehicleOptions(): Promise<VehicleOption[]> {
  const supabase = await createClient();
  const [{ data: vehicles }, { data: blocages }] = await Promise.all([
    supabase.from("vehicles").select("id,libelle,immatriculation,usage,statut").eq("actif", true).neq("statut", "vendu").order("libelle"),
    supabase.rpc("vehicles_blocking_reasons"),
  ]);
  const reason = new Map(((blocages ?? []) as { vehicle_id: string; raison: string }[]).map((b) => [b.vehicle_id, b.raison]));
  return ((vehicles ?? []) as { id: string; libelle: string; immatriculation: string | null; usage: string | null }[])
    .sort((a, b) => Number(b.usage === "livraison") - Number(a.usage === "livraison"))
    .map((v) => {
      const r = reason.get(v.id);
      const label = [v.libelle, v.immatriculation].filter(Boolean).join(" · ");
      return { id: v.id, label: r ? `${label} (immobilisé : ${r})` : label, disabled: !!r };
    });
}
