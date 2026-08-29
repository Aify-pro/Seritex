"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Rafraîchit silencieusement la page serveur dès qu'un événement pertinent
 * arrive sur Supabase Realtime — utilisé sur les vues de pilotage partagées
 * (vue transverse atelier) pour rester à jour sans que l'utilisateur ait à
 * recharger manuellement.
 */
export function RealtimeRefresher({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`refresh_${table}_${filter ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table, filter, router]);

  return null;
}
