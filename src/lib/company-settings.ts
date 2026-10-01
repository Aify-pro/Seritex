import { createClient } from "@/lib/supabase/server";
import type { CompanySettings } from "@/lib/types/domain";

/**
 * Fiche société de l'émetteur (migration 0061, ligne unique). Point d'entrée
 * unique pour tout document commercial ou administratif qui doit imprimer
 * l'identité de Seritex — proforma aujourd'hui, factures et bons demain.
 */
export async function getCompanySettings(): Promise<CompanySettings | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("company_settings").select("*").limit(1).maybeSingle();
  return (data as CompanySettings | null) ?? null;
}
