import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

/**
 * Cible du QR code imprimé sur la proforma PDF : une URL unique,
 * `/devis/<référence>`, qui renvoie chacun vers sa vue — le client vers son
 * portail, l'équipe commerciale vers la fiche devis interne. Non connecté :
 * connexion puis retour ici (`/login?next=`, repris par `signInAction`).
 * La RLS limite déjà un client à ses propres devis ; un devis d'une autre
 * entreprise répond donc « introuvable », jamais « interdit ».
 */
export default async function QuoteQrLandingPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;

  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(`/devis/${reference}`)}`);
  const { profile } = current;

  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("id,company_id").eq("reference", reference).maybeSingle();
  if (!quote) notFound();

  if (profile.role === "client") {
    if (quote.company_id !== profile.company_id) notFound();
    redirect(`/client/devis/${quote.id}`);
  }
  if (profile.role === "commercial" || profile.role === "administrateur") redirect(`/commercial/devis/${quote.id}`);

  // Autres rôles internes (atelier…) : pas de vue devis dédiée.
  redirect("/dashboard");
}
