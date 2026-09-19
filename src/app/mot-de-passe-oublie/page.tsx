import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { erreur } = await searchParams;
  return (
    <AuthShell
      title="Mot de passe oublié"
      description="Saisissez l'adresse e-mail de votre compte : nous vous envoyons un lien pour choisir un nouveau mot de passe."
    >
      <ForgotForm linkExpired={erreur === "lien_invalide"} />
    </AuthShell>
  );
}
