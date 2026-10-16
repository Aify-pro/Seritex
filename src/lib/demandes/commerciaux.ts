import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Personnel actif auquel une demande ou un devis peut être attribué (liste des menus « Commercial » / « Créé par »). */
export async function listeCommerciaux(): Promise<{ id: string; nom: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("id,full_name").neq("role", "client").eq("active", true).order("full_name");
  return (data ?? []).map((u) => ({ id: u.id as string, nom: u.full_name as string }));
}
