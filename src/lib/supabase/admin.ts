import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase "service_role" — contourne totalement la RLS.
 *
 * Interdiction stricte : ne jamais importer ce module depuis un composant
 * client, une route publique, ou tout code atteignable sans vérification de
 * rôle explicite au préalable. Réservé aux tâches d'administration serveur
 * (ex. future synchronisation du miroir de stock Sage). Le seed de
 * démonstration (scripts/seed.ts) utilise sa propre instance, hors app Next.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant : client admin indisponible.");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
