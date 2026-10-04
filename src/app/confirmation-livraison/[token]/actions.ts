"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyShipment } from "@/lib/delivery/notify";

/**
 * Réponse du client depuis le lien de confirmation (L8) — sans connexion.
 * La base vérifie le jeton (haché), son expiration et l'unicité de la
 * réponse ; « problème » passe la livraison en litige et alerte le service
 * livraison.
 */
export async function answerConfirmation(token: string, reponse: "confirme" | "probleme", commentaire: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("answer_shipment_confirmation", {
    p_token: token,
    p_reponse: reponse,
    p_commentaire: commentaire.trim() || null,
  });
  if (error) return { error: error.message };

  if (reponse === "probleme") {
    const hash = createHash("sha256").update(token).digest("hex");
    const { data } = await createAdminClient().from("shipment_confirmations").select("shipment_id").eq("token_hash", hash).maybeSingle();
    if (data?.shipment_id) {
      await notifyShipment("livraison_litige", data.shipment_id, { commentaire: commentaire.trim() }, { withoutSession: true });
    }
  }
  return {};
}
