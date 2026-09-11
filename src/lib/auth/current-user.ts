import { cache } from "react";
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

/**
 * L'utilisateur courant est-il l'ADMINISTRATEUR DE LA PLATEFORME (rôle
 * système `administrateur`, l'informatique) ?
 *
 * À ne pas confondre avec `requireRole(["administrateur"])`, qui teste le
 * `base_role` : un rôle métier dérivé — la Direction — hérite du base_role
 * `administrateur` pour voir l'ensemble des données, et passerait donc ce
 * contrôle. Seule la CLÉ du rôle distingue les deux.
 *
 * La réponse vient de `is_platform_admin()` côté Postgres, la même fonction
 * qui garde les policies des tables de réglage (migration 0026) : un seul
 * endroit fait autorité, et l'écran ne peut pas diverger de la base. Mise en
 * cache par requête serveur, comme la matrice de permissions.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");

  // Repli strictement borné au cas « la migration 0026 n'est pas encore
  // appliquée » (PGRST202 = fonction inconnue de PostgREST) : sans lui, un
  // déploiement Vercel parti avant le `supabase db push` enfermerait
  // l'administrateur hors de ses propres écrans de réglage. On retombe alors
  // sur le base_role, c'est-à-dire le comportement d'avant ce chantier — sans
  // danger, puisque aucun rôle dérivé de l'administrateur n'existe tant que
  // cette même migration n'est pas passée. Toute autre erreur refuse.
  if (error) {
    return error.code === "PGRST202" && profile.role === "administrateur";
  }
  return data === true;
});

/**
 * Exige l'administrateur de plateforme ; redirige vers le tableau de bord
 * sinon. Pour les écrans et actions de RÉGLAGE (comptes, rôles &
 * permissions, connexion Sage, cibles de stockage) — jamais pour le métier,
 * où `requireRole` reste le bon outil.
 */
export async function requirePlatformAdmin() {
  const current = await requireUser();
  if (!(await isPlatformAdmin())) {
    redirect("/dashboard?erreur=acces_refuse");
  }
  return current;
}
