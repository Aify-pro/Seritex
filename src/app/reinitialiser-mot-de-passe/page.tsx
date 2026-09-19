import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AuthShell } from "@/components/auth/auth-shell";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery";
import { setNewPasswordAction } from "./actions";

export default async function ResetPasswordPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/mot-de-passe-oublie?erreur=lien_invalide");

  const viaLink = (await cookies()).get(RECOVERY_COOKIE)?.value === "1";
  const forced = current.profile.must_change_password;
  // Ni lien de réinitialisation ni changement exigé : rien à faire ici.
  if (!viaLink && !forced) redirect("/mon-compte?onglet=securite");

  return (
    <AuthShell
      title={forced && !viaLink ? "Choisissez votre mot de passe" : "Nouveau mot de passe"}
      description={
        forced && !viaLink
          ? "Votre compte utilise un mot de passe provisoire. Choisissez le vôtre pour continuer."
          : `Compte ${current.profile.email}. Ce mot de passe remplace l'ancien.`
      }
    >
      <NewPasswordForm action={setNewPasswordAction} submitLabel="Enregistrer et continuer" />
    </AuthShell>
  );
}
