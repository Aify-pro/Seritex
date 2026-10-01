import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Cachet et signature à apposer sur un document établi par `userId`
 * (migration 0062). Lecture avec le client d'administration : ces tables sont
 * réservées à l'administrateur de plateforme, or le PDF doit pouvoir être
 * généré pour un client — l'appelant a déjà contrôlé l'accès au document.
 *
 * Retourne null si l'établisseur n'a pas de signature active, ou si les tables
 * n'existent pas encore (migration non appliquée) : le document sort alors
 * simplement sans signature, case vide à signer à la main.
 */
export interface DocumentSeal {
  signaturePng: Uint8Array;
  stampPng: Uint8Array | null;
  name: string;
  fonction: string | null;
}

export async function getDocumentSeal(userId: string | null | undefined): Promise<DocumentSeal | null> {
  if (!userId) return null;
  try {
    const admin = createAdminClient();
    const [{ data: sig }, { data: stamp }, { data: user }] = await Promise.all([
      admin.from("document_signatories").select("signature_png,fonction,active").eq("user_id", userId).maybeSingle(),
      admin.from("company_stamp").select("image_png").limit(1).maybeSingle(),
      admin.from("app_users").select("full_name").eq("id", userId).maybeSingle(),
    ]);
    if (!sig || !sig.active || !user) return null;
    return {
      signaturePng: Uint8Array.from(Buffer.from(sig.signature_png, "base64")),
      stampPng: stamp ? Uint8Array.from(Buffer.from(stamp.image_png, "base64")) : null,
      name: user.full_name,
      fonction: sig.fonction ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Habilitation à valider les devis (migration 0063) : avoir une signature
 * ACTIVE enregistrée. Lecture avec le client d'administration (tables réservées
 * à l'administrateur de plateforme) ; la règle est appliquée aussi en base par
 * is_quote_validator() — ce contrôle-ci sert à l'affichage et aux messages.
 */
export async function isQuoteValidator(userId: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient().from("document_signatories").select("user_id").eq("user_id", userId).eq("active", true).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/** Noms des personnes habilitées à valider (affichage informatif). */
export async function listQuoteValidatorNames(): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data: sigs } = await admin.from("document_signatories").select("user_id").eq("active", true);
    const ids = (sigs ?? []).map((r) => r.user_id);
    if (!ids.length) return [];
    const { data: users } = await admin.from("app_users").select("full_name").in("id", ids).eq("active", true).order("full_name");
    return (users ?? []).map((u) => u.full_name);
  } catch {
    return [];
  }
}
