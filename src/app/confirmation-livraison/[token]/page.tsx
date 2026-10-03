import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ConfirmationForm } from "./confirmation-form";

/**
 * Page publique de confirmation de réception (LIV-2, L8) : ouverte depuis
 * l'e-mail « livraison effectuée », sans compte. Minimale : référence du BL,
 * client, date, nombre de pièces, et deux choix.
 */
export default async function ConfirmationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("shipment_confirmation_info", { p_token: token }).maybeSingle();
  const info = data as { reference: string | null; client_nom: string | null; livree_at: string | null; pieces: number; reponse: string | null; expire: boolean } | null;

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-surface p-6 shadow-sm">
        <Image src="/logo-seritex-wide.png" alt="Seritex" width={447} height={265} className="h-10 w-auto object-contain" priority />
        {!info ? (
          <p className="text-sm text-foreground-muted">Ce lien de confirmation n&apos;est pas valide.</p>
        ) : (
          <>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Livraison {info.reference}</h1>
              <p className="text-sm text-foreground-muted">
                {info.client_nom} · {info.pieces} pièce(s)
                {info.livree_at ? ` · remise le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(info.livree_at))}` : ""}
              </p>
            </div>
            {info.reponse ? (
              <p className="rounded-md bg-surface-muted px-3 py-3 text-sm">Merci : votre réponse a bien été enregistrée.</p>
            ) : info.expire ? (
              <p className="rounded-md bg-warning-soft px-3 py-3 text-sm text-warning">Ce lien a expiré. Contactez-nous si besoin.</p>
            ) : (
              <ConfirmationForm token={token} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
