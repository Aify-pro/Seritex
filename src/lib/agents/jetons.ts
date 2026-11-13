import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Jetons des agents IA (migration 0187). Le jeton n'est montré qu'une fois, à
 * la création ; la base n'en garde que l'empreinte SHA-256. Un agent agit au
 * nom de son PROPRIÉTAIRE et jamais au-delà de ses droits.
 */

export const PREFIXE_JETON = "stx_agent_";

export type DroitAgent = "lecture" | "calcul";

export interface AgentAuthentifie {
  id: string;
  nom: string;
  droits: DroitAgent[];
  proprietaire: string;
}

export function empreinteJeton(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

export function nouveauJeton(): { jeton: string; empreinte: string; prefixe: string } {
  const jeton = PREFIXE_JETON + randomBytes(24).toString("base64url");
  return { jeton, empreinte: empreinteJeton(jeton), prefixe: jeton.slice(0, PREFIXE_JETON.length + 4) };
}

/** Agent du jeton de la requête (Authorization: Bearer stx_agent_…), ou null. */
export async function authentifierAgent(req: Request): Promise<AgentAuthentifie | null> {
  const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jeton.startsWith(PREFIXE_JETON) || jeton.length < PREFIXE_JETON.length + 20 || jeton.length > 200) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("agents_ia")
    .select("id,nom,droits,proprietaire,actif,revoque_le,derniere_utilisation_le")
    .eq("empreinte_jeton", empreinteJeton(jeton))
    .maybeSingle();
  if (!data || !data.actif || data.revoque_le) return null;
  // Date de dernière utilisation : au plus une écriture par minute.
  const derniere = data.derniere_utilisation_le ? Date.parse(data.derniere_utilisation_le as string) : 0;
  if (Date.now() - derniere > 60_000) {
    await admin.from("agents_ia").update({ derniere_utilisation_le: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id as string, nom: data.nom as string, droits: data.droits as DroitAgent[], proprietaire: data.proprietaire as string };
}
