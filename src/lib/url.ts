import { headers } from "next/headers";

/**
 * URL absolue de base de l'application, déduite des en-têtes de la requête
 * entrante plutôt que d'une variable d'environnement séparée à maintenir en
 * sus des 3 variables Supabase déjà nécessaires (README) — évite qu'elle se
 * désynchronise du domaine réellement utilisé (preview Vercel, domaine
 * personnalisé...). Utilisée pour générer le lien absolu encodé dans le QR
 * code d'une fiche échantillon (section 5.2 de l'analyse).
 */
export async function getBaseUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
