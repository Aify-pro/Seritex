import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { ProfileForm } from "./profile-form";
import { SignOutEverywhere } from "./sign-out-everywhere";
import { changeMyPasswordAction } from "./actions";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "profil", label: "Profil" },
  { key: "securite", label: "Mot de passe et sécurité" },
] as const;

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
const fmt = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-40 shrink-0 text-xs text-foreground-muted">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

export default async function MyAccountPage({ searchParams }: { searchParams: Promise<{ onglet?: string }> }) {
  const { onglet } = await searchParams;
  const tab = onglet === "securite" ? "securite" : "profil";
  const { profile } = await requireUser();
  const supabase = await createClient();

  const [{ data: role }, { data: authData }, { data: company }, { data: section }] = await Promise.all([
    supabase.from("roles").select("label").eq("id", profile.role_id).maybeSingle(),
    supabase.auth.getUser(),
    profile.company_id ? supabase.from("companies").select("name").eq("id", profile.company_id).maybeSingle() : { data: null },
    profile.section_id ? supabase.from("sections").select("name").eq("id", profile.section_id).maybeSingle() : { data: null },
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Mon compte" description="Vos informations personnelles et la sécurité de votre accès." />

      <nav aria-label="Sections du compte" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "profil" ? "/mon-compte" : `/mon-compte?onglet=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "border-brand text-brand" : "border-transparent text-foreground-muted hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "profil" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader title="Informations personnelles" description="Visibles par l'équipe Seritex dans les historiques et les affectations." />
            <CardBody>
              <ProfileForm fullName={profile.full_name} phone={profile.phone} jobTitle={profile.job_title} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Accès" description="Défini par votre administrateur." />
            <CardBody>
              <dl className="divide-y divide-border">
                <InfoRow label="E-mail">{profile.email}</InfoRow>
                <InfoRow label="Rôle">
                  <Badge tone="brand">{role?.label ?? profile.role}</Badge>
                </InfoRow>
                {company && <InfoRow label="Entreprise">{company.name}</InfoRow>}
                {section && <InfoRow label="Section">{section.name}</InfoRow>}
                <InfoRow label="Compte créé le">{fmt(profile.created_at)}</InfoRow>
              </dl>
              <p className="mt-3 text-xs text-foreground-muted">
                Pour changer votre adresse e-mail, votre rôle ou votre rattachement, contactez votre administrateur.
              </p>
            </CardBody>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Changer de mot de passe" description="Un e-mail de confirmation vous est envoyé après le changement." />
            <CardBody>
              <NewPasswordForm
                action={changeMyPasswordAction}
                requireCurrent
                submitLabel="Changer le mot de passe"
                successMessage="Mot de passe modifié."
              />
              <p className="mt-4 text-xs text-foreground-muted">
                Mot de passe oublié ?{" "}
                <Link href="/mot-de-passe-oublie" className="text-brand hover:underline">
                  Recevoir un lien par e-mail
                </Link>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Sessions" description="Où et quand ce compte a été utilisé." />
            <CardBody className="space-y-4">
              <dl className="divide-y divide-border">
                <InfoRow label="Dernière connexion">{fmt(authData.user?.last_sign_in_at)}</InfoRow>
                <InfoRow label="Mot de passe changé">{profile.password_changed_at ? fmt(profile.password_changed_at) : "Jamais depuis la création"}</InfoRow>
              </dl>
              <div>
                <p className="mb-2 text-xs text-foreground-muted">
                  À utiliser si vous avez oublié de vous déconnecter d&apos;un poste partagé ou perdu un appareil.
                </p>
                <SignOutEverywhere />
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
