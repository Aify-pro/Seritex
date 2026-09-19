import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { confirmRecoveryAction } from "./actions";

export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash: tokenHash, type } = await searchParams;
  if (!tokenHash || type !== "recovery") redirect("/mot-de-passe-oublie?erreur=lien_invalide");

  return (
    <AuthShell
      title="Choisir votre mot de passe"
      description="Pour des raisons de sécurité, confirmez que c'est bien vous qui ouvrez ce lien."
    >
      <form action={confirmRecoveryAction}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <Button type="submit" className="w-full">
          Continuer
        </Button>
      </form>
    </AuthShell>
  );
}
