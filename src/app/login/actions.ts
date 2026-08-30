"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export type LoginState = {
  error?: string;
};

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Message volontairement générique : ne jamais confirmer si c'est
    // l'e-mail ou le mot de passe qui est incorrect (énumération de comptes).
    return { error: "Identifiants incorrects." };
  }

  redirect(safeRedirectTarget(formData.get("next")));
}

/**
 * Le proxy (`src/lib/supabase/proxy.ts`) redirige déjà vers `/login?next=...`
 * quand une page protégée est demandée sans session — par exemple en scannant
 * le QR code d'une fiche échantillon depuis un mobile (section 2.7/3.6 de
 * l'analyse). Cette fonction referme la boucle en renvoyant l'utilisateur
 * vers cette page d'origine après connexion, plutôt que systématiquement
 * vers `/dashboard`. Seul un chemin relatif interne est accepté (jamais une
 * URL absolue ni un chemin protocol-relative `//`) pour éviter une
 * redirection ouverte vers un site tiers.
 */
function safeRedirectTarget(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
