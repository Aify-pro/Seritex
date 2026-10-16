import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Preset, PresetModule } from "./modules";

/** Préréglages visibles de l'utilisateur pour un module : les siens, puis ceux partagés par l'équipe. */
export async function chargerPresets(module: PresetModule): Promise<Preset[]> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id ?? null;
  const { data, error } = await supabase
    .from("filter_presets")
    .select("id,name,params,shared,owner_id,position,created_at,app_users(full_name)")
    .eq("module", module)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  // Migration 0134 pas encore appliquée : la liste fonctionne, sans préréglages.
  if (error || !data) return [];
  const rows = data.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    params: p.params as string,
    shared: p.shared as boolean,
    mine: p.owner_id === me,
    ownerName: (p.app_users as unknown as { full_name: string } | null)?.full_name ?? null,
  }));
  return [...rows.filter((p) => p.mine), ...rows.filter((p) => !p.mine)];
}
