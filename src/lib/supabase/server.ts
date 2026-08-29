import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Client Supabase côté serveur (Server Components, Server Actions, Route
 * Handlers). Porte les cookies de session httpOnly de l'utilisateur courant :
 * chaque requête à la base est donc exécutée avec son identité réelle et ses
 * policies RLS, jamais avec un accès privilégié.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll appelé depuis un Server Component : ignoré, le
            // middleware se charge du rafraîchissement de session.
          }
        },
      },
    }
  );
}
