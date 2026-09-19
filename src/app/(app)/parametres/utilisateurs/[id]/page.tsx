import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleSlash } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "../user-avatar";
import { AccountStatusBadge, accountState } from "../account-status";
import { EditUserForm } from "./edit-form";
import { AccessPanel } from "./access-panel";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });
const fmt = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");

const LOG_LABEL: Record<string, { text: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  envoye: { text: "Envoyé", tone: "success" },
  simule: { text: "Simulé (Resend non branché)", tone: "warning" },
  echec: { text: "Échec", tone: "danger" },
  desactive: { text: "Événement désactivé", tone: "neutral" },
  ignore_pas_de_destinataire: { text: "Sans destinataire", tone: "neutral" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  );
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { authId } = await requirePlatformAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: user } = await supabase.from("app_users").select("*").eq("id", id).maybeSingle();
  if (!user) notFound();

  const [{ data: authUser }, { data: roles }, { data: companies }, { data: sections }, { data: contacts }, { data: logs }] =
    await Promise.all([
      admin.auth.admin.getUserById(id),
      supabase.from("roles").select("id,label,base_role,active").order("label"),
      supabase.from("companies").select("id,name").order("name"),
      supabase.from("sections").select("id,name").order("display_order"),
      supabase.from("contacts").select("id,company_id,first_name,last_name").eq("status", "actif").order("last_name"),
      admin
        .from("notification_log")
        .select("id,event_key,subject,status,created_at")
        .eq("recipient_email", user.email)
        .in("event_key", ["compte_cree", "compte_modifie", "mot_de_passe_reinitialisation", "mot_de_passe_modifie"])
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const lastSignInAt = authUser.user?.last_sign_in_at ?? null;
  const state = accountState(user.active, lastSignInAt);
  const currentRole = roles?.find((r) => r.id === user.role_id);
  // Le rôle actuel reste proposé même s'il a été désactivé depuis ; les autres rôles désactivés ne le sont pas.
  const selectableRoles = (roles ?? []).filter((r) => r.active || r.id === user.role_id);

  return (
    <div className="space-y-6">
      <Link href="/parametres/utilisateurs" className="inline-flex items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Utilisateurs
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <UserAvatar name={user.full_name} size="lg" muted={state === "desactive"} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{user.full_name}</h1>
          <p className="text-sm text-foreground-muted">
            {user.email}
            {user.job_title ? ` · ${user.job_title}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="brand">{currentRole?.label ?? user.role}</Badge>
            <AccountStatusBadge state={state} />
            {user.must_change_password && state !== "invitation" && <Badge tone="warning">Nouveau mot de passe exigé</Badge>}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Informations du compte" description="Identité, rôle et rattachement. Les changements sensibles sont notifiés à l'utilisateur." />
          <CardBody>
            <EditUserForm
              userId={user.id}
              defaults={{
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                job_title: user.job_title,
                role_id: user.role_id,
                company_id: user.company_id,
                contact_id: user.contact_id,
                section_id: user.section_id,
              }}
              roles={selectableRoles}
              companies={companies ?? []}
              sections={sections ?? []}
              contacts={contacts ?? []}
            />
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Accès et sécurité" />
            <CardBody className="space-y-4">
              <dl className="divide-y divide-border">
                <Row label="Compte créé le">{fmt(user.created_at)}</Row>
                <Row label="Dernière connexion">{lastSignInAt ? fmt(lastSignInAt) : "Jamais"}</Row>
                <Row label="Mot de passe changé">{user.password_changed_at ? fmt(user.password_changed_at) : "Jamais"}</Row>
              </dl>
              <AccessPanel
                userId={user.id}
                fullName={user.full_name}
                email={user.email}
                active={user.active}
                neverSignedIn={!lastSignInAt}
                mustChangePassword={user.must_change_password}
                isSelf={user.id === authId}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="E-mails de compte envoyés" description="Les 8 derniers, journal complet dans Paramètres > Notifications." />
            <CardBody className="p-0">
              {(logs ?? []).length === 0 ? (
                <p className="px-5 py-4 text-sm text-foreground-muted">Aucun e-mail de compte envoyé.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(logs ?? []).map((l) => {
                    const meta = LOG_LABEL[l.status] ?? { text: l.status, tone: "neutral" as const };
                    const Icon = meta.tone === "success" ? CheckCircle2 : meta.tone === "danger" ? CircleAlert : CircleSlash;
                    return (
                      <li key={l.id} className="flex items-start gap-3 px-5 py-3">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{l.subject || l.event_key}</p>
                          <p className="text-xs text-foreground-muted">
                            {fmt(l.created_at)} · {meta.text}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
