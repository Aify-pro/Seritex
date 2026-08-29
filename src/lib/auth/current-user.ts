import { createClient } from "@/lib/supabase/server";
import type { AppUser } from "@/lib/types/domain";
import { redirect } from "next/navigation";

/**
 * Renvoie l'utilisateur Supabase Auth courant ainsi que son profil applicatif
 * (rôle, entreprise, section). Toute page/serveur qui a besoin de connaître
 * le rôle pour décider quoi afficher DOIT passer par cette fonction plutôt
 * que de faire confiance à un état côté client — l'UI n'est qu'un confort,
 * l'autorisation réelle vit dans la RLS et dans ces contrôles serveur.
 */
export async function getCurrentUser(): Promise<{ authId: string; profile: AppUser } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error || !profile) return null;

  return { authId: user.id, profile: profile as AppUser };
}

/** Exige une session valide ; redirige vers /login sinon. */
export async function requireUser() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  return current;
}

/**
 * Exige une session valide ET un rôle autorisé ; redirige vers /login si non
 * authentifié, ou vers /dashboard (avec message) si le rôle ne correspond
 * pas. Utilisé en tête de chaque page serveur sensible, en complément — pas
 * en remplacement — des policies RLS.
 */
export async function requireRole(allowed: AppUser["role"][]) {
  const current = await requireUser();
  if (!allowed.includes(current.profile.role)) {
    redirect("/dashboard?erreur=acces_refuse");
  }
  return current;
}
