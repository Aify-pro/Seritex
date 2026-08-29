"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase côté navigateur. Utilise la clé publique "anon" — toute
 * l'autorisation réelle est appliquée par les policies RLS côté base de
 * données (voir supabase/migrations/0002_rls.sql), jamais côté client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
