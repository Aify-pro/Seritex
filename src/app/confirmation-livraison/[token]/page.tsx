import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { adresseSite } from "@/lib/notifications/liens";

/**
 * Ancienne page de confirmation de réception (LIV-2, L8). Le parcours client
 * vit désormais sur le site (www.seritex.ci/confirmation-livraison/<jeton>) ;
 * cette adresse reste pour les e-mails déjà envoyés et y redirige. Le jeton
 * garde sa valeur : la base le vérifie, rien n'est lu ici.
 */
export default async function ConfirmationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await createAdminClient().from("notification_style_settings").select("site_base_url").limit(1).maybeSingle();
  redirect(`${adresseSite(data?.site_base_url)}/confirmation-livraison/${encodeURIComponent(token)}`);
}
